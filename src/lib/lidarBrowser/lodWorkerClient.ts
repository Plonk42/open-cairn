/**
 * Main-thread client for the mesh LOD (level-of-detail) simplification worker
 * (`./lodWorker`). Lazily spawns a single persistent worker; multiplexes
 * concurrent requests by id and streams each computed level back via
 * `onLevel` as soon as it's ready — mirroring the progressive per-level
 * behaviour the previous main-thread `scheduleIdle` chain had, but entirely
 * off the main thread so it never freezes navigation.
 *
 * Point-cloud LOD doesn't use this client — see `lodWorkerProtocol.ts`.
 */
import type { LodRequest, LodResponse } from './lodWorkerProtocol';

interface Pending {
    onLevel: (levelIndex: number, data: Uint32Array) => void;
    resolve: () => void;
    reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function resetWorker(err: Error): void {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
}

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<LodResponse>) => {
        const msg = ev.data;
        const p = pending.get(msg.id);
        if (!p) return;
        if (msg.type === 'level') { p.onLevel(msg.levelIndex, msg.data); return; }
        pending.delete(msg.id);
        if (msg.type === 'done') p.resolve();
        else p.reject(new Error(msg.error));
    };
    worker.onerror = (ev) => resetWorker(new Error(ev.message || 'LOD worker crashed'));
    return worker;
}

/**
 * `positions`/`indices` are sent WITHOUT a transfer list (a normal structured
 * clone / copy) on purpose: both arrays are shared references still owned
 * and read elsewhere (the Zustand store, height recomputation, postcard
 * export, ...), so they must not be detached from the caller.
 */
function dispatch(
    positions: Float32Array,
    indices: Uint32Array,
    targets: number[],
    onLevel: (levelIndex: number, data: Uint32Array) => void,
): Promise<void> {
    const w = ensureWorker();
    const id = ++nextId;
    return new Promise<void>((resolve, reject) => {
        pending.set(id, { onLevel, resolve, reject });
        w.postMessage({ id, positions, indices, targets } satisfies LodRequest);
    });
}

/** Simplify a triangle mesh down to each of `targets` (index counts), finest first. */
export function requestMeshLods(
    positions: Float32Array,
    indices: Uint32Array,
    targets: number[],
    onLevel: (levelIndex: number, data: Uint32Array) => void,
): Promise<void> {
    return dispatch(positions, indices, targets, onLevel);
}
