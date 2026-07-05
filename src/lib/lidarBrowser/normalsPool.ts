/**
 * Phase 2 client: parallelizes `computeNormalsKNN`/`computeNormalsVegAware`
 * across a small pool of `normalsWorker.ts` instances, spawned in a NESTED
 * fashion from inside the already-running pipeline worker (`worker.ts`) — not
 * from the main thread. One shared pool is reused across the vegetation and
 * "rest" passes (see `computeNormalsVegAwareAsync`) so the total worker count
 * stays bounded regardless of how many passes run.
 *
 * Falls back to the exact synchronous `computeNormalsKNN`/`computeNormalsVegAware`
 * when nested workers aren't supported (e.g. jsdom in tests, or older Safari),
 * pool construction fails, or the cloud is too small for tiling/message-passing
 * overhead to pay off. Every fallback path calls the *same* sequential
 * functions the pre-Phase-2 code used, so results are always exactly parity
 * with the sequential path — see `normalsTiling.test.ts` for the parity
 * guarantee of the parallel path itself.
 */
import { computeNormalsKNN, computeNormalsVegAware, scatterNormals } from './normals';
import { planNormalsTiles } from './normalsTiling';
import type { NormalsTileRequest, NormalsTileResponse } from './normalsWorkerProtocol';

/** Below this point count, tiling/parallelization overhead isn't worth it. */
const MIN_PARALLEL_POINTS = 200_000;

/** ASPRS vegetation classes (low / medium / high) — mirrors `normals.ts`'s `VEG_CLASSES`. */
const VEG_CLASSES = new Set([3, 4, 5]);

interface PendingTile {
    resolve: (r: { normals: Float32Array; quality?: Float32Array }) => void;
    reject: (err: Error) => void;
}

let workers: Worker[] = [];
let nextWorkerIndex = 0;
let nextId = 0;
const pending = new Map<number, PendingTile>();
/** Set permanently once pool construction or a worker crash fails — never retried. */
let poolFailed = false;

function rejectAllPending(err: Error): void {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
}

function terminatePool(err: Error): void {
    for (const w of workers) w.terminate();
    workers = [];
    rejectAllPending(err);
}

function handleMessage(ev: MessageEvent<NormalsTileResponse>): void {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === 'ok') p.resolve({ normals: msg.normals, quality: msg.quality });
    else p.reject(new Error(msg.error));
}

function handleError(ev: ErrorEvent): void {
    poolFailed = true;
    terminatePool(new Error(ev.message || 'Normals worker crashed'));
}

/** Desired pool size for this environment — bounded so we never spawn an unreasonable number of nested workers. */
function desiredPoolSize(): number {
    const hc = typeof navigator === 'undefined' ? 0 : navigator.hardwareConcurrency;
    return Math.max(1, Math.min(hc || 4, 8));
}

/** Lazily grow the shared pool to `size` workers. Returns the (possibly empty, on failure) current pool. */
function ensurePool(size: number): Worker[] {
    if (poolFailed) return [];
    if (workers.length >= size) return workers;
    try {
        while (workers.length < size) {
            const w = new Worker(new URL('./normalsWorker.ts', import.meta.url), { type: 'module' });
            w.onmessage = handleMessage;
            w.onerror = handleError;
            workers.push(w);
        }
    } catch (err) {
        poolFailed = true;
        terminatePool(err instanceof Error ? err : new Error(String(err)));
    }
    return workers;
}

/** Round-robin the shared pool across all in-flight dispatches (veg + rest passes alike). */
function pickWorker(pool: Worker[]): Worker {
    const w = pool[nextWorkerIndex % pool.length];
    nextWorkerIndex++;
    return w;
}

function dispatchTile(pool: Worker[], req: Omit<NormalsTileRequest, 'id'>): Promise<{ normals: Float32Array; quality?: Float32Array }> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: NormalsTileRequest = { id, ...req };
        pickWorker(pool).postMessage(request, [request.positions.buffer]);
    });
}

function poolSupported(): boolean {
    return typeof Worker !== 'undefined' && !poolFailed;
}

/**
 * Parallel-or-sequential equivalent of `computeNormalsKNN`. Always resolves
 * to the exact same values `computeNormalsKNN` would have returned.
 */
export async function computeNormalsKNNAsync(
    positions: Float32Array,
    k = 12,
    cellSize = 2,
    forceUpward = true,
    quality?: Float32Array,
): Promise<Float32Array> {
    const n = positions.length / 3;
    const size = desiredPoolSize();
    if (size <= 1 || n < MIN_PARALLEL_POINTS || !poolSupported()) {
        return computeNormalsKNN(positions, k, cellSize, forceUpward, quality);
    }

    const pool = ensurePool(size);
    if (pool.length === 0) {
        return computeNormalsKNN(positions, k, cellSize, forceUpward, quality);
    }

    const tiles = planNormalsTiles(positions, pool.length, cellSize);
    const wantQuality = !!quality;
    try {
        const results = await Promise.all(tiles.map((tile) => dispatchTile(pool, {
            positions: tile.localPositions,
            queryLocalIndices: tile.queryLocalIndices,
            k, cellSize, forceUpward, origin: tile.origin, wantQuality,
        })));

        const normals = new Float32Array(n * 3);
        for (let t = 0; t < tiles.length; t++) {
            const tile = tiles[t];
            const { normals: tileNormals, quality: tileQuality } = results[t];
            for (let q = 0; q < tile.queryLocalIndices.length; q++) {
                const gi = tile.localToGlobal[tile.queryLocalIndices[q]];
                normals[gi * 3] = tileNormals[q * 3];
                normals[gi * 3 + 1] = tileNormals[q * 3 + 1];
                normals[gi * 3 + 2] = tileNormals[q * 3 + 2];
                if (quality && tileQuality) quality[gi] = tileQuality[q];
            }
        }
        return normals;
    } catch {
        // A worker crash or message error already marked the pool as failed via
        // handleError when applicable; recompute synchronously either way so
        // the caller always gets a correct (if slower) result.
        return computeNormalsKNN(positions, k, cellSize, forceUpward, quality);
    }
}

/** Parallel-or-sequential equivalent of `computeNormalsVegAware`. */
export async function computeNormalsVegAwareAsync(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
): Promise<Float32Array> {
    let vegCount = 0;
    for (let i = 0; i < pointCount; i++) if (VEG_CLASSES.has(classifications[i])) vegCount++;
    // No vegetation (or nothing but vegetation) → a single default pass is fine.
    if (vegCount === 0) return computeNormalsKNNAsync(positions, 12, 2);
    // Below the parallelization threshold entirely → keep the exact sequential path.
    if (pointCount < MIN_PARALLEL_POINTS) return computeNormalsVegAware(positions, classifications, pointCount);

    const restCount = pointCount - vegCount;
    const vegPos = new Float32Array(vegCount * 3);
    const restPos = new Float32Array(restCount * 3);
    const vegSrc = new Int32Array(vegCount);
    const restSrc = new Int32Array(restCount);
    let vi = 0, ri = 0;
    for (let i = 0; i < pointCount; i++) {
        if (VEG_CLASSES.has(classifications[i])) {
            vegPos[vi * 3] = positions[i * 3];
            vegPos[vi * 3 + 1] = positions[i * 3 + 1];
            vegPos[vi * 3 + 2] = positions[i * 3 + 2];
            vegSrc[vi] = i;
            vi++;
        } else {
            restPos[ri * 3] = positions[i * 3];
            restPos[ri * 3 + 1] = positions[i * 3 + 1];
            restPos[ri * 3 + 2] = positions[i * 3 + 2];
            restSrc[ri] = i;
            ri++;
        }
    }

    const [vegN, restN] = await Promise.all([
        computeNormalsKNNAsync(vegPos, 8, 1.5, true),
        computeNormalsKNNAsync(restPos, 12, 2, true),
    ]);

    const out = new Float32Array(pointCount * 3);
    scatterNormals(out, vegN, vegSrc);
    scatterNormals(out, restN, restSrc);
    return out;
}
