/**
 * Offline LiDAR HD density / roughness analysis for a single zone.
 *
 * Fetches the real IGN LiDAR HD COPC tiles intersecting a square around a
 * WGS84 point, decodes them in Node (copc + laz-perf, NO stride / NO class
 * filter so we measure the TRUE native density), then:
 *   - computes point density per m² (all returns + ground-only),
 *   - checks whether density is spatially uniform,
 *   - computes ground-surface roughness (local relief + detrended RMS),
 *   - estimates how aggressively a roughness-adaptive decimation could thin
 *     the cloud before losing surface detail,
 *   - renders PNG bitmaps (density map, roughness map, adaptive-stride map,
 *     and a 2D resolution-vs-roughness heatmap).
 *
 * Usage:
 *   node tools/lidar-density/analyze.mjs [--lng=6.04216] [--lat=45.24039] \
 *        [--radius=250] [--cell=2] [--out=tools/lidar-density/out]
 *
 * Zero build step (Node >= 22). Uses the same npm packages as the browser
 * pipeline (proj4 / copc / laz-perf) but a Node-native laz-perf init.
 */
import { Copc, Key } from 'copc';
import { createLazPerf } from 'laz-perf';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import proj4 from 'proj4';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = new Map(
    process.argv.slice(2).map((a) => {
        const m = /^--([^=]+)=(.*)$/.exec(a);
        return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
    }),
);
const LNG = Number(args.get('lng') ?? 6.04216);
const LAT = Number(args.get('lat') ?? 45.24039);
const RADIUS = Number(args.get('radius') ?? 250); // half-side, meters
const CELL = Number(args.get('cell') ?? 2); // meters
const OUT = args.get('out') ?? 'tools/lidar-density/out';
const GROUND_CLASSES = new Set([2, 9]); // sol + eau

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Projection (RGF93 / Lambert-93, same as the app)
// ---------------------------------------------------------------------------
proj4.defs(
    'EPSG:2154',
    '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 '
    + '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
const to2154 = proj4('EPSG:4326', 'EPSG:2154');
const [X0, Y0] = to2154.forward([LNG, LAT]);

// ---------------------------------------------------------------------------
// WFS tile discovery
// ---------------------------------------------------------------------------
const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TYPENAME = 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle';

async function findTiles(minLng, minLat, maxLng, maxLat) {
    const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typenames: TYPENAME,
        srsname: 'EPSG:4326',
        bbox: `${minLng},${minLat},${maxLng},${maxLat},EPSG:4326`,
        outputFormat: 'application/json',
        count: '20',
    });
    const res = await fetch(`${WFS_URL}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`WFS ${res.status} ${res.statusText}`);
    const data = await res.json();
    const tiles = [];
    for (const f of data.features ?? []) {
        const props = f.properties ?? {};
        const url = [props.url, props.url_telech, props.name, ...Object.values(props)].find(
            (v) => typeof v === 'string' && /^https?:\/\/.+\.(copc\.)?laz$/i.test(v),
        );
        if (!url) continue;
        tiles.push({ url, name: props.name ?? url.split('/').pop() });
    }
    return tiles;
}

// ---------------------------------------------------------------------------
// COPC decode (Node-native laz-perf)
// ---------------------------------------------------------------------------
function nodeBounds(key, cube) {
    const [d, kx, ky] = key;
    const span = 1 << d;
    const sx = (cube[3] - cube[0]) / span;
    const sy = (cube[4] - cube[1]) / span;
    const minX = cube[0] + kx * sx;
    const minY = cube[1] + ky * sy;
    return { minX, minY, maxX: minX + sx, maxY: minY + sy };
}

async function collectIntersectingNodes(get, copc, bbox) {
    const out = [];
    const queue = ['0-0-0-0'];
    const known = { '0-0-0-0': copc.info.rootHierarchyPage };
    while (queue.length) {
        const pageKey = queue.shift();
        const pageRef = known[pageKey];
        if (!pageRef) continue;
        const { nodes, pages } = await Copc.loadHierarchyPage(get, pageRef);
        for (const [keyStr, node] of Object.entries(nodes)) {
            if (!node?.pointCount || !node.pointDataLength) continue;
            const nb = nodeBounds(Key.parse(keyStr), copc.info.cube);
            if (nb.maxX < bbox.minX || nb.minX > bbox.maxX) continue;
            if (nb.maxY < bbox.minY || nb.minY > bbox.maxY) continue;
            out.push({ key: keyStr, node });
        }
        for (const [keyStr, sub] of Object.entries(pages)) {
            if (!sub) continue;
            const nb = nodeBounds(Key.parse(keyStr), copc.info.cube);
            if (nb.maxX < bbox.minX || nb.minX > bbox.maxX) continue;
            if (nb.maxY < bbox.minY || nb.minY > bbox.maxY) continue;
            known[keyStr] = sub;
            queue.push(keyStr);
        }
    }
    return out;
}

let lazPerf = null;
// Serialize laz-perf heap access (WASM heap is not re-entrant).
let lazQueue = Promise.resolve();
function runOnLazPerf(fn) {
    const next = lazQueue.then(fn, fn);
    lazQueue = next.catch(() => undefined);
    return next;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;
async function throttle(minMs) {
    const dt = Date.now() - lastReq;
    if (dt < minMs) await sleep(minMs - dt);
    lastReq = Date.now();
}

/**
 * Robust HTTP Range getter for IGN's COPC tiles.
 *   - Slices the response if the server ignores Range and returns the whole
 *     file (otherwise copc mallocs the full ~180 MB blob and blows the 2 GB
 *     Node WASM heap cap).
 *   - Throttles + retries with backoff to survive rate-limiting (429/503 or
 *     short error bodies).
 */
function makeGet(url) {
    return async function get(begin, end) {
        const want = end - begin;
        let lastErr;
        for (let attempt = 0; attempt < 8; attempt++) {
            await throttle(35);
            try {
                const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
                if (r.status === 429 || r.status === 503) {
                    await sleep(500 * (attempt + 1));
                    continue;
                }
                const ab = await r.arrayBuffer();
                let u8 = new Uint8Array(ab);
                if (u8.length > want && u8.length >= end) u8 = u8.subarray(begin, end);
                if (u8.length !== want) {
                    await sleep(400 * (attempt + 1));
                    continue;
                }
                return u8;
            } catch (e) {
                lastErr = e;
                await sleep(400 * (attempt + 1));
            }
        }
        throw new Error(`range fetch failed ${begin}-${end}: ${lastErr?.message ?? 'exhausted retries'}`);
    };
}

async function extractTile(tileUrl, bbox) {
    const get = makeGet(tileUrl);
    const copc = await Copc.create(get);
    const nodes = await collectIntersectingNodes(get, copc, bbox);
    process.stdout.write(`  ${tileUrl.split('/').pop()}: ${nodes.length} nodes\n`);
    const xs = [];
    const ys = [];
    const zs = [];
    const cs = [];
    let raw = 0;
    if (!lazPerf) lazPerf = await createLazPerf();
    for (const { node } of nodes) {
        const view = await runOnLazPerf(
            () => Copc.loadPointDataView(get, copc, node, { lazPerf }),
        );
        const getX = view.getter('X');
        const getY = view.getter('Y');
        const getZ = view.getter('Z');
        const hasClass = view.dimensions.Classification !== undefined;
        const getC = hasClass ? view.getter('Classification') : null;
        const n = view.pointCount;
        raw += n;
        for (let i = 0; i < n; i++) {
            const x = getX(i);
            const y = getY(i);
            if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) continue;
            xs.push(x - X0);
            ys.push(y - Y0);
            zs.push(getZ(i));
            cs.push(getC ? getC(i) : 0);
        }
    }
    return {
        xs: Float32Array.from(xs),
        ys: Float32Array.from(ys),
        zs: Float32Array.from(zs),
        cs: Uint8Array.from(cs),
        raw,
    };
}

// ---------------------------------------------------------------------------
// PNG encoder (RGB, zero-dep, via node:zlib)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}
/** rgb = Uint8Array of w*h*3 */
function writePng(path, w, h, rgb) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type RGB
    const stride = w * 3;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0; // filter none
        Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const idat = deflateSync(raw, { level: 9 });
    writeFileSync(path, Buffer.concat([
        sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
    ]));
}

// Simple perceptual colormaps (control-point lerp).
function lerpStops(t, stops) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
    ];
}
const VIRIDIS = [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
];
const MAGMA = [
    [0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191],
];
const TURBO = [
    [48, 18, 59], [62, 155, 254], [24, 214, 121], [173, 240, 44],
    [250, 186, 47], [229, 47, 8], [122, 4, 3],
];

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
function quantile(sorted, q) {
    if (sorted.length === 0) return NaN;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.log(`Zone: lng=${LNG} lat=${LAT}  L93=(${X0.toFixed(1)}, ${Y0.toFixed(1)})  radius=${RADIUS} m  cell=${CELL} m`);
    lazPerf = await createLazPerf();

    const dLat = RADIUS / 111_320;
    const dLng = RADIUS / (111_320 * Math.cos((LAT * Math.PI) / 180));
    const tiles = await findTiles(LNG - dLng, LAT - dLat, LNG + dLng, LAT + dLat);
    if (tiles.length === 0) {
        console.error('No LiDAR HD tile covers this zone.');
        process.exit(1);
    }
    console.log(`Tiles: ${tiles.length} — ${tiles.map((t) => t.name).join(', ')}`);

    const bbox = { minX: X0 - RADIUS, maxX: X0 + RADIUS, minY: Y0 - RADIUS, maxY: Y0 + RADIUS };
    const parts = [];
    for (const t of tiles) parts.push(await extractTile(t.url, bbox));

    const total = parts.reduce((s, p) => s + p.cs.length, 0);
    const xs = new Float32Array(total);
    const ys = new Float32Array(total);
    const zs = new Float32Array(total);
    const cs = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        xs.set(p.xs, off);
        ys.set(p.ys, off);
        zs.set(p.zs, off);
        cs.set(p.cs, off);
        off += p.cs.length;
    }
    const areaM2 = (2 * RADIUS) * (2 * RADIUS);
    console.log(`\nPoints in ${2 * RADIUS}×${2 * RADIUS} m window (${(areaM2 / 1e4).toFixed(1)} ha): ${total.toLocaleString()}`);
    console.log(`Mean overall density: ${(total / areaM2).toFixed(2)} pts/m²`);

    // Class breakdown
    const classCount = new Map();
    let groundTotal = 0;
    for (let i = 0; i < total; i++) {
        classCount.set(cs[i], (classCount.get(cs[i]) ?? 0) + 1);
        if (GROUND_CLASSES.has(cs[i])) groundTotal++;
    }
    console.log('Class breakdown (ASPRS):');
    const CLASS_NAMES = {
        1: 'non classé', 2: 'sol', 3: 'végét. basse', 4: 'végét. moyenne',
        5: 'végét. haute', 6: 'bâti', 9: 'eau', 17: 'pont', 64: 'perenne', 66: 'virtuel', 67: 'divers',
    };
    for (const [c, n] of [...classCount].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(c).padStart(3)} ${(CLASS_NAMES[c] ?? '?').padEnd(16)} ${n.toLocaleString().padStart(12)}  ${(100 * n / total).toFixed(1)}%  (${(n / areaM2).toFixed(2)} pts/m²)`);
    }
    console.log(`Ground (2+9): ${groundTotal.toLocaleString()} → ${(groundTotal / areaM2).toFixed(2)} pts/m²`);

    // -----------------------------------------------------------------------
    // Grid: density (all + ground) and ground heightfield
    // -----------------------------------------------------------------------
    const W = Math.ceil((2 * RADIUS) / CELL);
    const H = W;
    const cellArea = CELL * CELL;
    const countAll = new Uint32Array(W * H);
    const countGround = new Uint32Array(W * H);
    const gzMin = new Float32Array(W * H).fill(Infinity);
    const gzMax = new Float32Array(W * H).fill(-Infinity);
    const gzSum = new Float64Array(W * H);
    const gzN = new Uint32Array(W * H);
    const cellIx = (dx, dy) => {
        const gx = Math.floor((dx + RADIUS) / CELL);
        const gy = Math.floor((dy + RADIUS) / CELL);
        if (gx < 0 || gx >= W || gy < 0 || gy >= H) return -1;
        return gy * W + gx;
    };
    for (let i = 0; i < total; i++) {
        const k = cellIx(xs[i], ys[i]);
        if (k < 0) continue;
        countAll[k]++;
        if (GROUND_CLASSES.has(cs[i])) {
            countGround[k]++;
            const z = zs[i];
            if (z < gzMin[k]) gzMin[k] = z;
            if (z > gzMax[k]) gzMax[k] = z;
            gzSum[k] += z;
            gzN[k]++;
        }
    }
    // Ground heightfield (min-Z per cell), hole-filled by neighbour mean.
    const groundZ = new Float32Array(W * H).fill(NaN);
    for (let k = 0; k < W * H; k++) if (gzN[k] > 0) groundZ[k] = gzMin[k];
    const filled = Float32Array.from(groundZ);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const k = y * W + x;
            if (!Number.isNaN(filled[k])) continue;
            let s = 0;
            let c = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const v = groundZ[ny * W + nx];
                    if (!Number.isNaN(v)) { s += v; c++; }
                }
            }
            if (c > 0) filled[k] = s / c;
        }
    }

    // -----------------------------------------------------------------------
    // Roughness: local relief (3×3) + detrended RMS over a 5×5 window
    // -----------------------------------------------------------------------
    const relief = new Float32Array(W * H).fill(NaN);
    const rms = new Float32Array(W * H).fill(NaN);
    const R = 2; // 5×5 window for detrending
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const k = y * W + x;
            if (Number.isNaN(filled[k])) continue;
            // relief over 3×3
            let lo = Infinity;
            let hi = -Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const v = filled[ny * W + nx];
                    if (Number.isNaN(v)) continue;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
            }
            if (hi >= lo) relief[k] = hi - lo;
            // detrended RMS: fit plane z = a*dx + b*dy + c over window, RMS residual
            let n = 0;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let sxx = 0;
            let syy = 0;
            let sxy = 0;
            let sxz = 0;
            let syz = 0;
            for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const v = filled[ny * W + nx];
                    if (Number.isNaN(v)) continue;
                    n++;
                    sx += dx; sy += dy; sz += v;
                    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
                    sxz += dx * v; syz += dy * v;
                }
            }
            if (n >= 6) {
                // Solve normal equations (3×3) for [a,b,c]
                const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
                const bb = [sxz, syz, sz];
                const sol = solve3(A, bb);
                if (sol) {
                    const [a, b, c] = sol;
                    let ss = 0;
                    let m = 0;
                    for (let dy = -R; dy <= R; dy++) {
                        for (let dx = -R; dx <= R; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                            const v = filled[ny * W + nx];
                            if (Number.isNaN(v)) continue;
                            const res = v - (a * dx + b * dy + c);
                            ss += res * res;
                            m++;
                        }
                    }
                    rms[k] = Math.sqrt(ss / m);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Uniformity stats on ground density
    // -----------------------------------------------------------------------
    const gd = [];
    for (let k = 0; k < W * H; k++) if (countGround[k] > 0) gd.push(countGround[k] / cellArea);
    gd.sort((a, b) => a - b);
    const gdMean = gd.reduce((s, v) => s + v, 0) / gd.length;
    const gdStd = Math.sqrt(gd.reduce((s, v) => s + (v - gdMean) ** 2, 0) / gd.length);
    console.log('\n── Ground density uniformity (per '
        + `${CELL}×${CELL} m cell, ${gd.length} filled cells) ──`);
    console.log(`  mean ${gdMean.toFixed(2)}  std ${gdStd.toFixed(2)}  CV ${(gdStd / gdMean).toFixed(2)}`);
    console.log(`  p05 ${quantile(gd, 0.05).toFixed(2)}  p25 ${quantile(gd, 0.25).toFixed(2)}  `
        + `median ${quantile(gd, 0.5).toFixed(2)}  p75 ${quantile(gd, 0.75).toFixed(2)}  `
        + `p95 ${quantile(gd, 0.95).toFixed(2)}  max ${gd[gd.length - 1].toFixed(2)}`);

    // Roughness stats
    const rv = [];
    for (let k = 0; k < W * H; k++) if (!Number.isNaN(rms[k])) rv.push(rms[k]);
    rv.sort((a, b) => a - b);
    console.log('\n── Ground roughness (detrended RMS over 5×5, m) ──');
    console.log(`  median ${quantile(rv, 0.5).toFixed(3)}  p75 ${quantile(rv, 0.75).toFixed(3)}  `
        + `p90 ${quantile(rv, 0.9).toFixed(3)}  p95 ${quantile(rv, 0.95).toFixed(3)}  `
        + `p99 ${quantile(rv, 0.99).toFixed(3)}  max ${rv[rv.length - 1].toFixed(2)}`);
    const relv = [];
    for (let k = 0; k < W * H; k++) if (!Number.isNaN(relief[k])) relv.push(relief[k]);
    relv.sort((a, b) => a - b);
    console.log('── Local relief (3×3 max−min, m) ──');
    console.log(`  median ${quantile(relv, 0.5).toFixed(2)}  p90 ${quantile(relv, 0.9).toFixed(2)}  `
        + `p95 ${quantile(relv, 0.95).toFixed(2)}  p99 ${quantile(relv, 0.99).toFixed(2)}  `
        + `max ${relv[relv.length - 1].toFixed(2)}`);

    // -----------------------------------------------------------------------
    // Adaptive-decimation model
    //   target sample spacing s(cell) grows where the surface is smooth.
    //   Keep spacing <= a fraction of the wavelength implied by roughness.
    //   We model a per-cell target sample spacing driven by roughness:
    //     smooth ground (rough ≤ median) → S_COARSE (few points needed),
    //     rough ground  (rough ≥ p95)    → S_FINE   (keep the detail).
    //   kept-per-cell = min(nativeCount, cellArea / spacing²).
    // -----------------------------------------------------------------------
    const rMed = quantile(rv, 0.50) || 0.1;
    const rP95b = quantile(rv, 0.95) || 0.5;
    const S_FINE = 0.5; // 4 pts/m² kept where the ground is rough / cliffy
    const S_COARSE = 2.0; // 0.25 pts/m² kept where the ground is smooth
    const adaptStride = new Float32Array(W * H).fill(NaN);
    let keptAdaptive = 0;
    let keptFineUniform = 0; // keep S_FINE everywhere (worst-case detail, uniform)
    let keptCoarseUniform = 0; // keep S_COARSE everywhere (uniform, may lose cliffs)
    let groundConsidered = 0;
    for (let k = 0; k < W * H; k++) {
        if (countGround[k] === 0 || Number.isNaN(rms[k])) continue;
        groundConsidered += countGround[k];
        // 0 at rough≤median → 1 at rough≥p95
        const tRough = Math.max(0, Math.min(1, (rms[k] - rMed) / Math.max(1e-6, rP95b - rMed)));
        const spacing = S_COARSE + (S_FINE - S_COARSE) * tRough; // meters
        adaptStride[k] = spacing;
        keptAdaptive += Math.min(countGround[k], Math.max(1, Math.round(cellArea / (spacing * spacing))));
        keptFineUniform += Math.min(countGround[k], Math.max(1, Math.round(cellArea / (S_FINE * S_FINE))));
        keptCoarseUniform += Math.min(countGround[k], Math.max(1, Math.round(cellArea / (S_COARSE * S_COARSE))));
    }
    const pct = (n) => `${(100 * n / groundConsidered).toFixed(2)}%`;
    console.log('\n── Adaptive decimation model (ground surface for Poisson) ──');
    console.log(`  native ground: ${groundConsidered.toLocaleString()} pts `
        + `(${(groundConsidered / (2 * RADIUS * 2 * RADIUS)).toFixed(1)} pts/m², spacing ≈ `
        + `${Math.sqrt((2 * RADIUS * 2 * RADIUS) / groundConsidered).toFixed(2)} m)`);
    console.log(`  roughness anchors: median ${rMed.toFixed(2)} m → ${S_COARSE} m spacing,  `
        + `p95 ${rP95b.toFixed(2)} m → ${S_FINE} m spacing`);
    console.log(`  uniform @${S_COARSE} m   (0.25 pts/m²): ${keptCoarseUniform.toLocaleString()}  (${pct(keptCoarseUniform)})  — loses cliff detail`);
    console.log(`  uniform @${S_FINE} m   (4 pts/m²):    ${keptFineUniform.toLocaleString()}  (${pct(keptFineUniform)})  — keeps everything fine`);
    console.log(`  ROUGHNESS-ADAPTIVE:        ${keptAdaptive.toLocaleString()}  (${pct(keptAdaptive)})`);
    console.log(`  → adaptive uses ${(100 * keptAdaptive / Math.max(1, keptFineUniform)).toFixed(0)}% of the fine-uniform budget `
        + `for the same cliff detail (saves ${(100 * (1 - keptAdaptive / Math.max(1, keptFineUniform))).toFixed(0)}%).`);
    // Uniform-spacing reference sweep (kept fraction of native)
    console.log('  uniform-spacing reference (fraction of native ground kept):');
    for (const s of [0.25, 0.5, 1.0, 1.5, 2.0]) {
        let kept = 0;
        for (let k = 0; k < W * H; k++) {
            if (countGround[k] === 0) continue;
            kept += Math.min(countGround[k], Math.max(1, Math.round(cellArea / (s * s))));
        }
        console.log(`      s=${s.toFixed(2)} m → ${(1 / (s * s)).toFixed(2)} pts/m²  keeps ${pct(kept)}`);
    }

    // -----------------------------------------------------------------------
    // Render bitmaps
    // -----------------------------------------------------------------------
    const upE
        = (grid, colormap, vmax, gamma = 1) => {
            const rgb = new Uint8Array(W * H * 3);
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const k = y * W + x;
                    // flip Y so north is up
                    const outK = ((H - 1 - y) * W + x) * 3;
                    const v = grid[k];
                    if (Number.isNaN(v)) { rgb[outK] = 20; rgb[outK + 1] = 20; rgb[outK + 2] = 24; continue; }
                    const t = Math.pow(Math.min(1, v / vmax), gamma);
                    const [r, g, b] = lerpStops(t, colormap);
                    rgb[outK] = r; rgb[outK + 1] = g; rgb[outK + 2] = b;
                }
            }
            return rgb;
        };

    const dAllGrid = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) dAllGrid[k] = countAll[k] / cellArea;
    const dGroundGrid = new Float32Array(W * H).fill(NaN);
    for (let k = 0; k < W * H; k++) if (countGround[k] > 0) dGroundGrid[k] = countGround[k] / cellArea;

    const densMax = quantile([...dAllGrid].sort((a, b) => a - b), 0.98);
    writePng(`${OUT}/density-all.png`, W, H, upE(dAllGrid, VIRIDIS, densMax));
    const gdMax = quantile(gd, 0.98);
    writePng(`${OUT}/density-ground.png`, W, H, upE(dGroundGrid, VIRIDIS, gdMax));
    const rmsMax = quantile(rv, 0.97);
    writePng(`${OUT}/roughness-rms.png`, W, H, upE(rms, MAGMA, rmsMax, 0.7));
    const reliefMax = quantile(relv, 0.97);
    writePng(`${OUT}/roughness-relief.png`, W, H, upE(relief, MAGMA, reliefMax, 0.7));
    // adaptive spacing map (invert so red=keep dense)
    const keepDensity = new Float32Array(W * H).fill(NaN);
    for (let k = 0; k < W * H; k++) if (!Number.isNaN(adaptStride[k])) keepDensity[k] = 1 / (adaptStride[k] * adaptStride[k]);
    writePng(`${OUT}/adaptive-target-density.png`, W, H, upE(keepDensity, TURBO, 1 / (S_FINE * S_FINE), 0.6));

    // -----------------------------------------------------------------------
    // 2D heatmap: resolution (native ground density) vs roughness (RMS)
    // -----------------------------------------------------------------------
    const HB = 256; // heatmap size
    const heat = new Float64Array(HB * HB);
    const rmsCap = quantile(rv, 0.98);
    const densCap = quantile(gd, 0.98);
    for (let k = 0; k < W * H; k++) {
        if (countGround[k] === 0 || Number.isNaN(rms[k])) continue;
        const dens = countGround[k] / cellArea;
        const bx = Math.min(HB - 1, Math.floor((rms[k] / rmsCap) * HB));
        const by = Math.min(HB - 1, Math.floor((dens / densCap) * HB));
        heat[(HB - 1 - by) * HB + bx] += 1; // flip Y so density grows upward
    }
    const heatSorted = [...heat].filter((v) => v > 0).sort((a, b) => a - b);
    const heatMax = quantile(heatSorted, 0.99) || 1;
    const heatRgb = new Uint8Array(HB * HB * 3);
    for (let i = 0; i < HB * HB; i++) {
        const v = heat[i];
        const [r, g, b] = v === 0 ? [12, 12, 16] : lerpStops(Math.min(1, Math.log1p(v) / Math.log1p(heatMax)), TURBO);
        heatRgb[i * 3] = r; heatRgb[i * 3 + 1] = g; heatRgb[i * 3 + 2] = b;
    }
    writePng(`${OUT}/heatmap-resolution-vs-roughness.png`, HB, HB, heatRgb);
    console.log('\nBitmaps written to', OUT);
    console.log('  heatmap axes: X = roughness RMS 0..' + rmsCap.toFixed(2)
        + ' m, Y(up) = ground density 0..' + densCap.toFixed(1) + ' pts/m²');
}

/** Solve a 3×3 linear system A·x = b (Cramer). Returns null if singular. */
function solve3(A, b) {
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(A);
    if (Math.abs(d) < 1e-9) return null;
    const col = (m, i, v) => m.map((row, r) => row.map((val, c) => (c === i ? v[r] : val)));
    return [det(col(A, 0, b)) / d, det(col(A, 1, b)) / d, det(col(A, 2, b)) / d];
}

main().catch((e) => { console.error(e); process.exit(1); });
