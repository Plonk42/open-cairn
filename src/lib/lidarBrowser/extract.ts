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
import { acquireGlobal, noteRateLimit, releaseGlobal } from './rateLimiter';

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
    /**
     * Optional oriented-rectangle crop in Lambert-93. When present it supersedes
     * the square `radius` bbox for the per-point keep test: a point is kept iff
     * it falls inside the rotated rectangle. `ux,uy` is the unit L93 direction of
     * the length axis (the width axis is its left-perpendicular). The square
     * `radius` AABB is still used to pick intersecting nodes.
     */
    rect?: { ux: number; uy: number; halfWidthM: number; halfLengthM: number } | null;
    /**
     * Also decode per-point ScanAngle / PointSourceId / GpsTime (point
     * format 6+). Used by the Poisson mode for flight-line normal orientation;
     * skipped otherwise to avoid the extra per-point reads.
     */
    needScan?: boolean;
    signal?: AbortSignal;
}

export interface ExtractResult {
    /** Interleaved (dx_east, dy_north, z) float32 meters, METER_OFFSETS origin = (x0, y0). */
    positions: Float32Array;
    /** ASPRS LAS classification per point (0..255). */
    classifications: Uint8Array;
    /** Sensor scan angle (degrees) per point. Present only when `needScan`. */
    scanAngle?: Float32Array;
    /** Flight-line id (PointSourceId) per point. Present only when `needScan`. */
    sourceId?: Uint16Array;
    /** GPS time (seconds) per point. Present only when `needScan`. */
    gpsTime?: Float64Array;
    /** Total points present in the intersecting nodes before stride/class/bbox filtering. */
    rawPointCount: number;
    /** Points falling inside the query bbox + class filter, before stride decimation. */
    inBboxPointCount: number;
}

interface CopcNode {
    pointCount: number;
    pointDataOffset: number;
    pointDataLength: number;
}

interface CopcHandle {
    info: { rootHierarchyPage: unknown; cube: number[] };
}

/** Minimal structural view of a decoded COPC point-data page. */
interface PointDataView {
    dimensions: Record<string, unknown>;
    pointCount: number;
    getter(name: string): (index: number) => number;
}

/** Per-point scan getters + preallocated output buffers for the Poisson path. */
interface ScanReaders {
    getSA: (i: number) => number;
    getPSID: (i: number) => number;
    getGT: (i: number) => number;
    scanAngle: Float32Array;
    sourceId: Uint16Array;
    gpsTime: Float64Array;
}

/**
 * Build scan-dimension readers if the tile carries ScanAngle / PointSourceId /
 * GpsTime (LAS point format 6+). Returns null when any is absent so the caller
 * silently degrades to geometry-only orientation.
 */
function makeScanReaders(view: PointDataView, maxKept: number): ScanReaders | null {
    if (view.dimensions.ScanAngle === undefined
        || view.dimensions.PointSourceId === undefined
        || view.dimensions.GpsTime === undefined) {
        return null;
    }
    return {
        getSA: view.getter('ScanAngle'),
        getPSID: view.getter('PointSourceId'),
        getGT: view.getter('GpsTime'),
        scanAngle: new Float32Array(maxKept),
        sourceId: new Uint16Array(maxKept),
        gpsTime: new Float64Array(maxKept),
    };
}

/** Trim the scan buffers to the kept-point count (empty object when absent). */
function finalizeScan(
    scan: ScanReaders | null, kept: number,
): Pick<ExtractResult, 'scanAngle' | 'sourceId' | 'gpsTime'> {
    if (!scan) return {};
    return {
        scanAngle: scan.scanAngle.subarray(0, kept),
        sourceId: scan.sourceId.subarray(0, kept),
        gpsTime: scan.gpsTime.subarray(0, kept),
    };
}

/** A single decoded node's contribution to the merged extraction. */
interface NodeResult {
    positions: Float32Array;
    classifications: Uint8Array;
    scanAngle?: Float32Array;
    sourceId?: Uint16Array;
    gpsTime?: Float64Array;
    raw: number;
    inBbox: number;
}

/** Concatenate every node's points (and optional scan dims) into flat arrays. */
function mergeNodeResults(
    results: NodeResult[], total: number, needScan: boolean,
): Pick<ExtractResult, 'positions' | 'classifications' | 'scanAngle' | 'sourceId' | 'gpsTime'> {
    const outPos = new Float32Array(total * 3);
    const outCls = new Uint8Array(total);
    const outScanAngle = needScan ? new Float32Array(total) : undefined;
    const outSourceId = needScan ? new Uint16Array(total) : undefined;
    const outGpsTime = needScan ? new Float64Array(total) : undefined;
    let offP = 0, offC = 0;
    for (const r of results) {
        outPos.set(r.positions, offP);
        outCls.set(r.classifications, offC);
        if (outScanAngle && r.scanAngle) outScanAngle.set(r.scanAngle, offC);
        if (outSourceId && r.sourceId) outSourceId.set(r.sourceId, offC);
        if (outGpsTime && r.gpsTime) outGpsTime.set(r.gpsTime, offC);
        offP += r.positions.length;
        offC += r.classifications.length;
    }
    return {
        positions: outPos,
        classifications: outCls,
        scanAngle: outScanAngle,
        sourceId: outSourceId,
        gpsTime: outGpsTime,
    };
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
/** Axis-aligned Lambert-93 bbox used for node selection and the square crop. */
interface CropBbox { minX: number; maxX: number; minY: number; maxY: number; }

/**
 * Per-point keep test. With an oriented `rect` a point is kept iff it lies in
 * the rotated rectangle (projected onto its L93 length/width axes); otherwise
 * it falls back to the square AABB. `dx,dy` are the point's metre offsets from
 * the request centre (x0,y0); `x,y` are its absolute L93 coordinates.
 */
function isInsideCrop(
    dx: number, dy: number, x: number, y: number,
    rect: ExtractParams['rect'], bbox: CropBbox,
): boolean {
    if (rect) {
        const lAxis = dx * rect.ux + dy * rect.uy;
        const wAxis = -dx * rect.uy + dy * rect.ux;
        return Math.abs(lAxis) <= rect.halfLengthM && Math.abs(wAxis) <= rect.halfWidthM;
    }
    return x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
}

export async function extractPoints(params: ExtractParams): Promise<ExtractResult> {
    const { tileUrl, x0, y0, radius, stride, classFilter, needScan } = params;
    const rect = params.rect ?? null;
    const rawGet = Getter.create(tileUrl);
    // Diagnostic wrapper: every byte-range fetch is logged with the size
    // returned. If the IGN server ever responds with 200 (no Range support)
    // instead of 206, `compressed.byteLength` would jump to ~200 MB and the
    // wasm heap would OOM after a few nodes.
    let totalBytesFetched = 0;
    let fetchCount = 0;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const get: typeof rawGet = async (begin: number, end: number) => {
        const expected = end - begin;
        const tileName = tileUrl.split('/').pop() ?? tileUrl;
        const MAX_ATTEMPTS = 5;
        let lastSnippet = '';
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await acquireGlobal();
            let buf: Uint8Array;
            try {
                buf = await rawGet(begin, end);
            } finally {
                releaseGlobal();
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
            // Exponential backoff: 1s, 2s, 4s, 8s.
            const delay = 1000 * (2 ** attempt);
            // Park every other inflight/queued request for the same window
            noteRateLimit(delay);
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
    const tCreate = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copc = (await Copc.create(get)) as any as CopcHandle;
    const dCreate = performance.now() - tCreate;
    const bbox = {
        minX: x0 - radius,
        maxX: x0 + radius,
        minY: y0 - radius,
        maxY: y0 + radius,
    };
    const tHier = performance.now();
    const nodes = await collectIntersectingNodes(get, copc, bbox);
    const dHier = performance.now() - tHier;
    // eslint-disable-next-line no-console
    console.log('[lidarBrowser] tile', tileUrl.split('/').pop(),
        'intersecting nodes:', nodes.length,
        'sample:', nodes.slice(0, 3).map(({ node }) => ({
            pc: node.pointCount,
            off: node.pointDataOffset,
            len: node.pointDataLength,
        })));
    const safeStride = Math.max(1, Math.floor(stride));

    // Coalesce neighbouring node ranges into bigger HTTP Range requests.
    // COPC stores nodes mostly contiguously in the file (ordered by octree
    // key), so for typical queries there are long runs of adjacent nodes.
    // Merging them lets us spend our 6 req/s budget on fewer, larger reads
    // and saturate IGN's bandwidth instead of round-tripping per node.
    //
    // Trade-off: slurping a few extra KB between nodes is cheap; an entire
    // unrelated node would just be downloaded and ignored. We cap the gap
    // at 256 KB and the merged size at 16 MB.
    const MAX_GAP = 256 * 1024;
    const MAX_GROUP_BYTES = 16 * 1024 * 1024;
    const sorted = [...nodes].sort(
        (a, b) => a.node.pointDataOffset - b.node.pointDataOffset,
    );
    interface Group { begin: number; end: number; items: typeof sorted }
    const groups: Group[] = [];
    for (const item of sorted) {
        const begin = item.node.pointDataOffset;
        const end = begin + item.node.pointDataLength;
        const last = groups.at(-1);
        if (last && begin - last.end <= MAX_GAP && end - last.begin <= MAX_GROUP_BYTES) {
            last.end = Math.max(last.end, end);
            last.items.push(item);
        } else {
            groups.push({ begin, end, items: [item] });
        }
    }
    const totalNodeBytes = sorted.reduce((s, it) => s + it.node.pointDataLength, 0);
    const totalGroupBytes = groups.reduce((s, g) => s + (g.end - g.begin), 0);
    console.log('[lidarBrowser] tile', tileUrl.split('/').pop(),
        'coalesced', sorted.length, '→', groups.length, 'ranges',
        `(overhead ${((totalGroupBytes / Math.max(1, totalNodeBytes) - 1) * 100).toFixed(1)}%)`);

    // Pre-fetch every group concurrently (subject to acquireGlobal). Slice
    // out the per-node buffers into a Map so the decompress step below
    // doesn't need to talk to the network at all.
    const tFetch = performance.now();
    const nodeBuffers = new Map<string, Uint8Array>();
    await Promise.all(groups.map(async (g) => {
        const buf = await get(g.begin, g.end);
        for (const it of g.items) {
            const start = it.node.pointDataOffset - g.begin;
            nodeBuffers.set(it.key, buf.subarray(start, start + it.node.pointDataLength));
        }
    }));
    const dFetch = performance.now() - tFetch;

    async function processNode(key: string, node: CopcNode): Promise<{
        positions: Float32Array;
        classifications: Uint8Array;
        scanAngle?: Float32Array;
        sourceId?: Uint16Array;
        gpsTime?: Float64Array;
        raw: number;
        inBbox: number;
    }> {
        // The compressed chunk is already in memory (pre-fetched above).
        // Decompression on the laz-perf WASM heap isn't re-entrant, so it
        // stays serialized via runOnLazPerf.
        const buf = nodeBuffers.get(key);
        if (!buf) throw new Error(`Missing prefetched buffer for node ${key}`);
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
        const scan = needScan ? makeScanReaders(view, maxKept) : null; let kept = 0;
        for (let i = 0; i < n; i += safeStride) {
            const x = getX(i);
            const y = getY(i);
            const dx = x - x0;
            const dy = y - y0;
            if (!isInsideCrop(dx, dy, x, y, rect, bbox)) continue;
            const c = getC ? getC(i) : 0;
            if (classFilter && getC && !classFilter.has(c)) continue;
            pos[kept * 3] = dx;
            pos[kept * 3 + 1] = dy;
            pos[kept * 3 + 2] = getZ(i);
            cls[kept] = c;
            if (scan) {
                scan.scanAngle[kept] = scan.getSA(i);
                scan.sourceId[kept] = scan.getPSID(i);
                scan.gpsTime[kept] = scan.getGT(i);
            }
            kept++;
        }
        // `inBbox` is estimated as kept × stride (the actual ratio is identical
        // up to a class-filter rounding effect, since we only sample every Nth
        // point in the node). Cheap, and avoids a full per-point iteration.
        return {
            positions: pos.subarray(0, kept * 3),
            classifications: cls.subarray(0, kept),
            ...finalizeScan(scan, kept),
            raw: n,
            inBbox: kept * safeStride,
        };
    }

    // Process all nodes in parallel (HTTP Range requests interleave nicely).
    const tDecode = performance.now();
    const results = await Promise.all(nodes.map(({ key, node }) => processNode(key, node)));
    const dDecode = performance.now() - tDecode;
    // eslint-disable-next-line no-console
    console.log('[lidarBrowser] tile', tileUrl.split('/').pop(),
        'fetched', fetchCount, 'ranges', '(', (totalBytesFetched / 1024 / 1024).toFixed(1), 'MB total)',
        '— phases:',
        `create ${dCreate.toFixed(0)} ms,`,
        `hierarchy ${dHier.toFixed(0)} ms,`,
        `prefetch ${dFetch.toFixed(0)} ms,`,
        `decompress ${dDecode.toFixed(0)} ms`);

    let total = 0;
    let rawTotal = 0;
    let inBboxTotal = 0;
    for (const r of results) {
        total += r.classifications.length;
        rawTotal += r.raw;
        inBboxTotal += r.inBbox;
    }
    return {
        ...mergeNodeResults(results, total, !!needScan),
        rawPointCount: rawTotal,
        inBboxPointCount: inBboxTotal,
    };
}
