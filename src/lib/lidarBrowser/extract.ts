/**
 * COPC reader: walks the octree of an IGN LiDAR HD `.copc.laz` tile served
 * over HTTP Range, decodes only the nodes intersecting the requested
 * Lambert-93 bbox, applies stride decimation and optional class filtering.
 *
 * Port of `services/lidar-cloud/server.mjs::extractPoints()`. Uses
 * `copc.js` which is browser-compatible out of the box (HTTP Range via
 * cross-fetch → native fetch in browsers; the package.json `browser` field
 * stubs out the Node `fs` fallback).
 */
import { Copc, Getter, Key } from 'copc';
import { getLazPerf, runOnLazPerf } from './lazPerf';

export interface ExtractParams {
    /** Full URL of the .copc.laz tile (HTTP/HTTPS, CORS must be enabled). */
    tileUrl: string;
    /** Lambert-93 X of the request center. */
    x0: number;
    /** Lambert-93 Y of the request center. */
    y0: number;
    /** Half-side of the bbox, meters. */
    radius: number;
    /** Keep one point in N (after the bbox filter). */
    stride: number;
    /** LAS class whitelist (null = keep all). */
    classFilter: Set<number> | null;
    signal?: AbortSignal;
}

export interface ExtractResult {
    /** Interleaved (dx_east, dy_north, z) float32 meters, METER_OFFSETS origin = (x0, y0). */
    positions: Float32Array;
    /** ASPRS LAS classification per point (0..255). */
    classifications: Uint8Array;
}

interface CopcNode {
    pointCount: number;
    pointDataOffset: number;
    pointDataLength: number;
}

interface CopcHandle {
    info: { rootHierarchyPage: unknown; cube: number[] };
}

/**
 * 3D bounds of a COPC node from its octree key + the root cube.
 */
function nodeBounds(
    key: readonly [number, number, number, number],
    cube: number[],
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
    const [d, kx, ky, kz] = key;
    const span = 1 << d;
    const sx = (cube[3] - cube[0]) / span;
    const sy = (cube[4] - cube[1]) / span;
    const sz = (cube[5] - cube[2]) / span;
    const minX = cube[0] + kx * sx;
    const minY = cube[1] + ky * sy;
    const minZ = cube[2] + kz * sz;
    return { minX, minY, minZ, maxX: minX + sx, maxY: minY + sy, maxZ: minZ + sz };
}

/**
 * Walk the COPC hierarchy from the root page, descending only into branches
 * intersecting the XY query bbox. Sub-pages are loaded lazily.
 */
async function collectIntersectingNodes(
    get: ReturnType<typeof Getter.create>,
    copc: CopcHandle,
    bbox: { minX: number; maxX: number; minY: number; maxY: number },
): Promise<Array<{ key: string; node: CopcNode }>> {
    const out: Array<{ key: string; node: CopcNode }> = [];
    const pageQueue: string[] = ['0-0-0-0'];
    const knownPages: Record<string, unknown> = {
        '0-0-0-0': copc.info.rootHierarchyPage,
    };
    while (pageQueue.length > 0) {
        const pageKey = pageQueue.shift();
        if (pageKey === undefined) break;
        const pageRef = knownPages[pageKey];
        if (!pageRef) continue;
        // `Copc.loadHierarchyPage` returns `{ nodes, pages }`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { nodes, pages } = await Copc.loadHierarchyPage(get, pageRef as any);
        for (const [keyStr, node] of Object.entries(nodes)) {
            if (!node) continue;
            // Skip empty hierarchy entries — the getter would throw on 0-length range.
            if (!node.pointCount || !node.pointDataLength) continue;
            const k = Key.parse(keyStr);
            const nb = nodeBounds(k, copc.info.cube);
            if (nb.maxX < bbox.minX || nb.minX > bbox.maxX) continue;
            if (nb.maxY < bbox.minY || nb.minY > bbox.maxY) continue;
            out.push({ key: keyStr, node });
        }
        for (const [keyStr, sub] of Object.entries(pages)) {
            if (!sub) continue;
            const k = Key.parse(keyStr);
            const nb = nodeBounds(k, copc.info.cube);
            if (nb.maxX < bbox.minX || nb.minX > bbox.maxX) continue;
            if (nb.maxY < bbox.minY || nb.minY > bbox.maxY) continue;
            knownPages[keyStr] = sub;
            pageQueue.push(keyStr);
        }
    }
    return out;
}

/**
 * Decode a COPC LAZ tile over HTTP, crop to a Lambert-93 bbox, decimate,
 * and produce METER_OFFSETS-relative positions (dx east, dy north, dz up).
 */
export async function extractPoints(params: ExtractParams): Promise<ExtractResult> {
    const { tileUrl, x0, y0, radius, stride, classFilter } = params;
    const rawGet = Getter.create(tileUrl);
    // Diagnostic wrapper: every byte-range fetch is logged with the size
    // returned. If the IGN server ever responds with 200 (no Range support)
    // instead of 206, `compressed.byteLength` would jump to ~200 MB and the
    // wasm heap would OOM after a few nodes.
    let totalBytesFetched = 0;
    let fetchCount = 0;
    // IGN's data.geopf.fr aggressively 429s when too many byte-range requests
    // overlap. Cap in-flight gets and retry with exponential backoff on short
    // bodies (always an HTML error page from nginx).
    const MAX_INFLIGHT = 2;
    let inflight = 0;
    const waitQueue: Array<() => void> = [];
    const acquire = async (): Promise<void> => {
        if (inflight < MAX_INFLIGHT) { inflight++; return; }
        await new Promise<void>((resolve) => waitQueue.push(resolve));
        inflight++;
    };
    const release = (): void => {
        inflight--;
        const next = waitQueue.shift();
        if (next) next();
    };
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const get: typeof rawGet = async (begin: number, end: number) => {
        const expected = end - begin;
        const tileName = tileUrl.split('/').pop() ?? tileUrl;
        const MAX_ATTEMPTS = 5;
        let lastSnippet = '';
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await acquire();
            let buf: Uint8Array;
            try {
                buf = await rawGet(begin, end);
            } finally {
                release();
            }
            if (buf.byteLength === expected) {
                totalBytesFetched += buf.byteLength;
                fetchCount++;
                return buf;
            }
            // Short body — decode for diagnostics. 429s look like '<html>...429 Too Many Requests...'.
            let snippet = '';
            try {
                snippet = new TextDecoder('utf-8', { fatal: false })
                    .decode(buf.slice(0, Math.min(buf.byteLength, 400)))
                    .replace(/\s+/g, ' ')
                    .trim();
            } catch { /* ignore decode errors */ }
            lastSnippet = snippet;
            const looksRetriable = /429|503|too many|throttl|unavailable/i.test(snippet)
                || buf.byteLength < expected / 8;
            if (!looksRetriable || attempt === MAX_ATTEMPTS - 1) break;
            // Exponential backoff with jitter: 0.5s, 1s, 2s, 4s.
            const delay = 500 * (2 ** attempt) + Math.random() * 250;
            // eslint-disable-next-line no-console
            console.warn('[lidarBrowser] retry', tileName, 'attempt', attempt + 1,
                'after', Math.round(delay), 'ms (server said:', snippet.slice(0, 80), ')');
            await sleep(delay);
        }
        // eslint-disable-next-line no-console
        console.warn('[lidarBrowser] range mismatch', tileName,
            'asked', expected, 'body:', lastSnippet);
        throw new Error(
            `Range request failed on ${tileName} (asked ${expected} B). `
            + `Server response: ${lastSnippet || '<binary>'}`,
        );
    };
    // Init once per worker; ensures Vite-bundled WASM URL is used.
    const lazPerf = await getLazPerf();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copc = (await Copc.create(get)) as any as CopcHandle;
    const bbox = {
        minX: x0 - radius,
        maxX: x0 + radius,
        minY: y0 - radius,
        maxY: y0 + radius,
    };
    const nodes = await collectIntersectingNodes(get, copc, bbox);
    // eslint-disable-next-line no-console
    console.log('[lidarBrowser] tile', tileUrl.split('/').pop(),
        'intersecting nodes:', nodes.length,
        'sample:', nodes.slice(0, 3).map(({ node }) => ({
            pc: node.pointCount,
            off: node.pointDataOffset,
            len: node.pointDataLength,
        })));
    const safeStride = Math.max(1, Math.floor(stride));

    async function processNode(node: CopcNode): Promise<{
        positions: Float32Array;
        classifications: Uint8Array;
    }> {
        // Step 1 — fetch the compressed chunk over HTTP. This goes through
        // the in-flight semaphore (MAX_INFLIGHT) so up to N nodes download
        // concurrently per tile.
        const buf = await get(node.pointDataOffset, node.pointDataOffset + node.pointDataLength);
        // Step 2 — decompress on the laz-perf WASM heap. The heap isn't
        // re-entrant, so this step is serialized via runOnLazPerf. We wrap
        // the prefetched buffer in a synthetic getter so loadPointDataView
        // doesn't re-fetch from the network.
        const prefetchedGet: typeof get = async (begin: number, end: number) => {
            const off = node.pointDataOffset;
            return buf.subarray(begin - off, end - off);
        };
        const view = await runOnLazPerf(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            () => Copc.loadPointDataView(prefetchedGet, copc as any, node as any, { lazPerf }),
        );
        const getX = view.getter('X');
        const getY = view.getter('Y');
        const getZ = view.getter('Z');
        const hasClass = view.dimensions.Classification !== undefined;
        const getC = hasClass ? view.getter('Classification') : null;
        const n = view.pointCount;
        // Preallocate to upper bound (ceil(n / stride)) and use a write
        // pointer; far faster than pushing into a regular array.
        const maxKept = Math.ceil(n / safeStride);
        const pos = new Float32Array(maxKept * 3);
        const cls = new Uint8Array(maxKept);
        let kept = 0;
        for (let i = 0; i < n; i += safeStride) {
            const x = getX(i);
            const y = getY(i);
            if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) continue;
            const c = getC ? getC(i) : 0;
            if (classFilter && getC && !classFilter.has(c)) continue;
            pos[kept * 3] = x - x0;
            pos[kept * 3 + 1] = y - y0;
            pos[kept * 3 + 2] = getZ(i);
            cls[kept] = c;
            kept++;
        }
        return {
            positions: pos.subarray(0, kept * 3),
            classifications: cls.subarray(0, kept),
        };
    }

    // Process all nodes in parallel (HTTP Range requests interleave nicely).
    const results = await Promise.all(nodes.map(({ node }) => processNode(node)));
    // eslint-disable-next-line no-console
    console.log('[lidarBrowser] tile', tileUrl.split('/').pop(),
        'fetched', fetchCount, 'ranges', '(', (totalBytesFetched / 1024 / 1024).toFixed(1), 'MB total)');

    let total = 0;
    for (const r of results) total += r.classifications.length;
    const outPos = new Float32Array(total * 3);
    const outCls = new Uint8Array(total);
    let offP = 0, offC = 0;
    for (const r of results) {
        outPos.set(r.positions, offP);
        outCls.set(r.classifications, offC);
        offP += r.positions.length;
        offC += r.classifications.length;
    }
    return { positions: outPos, classifications: outCls };
}
