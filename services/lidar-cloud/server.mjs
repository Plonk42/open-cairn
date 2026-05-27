// IGN LiDAR HD point cloud cropping service.
//
// Given a (lng, lat) center and a radius (meters), this service:
//   1. Queries the IGN WFS to find the LiDAR HD tile(s) covering the area.
//   2. Downloads each tile (cached on disk).
//   3. Decodes only the COPC octree nodes intersecting the crop bbox
//      (Lambert-93), decimates by `stride`, and emits a compact binary
//      payload of points encoded as METER_OFFSETS relative to the request
//      center.
//
// Binary response layout (little-endian unless noted):
//   uint32  magic = 0x4C494441 ("LIDA", big-endian read on client)
//   uint32  pointCount
//   float64 centerLng
//   float64 centerLat
//   float32[3 * pointCount]  positions  (dx_east_m, dy_north_m, alt_m)
//   uint8 [pointCount]       classifications (LAS ASPRS classes)
//
// Run:
//   node services/lidar-cloud/server.mjs
// Env:
//   PORT (default 8788)
//   CACHE_DIR (default ./.cache/lidar-cloud)
//   MAX_RADIUS_M (default 600)
//   MAX_TILES (default 9)

import { Copc, Getter, Key } from 'copc';
import Delaunator from 'delaunator';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import proj4 from 'proj4';

// EPSG:2154 — RGF93 / Lambert-93 (official IGN projection for metropolitan
// France LiDAR HD).
proj4.defs(
    'EPSG:2154',
    '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
);

const PORT = Number(process.env.PORT ?? 8788);
const CACHE_DIR = path.resolve(process.env.CACHE_DIR ?? './.cache/lidar-cloud');
const RESPONSE_CACHE_DIR = path.join(CACHE_DIR, 'responses');
const MAX_RADIUS_M = Number(process.env.MAX_RADIUS_M ?? 600);
const MAX_TILES = Number(process.env.MAX_TILES ?? 9);
const CACHE_MAX_BYTES = Number(process.env.CACHE_MAX_BYTES ?? 8 * 1024 * 1024 * 1024); // 8 GB

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const WFS_TYPENAME = 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle';

await mkdir(CACHE_DIR, { recursive: true });
await mkdir(RESPONSE_CACHE_DIR, { recursive: true });

/** @type {Map<string, Promise<string>>} */
const inflightDownloads = new Map();

// ─── Response cache ──────────────────────────────────────────────────────────
// Keyed by the request signature (mode, lng, lat, radius, stride, classes).
// Cached body bytes are streamed back verbatim on hit, skipping COPC decoding
// and normals/mesh computation entirely. This makes iteration on
// rendering-only changes (when refetching the same area) essentially instant.
const RESPONSE_CACHE_VERSION = 'v1';

/** @returns {string} 16-char hex cache key. */
function responseCacheKey(mode, lng, lat, radius, stride, classFilter) {
    const cls = classFilter ? [...classFilter].sort((a, b) => a - b).join(',') : 'all';
    const raw = [RESPONSE_CACHE_VERSION, mode, lng.toFixed(6), lat.toFixed(6), radius, stride, cls].join('|');
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** @returns {{body: string, meta: string}} */
function responseCachePaths(key) {
    return {
        body: path.join(RESPONSE_CACHE_DIR, `${key}.bin`),
        meta: path.join(RESPONSE_CACHE_DIR, `${key}.json`),
    };
}

/**
 * If a cached response exists for `key`, stream it back and return true.
 * Otherwise return false.
 */
async function tryServeCached(res, key) {
    const { body, meta } = responseCachePaths(key);
    if (!existsSync(body) || !existsSync(meta)) return false;
    try {
        const headers = JSON.parse(await readFile(meta, 'utf8'));
        res.writeHead(200, { ...headers, 'X-Cache': 'HIT' });
        await new Promise((resolve, reject) => {
            const stream = createReadStream(body);
            stream.on('end', resolve);
            stream.on('error', reject);
            stream.pipe(res, { end: true });
        });
        return true;
    } catch (err) {
        console.warn('[lidar-cloud] cache read failed', err);
        return false;
    }
}

/**
 * Persist headers + body bytes for future cache hits. Fire-and-forget;
 * errors are logged but never thrown.
 */
function writeCache(key, headers, bodyChunks) {
    const { body, meta } = responseCachePaths(key);
    const totalLen = bodyChunks.reduce((s, c) => s + c.byteLength, 0);
    const buf = Buffer.allocUnsafe(totalLen);
    let off = 0;
    for (const c of bodyChunks) {
        buf.set(c, off);
        off += c.byteLength;
    }
    Promise.all([
        writeFile(body, buf),
        writeFile(meta, JSON.stringify(headers)),
    ]).catch((err) => console.warn('[lidar-cloud] cache write failed', err));
}

/**
 * Query the IGN WFS for LiDAR HD tiles intersecting the WGS84 bbox.
 * @param {number} minLng @param {number} minLat @param {number} maxLng @param {number} maxLat
 * @returns {Promise<Array<{url: string, name: string}>>}
 */
async function findTiles(minLng, minLat, maxLng, maxLat) {
    const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typenames: WFS_TYPENAME,
        srsname: 'EPSG:4326',
        // The IGN WFS always uses lng,lat axis order for the bbox parameter,
        // regardless of the srsname (verified empirically against
        // GetCapabilities + a known-covered tile near Chamrousse).
        bbox: `${minLng},${minLat},${maxLng},${maxLat},EPSG:4326`,
        outputFormat: 'application/json',
        count: String(MAX_TILES + 5),
    });
    const url = `${WFS_URL}?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        throw new Error(`WFS GetFeature failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    /** @type {Array<{url:string,name:string}>} */
    const tiles = [];
    for (const f of features) {
        const props = f?.properties ?? {};
        // The IGN WFS exposes the download URL under several possible names
        // depending on the year (url, url_telech, name). We pick the first
        // value that looks like a .laz/.copc.laz URL.
        const candidates = [props.url, props.url_telech, props.name, ...Object.values(props)];
        const lazUrl = candidates.find(
            (v) => typeof v === 'string' && /^https?:\/\/.+\.(copc\.)?laz$/i.test(v),
        );
        if (!lazUrl) continue;
        const name = (props.name && String(props.name)) || path.basename(lazUrl);
        tiles.push({ url: lazUrl, name });
        if (tiles.length >= MAX_TILES) break;
    }
    return tiles;
}

/** Sanitize a URL into a safe local filename. */
function tileCacheName(url) {
    const base = path.basename(url).replace(/[^\w.-]/g, '_');
    return base.length > 4 ? base : `tile_${Buffer.from(url).toString('base64url').slice(0, 32)}.laz`;
}

/**
 * Evict oldest cached files when total size exceeds CACHE_MAX_BYTES.
 */
async function evictCache() {
    try {
        const entries = await readdir(CACHE_DIR);
        const items = [];
        let total = 0;
        for (const name of entries) {
            const p = path.join(CACHE_DIR, name);
            try {
                const s = await stat(p);
                if (!s.isFile()) continue;
                items.push({ p, size: s.size, atime: s.atimeMs });
                total += s.size;
            } catch { /* ignore */ }
        }
        if (total <= CACHE_MAX_BYTES) return;
        items.sort((a, b) => a.atime - b.atime);
        while (total > CACHE_MAX_BYTES && items.length > 0) {
            const it = items.shift();
            if (!it) break;
            try {
                await rm(it.p);
                total -= it.size;
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

/**
 * Download a LAZ tile to the local cache (or return the cached path).
 * Concurrent requests for the same URL are deduplicated.
 * @param {string} url @returns {Promise<string>}
 */
function getTile(url) {
    const dest = path.join(CACHE_DIR, tileCacheName(url));
    const inflight = inflightDownloads.get(dest);
    if (inflight) return inflight;
    const job = (async () => {
        try {
            const s = await stat(dest);
            if (s.size > 0) return dest;
        } catch { /* not cached */ }
        const t0 = Date.now();
        console.log(`[lidar-cloud] downloading ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Tile download ${res.status} ${res.statusText} for ${url}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buf);
        console.log(
            `[lidar-cloud] downloaded ${url} (${(buf.length / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        evictCache().catch(() => { });
        return dest;
    })();
    inflightDownloads.set(dest, job);
    job.finally(() => inflightDownloads.delete(dest));
    return job;
}

/**
 * Compute the 3D bounds of a COPC node from its octree key.
 * @param {{d:number,x:number,y:number,z:number}} key
 * @param {number[]} cube root cube [minx, miny, minz, maxx, maxy, maxz]
 * @returns {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}}
 */
function nodeBounds(key, cube) {
    const span = 1 << key.d;
    const sx = (cube[3] - cube[0]) / span;
    const sy = (cube[4] - cube[1]) / span;
    const sz = (cube[5] - cube[2]) / span;
    const minX = cube[0] + key.x * sx;
    const minY = cube[1] + key.y * sy;
    const minZ = cube[2] + key.z * sz;
    return { minX, minY, minZ, maxX: minX + sx, maxY: minY + sy, maxZ: minZ + sz };
}

/**
 * Walk the COPC hierarchy from the root page, descending only into branches
 * intersecting the XY query bbox. Sub-pages are loaded lazily.
 * @param {ReturnType<typeof Getter.create>} get
 * @param {Awaited<ReturnType<typeof Copc.create>>} copc
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bbox
 * @returns {Promise<Array<{key:string, node:{pointCount:number, pointDataOffset:number, pointDataLength:number}}>>}
 */
async function collectIntersectingNodes(get, copc, bbox) {
    /** @type {Array<{key:string, node:any}>} */
    const out = [];
    /** @type {string[]} */
    const pageQueue = ['0-0-0-0'];
    /** @type {Record<string, any>} */
    const knownPages = { '0-0-0-0': copc.info.rootHierarchyPage };
    while (pageQueue.length > 0) {
        const pageKey = pageQueue.shift();
        if (pageKey === undefined) break;
        const pageRef = knownPages[pageKey];
        if (!pageRef) continue;
        const { nodes, pages } = await Copc.loadHierarchyPage(get, pageRef);
        for (const [keyStr, node] of Object.entries(nodes)) {
            if (!node) continue;
            // Skip empty hierarchy entries — the file getter throws
            // RangeError on createReadStream when length is 0.
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
 * Decode a COPC LAZ tile, crop to the Lambert-93 bbox, decimate, and produce
 * METER_OFFSETS-relative positions (dx east, dy north, dz up). Uses the COPC
 * octree to decode only the nodes intersecting the crop region.
 * @param {string} tilePath
 * @param {number} x0 Lambert-93 X of the request center
 * @param {number} y0 Lambert-93 Y of the request center
 * @param {number} radius radius in meters (square bbox of side 2*radius)
 * @param {number} stride 1 = keep all, N = keep one in N (after bbox filter)
 * @param {Set<number>|null} classFilter LAS classifications to keep, or null = all
 * @returns {Promise<{positions: Float32Array, classifications: Uint8Array}>}
 */
async function extractPoints(tilePath, x0, y0, radius, stride, classFilter) {
    const t0 = Date.now();
    const get = Getter.create(tilePath);
    const copc = await Copc.create(get);
    const bbox = {
        minX: x0 - radius,
        maxX: x0 + radius,
        minY: y0 - radius,
        maxY: y0 + radius,
    };
    const nodes = await collectIntersectingNodes(get, copc, bbox);
    const safeStride = Math.max(1, Math.floor(stride));

    /**
     * Process a single COPC node: load points, filter, decimate.
     * Returns { positions: Float32Array, classifications: Uint8Array, scanned: number }.
     */
    async function processNode(node) {
        const view = await Copc.loadPointDataView(get, copc, node);
        const getX = view.getter('X');
        const getY = view.getter('Y');
        const getZ = view.getter('Z');
        const hasClass = view.dimensions.Classification !== undefined;
        const getC = hasClass ? view.getter('Classification') : null;
        const n = view.pointCount;

        // Preallocate to upper bound (ceil(n / stride)) and use a write
        // pointer; far faster than pushing to a regular JS array (which
        // grows + boxes doubles + needs a final copy into a typed array).
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
            scanned: n,
        };
    }

    // Process all nodes in parallel (I/O interleaving).
    const results = await Promise.all(nodes.map(({ node }) => processNode(node)));

    let totalScanned = 0;
    let totalKept = 0;
    /** @type {Float32Array[]} */
    const posChunks = [];
    /** @type {Uint8Array[]} */
    const clsChunks = [];
    for (const r of results) {
        totalScanned += r.scanned;
        if (r.classifications.length > 0) {
            posChunks.push(r.positions);
            clsChunks.push(r.classifications);
            totalKept += r.classifications.length;
        }
    }

    const outPos = new Float32Array(totalKept * 3);
    const outCls = new Uint8Array(totalKept);
    let offP = 0;
    let offC = 0;
    for (let i = 0; i < posChunks.length; i++) {
        outPos.set(posChunks[i], offP);
        outCls.set(clsChunks[i], offC);
        offP += posChunks[i].length;
        offC += clsChunks[i].length;
    }
    console.log(
        `[lidar-cloud] ${path.basename(tilePath)}: ${nodes.length} node(s), ${totalScanned.toLocaleString()} pts scanned → ${totalKept.toLocaleString()} kept in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    return { positions: outPos, classifications: outCls };
}

// ============================================================
// Mesh builder (2.5D Delaunay + slope coloration)
// ============================================================

// Slope-based color palette inspired by the CloudCompare renders
// shared on the Camptocamp LiDAR HD forum thread. Slope is the
// angle between the local surface normal and the vertical Z axis
// (0 = horizontal ground, 90 = vertical cliff).
/** @type {Array<[number, [number,number,number]]>} */
const SLOPE_PALETTE = [
    [0, [230, 220, 200]], // gentle: pale sand
    [20, [205, 175, 130]], // 20°: warm tan
    [35, [170, 120, 75]], // 35°: brown
    [55, [120, 75, 45]], // 55°: deep brown
    [80, [70, 45, 30]], // near-vertical: dark
];

/**
 * Interpolate the slope palette for a given slope angle (radians).
 * @param {number} slopeRad
 * @returns {[number,number,number]}
 */
function slopeColor(slopeRad) {
    const slopeDeg = slopeRad * (180 / Math.PI);
    if (slopeDeg <= SLOPE_PALETTE[0][0]) return SLOPE_PALETTE[0][1];
    for (let i = 1; i < SLOPE_PALETTE.length; i++) {
        const [degHi, colHi] = SLOPE_PALETTE[i];
        if (slopeDeg <= degHi) {
            const [degLo, colLo] = SLOPE_PALETTE[i - 1];
            const t = (slopeDeg - degLo) / (degHi - degLo);
            return [
                Math.round(colLo[0] + (colHi[0] - colLo[0]) * t),
                Math.round(colLo[1] + (colHi[1] - colLo[1]) * t),
                Math.round(colLo[2] + (colHi[2] - colLo[2]) * t),
            ];
        }
    }
    return SLOPE_PALETTE[SLOPE_PALETTE.length - 1][1];
}

/**
 * Build a triangulated 2.5D mesh from the cropped points. Uses Delaunator
 * on (x, y) and filters out triangles whose longest edge exceeds
 * `maxEdge` meters (those would span gaps such as occluded cliff bases or
 * empty no-data areas).
 *
 * @param {Float32Array} positions interleaved (dx, dy, z) meters (METER_OFFSETS)
 * @param {number} maxEdge meters; triangles with longer edges are dropped
 * @returns {{positions: Float32Array, normals: Float32Array, colors: Uint8Array, indices: Uint32Array}}
 */
function buildMesh(positions, maxEdge) {
    const n = positions.length / 3;
    if (n < 3) {
        return {
            positions: new Float32Array(0),
            normals: new Float32Array(0),
            colors: new Uint8Array(0),
            indices: new Uint32Array(0),
        };
    }
    const xy = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        xy[i * 2] = positions[i * 3];
        xy[i * 2 + 1] = positions[i * 3 + 1];
    }
    const d = new Delaunator(xy);
    const tris = d.triangles; // Uint32Array
    const maxEdgeSq = maxEdge * maxEdge;

    const normals = new Float32Array(n * 3);
    /** @type {number[]} */
    const keep = [];
    for (let t = 0; t < tris.length; t += 3) {
        const ia = tris[t];
        const ib = tris[t + 1];
        const ic = tris[t + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const eABx = bx - ax, eABy = by - ay;
        const eBCx = cx - bx, eBCy = cy - by;
        const eCAx = ax - cx, eCAy = ay - cy;
        if (
            eABx * eABx + eABy * eABy > maxEdgeSq ||
            eBCx * eBCx + eBCy * eBCy > maxEdgeSq ||
            eCAx * eCAx + eCAy * eCAy > maxEdgeSq
        ) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        // Ensure upward-pointing (LiDAR is acquired from above).
        const sign = nz < 0 ? -1 : 1;
        const nnx = nx * sign, nny = ny * sign, nnz = nz * sign;
        normals[ia * 3] += nnx; normals[ia * 3 + 1] += nny; normals[ia * 3 + 2] += nnz;
        normals[ib * 3] += nnx; normals[ib * 3 + 1] += nny; normals[ib * 3 + 2] += nnz;
        normals[ic * 3] += nnx; normals[ic * 3 + 1] += nny; normals[ic * 3 + 2] += nnz;
        keep.push(ia, ib, ic);
    }

    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            normals[i * 3 + 2] = 1;
        }
    }

    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nz = Math.max(-1, Math.min(1, normals[i * 3 + 2]));
        const slope = Math.acos(Math.abs(nz));
        const [r, g, b] = slopeColor(slope);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }

    return { positions, normals, colors, indices: new Uint32Array(keep) };
}

function parseClassFilter(raw) {
    if (!raw) return null;
    const ids = raw
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    return ids.length > 0 ? new Set(ids) : null;
}

// ============================================================
// k-NN PCA per-point normals (for shaded point-cloud rendering)
// ============================================================

/**
 * Smallest eigenvector of a 3x3 symmetric matrix
 * [xx xy xz; xy yy yz; xz yz zz] via Cardano + cross-product.
 * Returns a unit vector (defaults to [0,0,1] if degenerate).
 */
function smallestEigenVec3(xx, yy, zz, xy, xz, yz) {
    const tr = xx + yy + zz;
    const p = xx * yy + xx * zz + yy * zz - xy * xy - xz * xz - yz * yz;
    const q = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
    const a = tr / 3;
    const P = p - tr * tr / 3;
    const Q = -q + (tr * p) / 3 - 2 * (tr * tr * tr) / 27;
    const halfP = P / 3;
    const halfQ = Q / 2;
    let l1, l2, l3;
    if (halfP >= 0) {
        l1 = l2 = l3 = a;
    } else {
        const r = Math.sqrt(-halfP * halfP * halfP);
        const cosPhi = Math.max(-1, Math.min(1, -halfQ / r));
        const phi = Math.acos(cosPhi) / 3;
        const m = 2 * Math.cbrt(r);
        l1 = a + m * Math.cos(phi);
        l2 = a + m * Math.cos(phi + 2 * Math.PI / 3);
        l3 = a + m * Math.cos(phi + 4 * Math.PI / 3);
    }
    const lambda = Math.min(l1, l2, l3);
    const m11 = xx - lambda, m12 = xy, m13 = xz;
    const m22 = yy - lambda, m23 = yz;
    const m33 = zz - lambda;
    // Try three pairs of rows; pick the cross product with the largest norm.
    const c1x = m12 * m23 - m13 * m22;
    const c1y = m13 * m12 - m11 * m23;
    const c1z = m11 * m22 - m12 * m12;
    const c2x = m12 * m33 - m13 * m23;
    const c2y = m13 * m13 - m11 * m33;
    const c2z = m11 * m23 - m13 * m12;
    const c3x = m22 * m33 - m23 * m23;
    const c3y = m23 * m13 - m12 * m33;
    const c3z = m12 * m23 - m22 * m13;
    const n1 = c1x * c1x + c1y * c1y + c1z * c1z;
    const n2 = c2x * c2x + c2y * c2y + c2z * c2z;
    const n3 = c3x * c3x + c3y * c3y + c3z * c3z;
    let nx, ny, nz, len2;
    if (n1 >= n2 && n1 >= n3) { nx = c1x; ny = c1y; nz = c1z; len2 = n1; }
    else if (n2 >= n3) { nx = c2x; ny = c2y; nz = c2z; len2 = n2; }
    else { nx = c3x; ny = c3y; nz = c3z; len2 = n3; }
    if (len2 < 1e-20) return [0, 0, 1];
    const inv = 1 / Math.sqrt(len2);
    return [nx * inv, ny * inv, nz * inv];
}

/**
 * Hash 3D cell coords to a single Number key (safe integer range).
 * Layout: ix + iy * 100000 + iz * 10_000_000_000, with +10000 offsets so
 * negative indices become non-negative. Max key < 2^53 for grids up to
 * ~20000 cells per axis. Number keys make Map.get ~10x faster than BigInt.
 */
function cellKey(ix, iy, iz) {
    return (ix + 10000) + (iy + 10000) * 100000 + (iz + 10000) * 10000000000;
}

/**
 * Compute per-point normals via k-NN PCA. Uses a uniform 3D grid for
 * neighbor lookup (cell size ≈ expected neighborhood radius). The normal
 * is the eigenvector of the smallest eigenvalue of the local covariance
 * matrix, flipped so that nz ≥ 0 for consistent shading on quasi-vertical
 * surfaces.
 *
 * Optimized: uses numeric BigInt keys instead of string concatenation
 * for ~2x faster grid lookups.
 *
 * @param {Float32Array} positions Interleaved (dx, dy, z) METER_OFFSETS.
 * @param {number} k Number of nearest neighbors to use (default 12).
 * @param {number} cellSize Grid cell size in meters (default 2).
 * @returns {Float32Array} interleaved (nx, ny, nz) per point.
 */
function computeNormalsKNN(positions, k = 12, cellSize = 2.0) {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    if (n < 4) {
        for (let i = 0; i < n; i++) normals[i * 3 + 2] = 1;
        return normals;
    }

    // 1. Build a uniform grid keyed by numeric hash.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
    }
    const invCell = 1 / cellSize;
    /** @type {Map<bigint, number[]>} */
    const grid = new Map();
    const cellIx = new Int32Array(n);
    const cellIy = new Int32Array(n);
    const cellIz = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        const ix = Math.floor((positions[i * 3] - minX) * invCell);
        const iy = Math.floor((positions[i * 3 + 1] - minY) * invCell);
        const iz = Math.floor((positions[i * 3 + 2] - minZ) * invCell);
        cellIx[i] = ix;
        cellIy[i] = iy;
        cellIz[i] = iz;
        const key = cellKey(ix, iy, iz);
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(i);
    }

    // 2. For each point, find up to k nearest neighbors in the 3x3x3 cell
    //    neighborhood. Use a fixed-size "running k-max" array.
    const distBuf = new Float64Array(k);
    const idxBuf = new Int32Array(k);
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const cx = cellIx[i], cy = cellIy[i], cz = cellIz[i];
        for (let h = 0; h < k; h++) { distBuf[h] = Infinity; idxBuf[h] = -1; }
        let maxDist = Infinity;
        let maxPos = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
                    if (!bucket) continue;
                    for (let bi = 0; bi < bucket.length; bi++) {
                        const j = bucket[bi];
                        if (j === i) continue;
                        const ex = positions[j * 3] - x;
                        const ey = positions[j * 3 + 1] - y;
                        const ez = positions[j * 3 + 2] - z;
                        const d2 = ex * ex + ey * ey + ez * ez;
                        if (d2 >= maxDist) continue;
                        distBuf[maxPos] = d2;
                        idxBuf[maxPos] = j;
                        // Find new running max in distBuf.
                        let m = -1;
                        let mp = 0;
                        for (let h = 0; h < k; h++) {
                            if (distBuf[h] > m) { m = distBuf[h]; mp = h; }
                        }
                        maxDist = m;
                        maxPos = mp;
                    }
                }
            }
        }

        // 3. Compute centroid + covariance from collected neighbors + self.
        let mx = x, my = y, mz = z, count = 1;
        for (let h = 0; h < k; h++) {
            const j = idxBuf[h];
            if (j < 0) continue;
            mx += positions[j * 3];
            my += positions[j * 3 + 1];
            mz += positions[j * 3 + 2];
            count++;
        }
        if (count < 4) {
            normals[i * 3 + 2] = 1;
            continue;
        }
        mx /= count; my /= count; mz /= count;

        let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
        {
            const ex = x - mx, ey = y - my, ez = z - mz;
            cxx += ex * ex; cyy += ey * ey; czz += ez * ez;
            cxy += ex * ey; cxz += ex * ez; cyz += ey * ez;
        }
        for (let h = 0; h < k; h++) {
            const j = idxBuf[h];
            if (j < 0) continue;
            const ex = positions[j * 3] - mx;
            const ey = positions[j * 3 + 1] - my;
            const ez = positions[j * 3 + 2] - mz;
            cxx += ex * ex; cyy += ey * ey; czz += ez * ez;
            cxy += ex * ey; cxz += ex * ez; cyz += ey * ez;
        }

        const [nx, ny, nz] = smallestEigenVec3(cxx, cyy, czz, cxy, cxz, cyz);
        const s = nz < 0 ? -1 : 1;
        normals[i * 3] = nx * s;
        normals[i * 3 + 1] = ny * s;
        normals[i * 3 + 2] = nz * s;
    }
    return normals;
}

/**
 * Per-point RGBA from normals, using the slope palette.
 * @param {Float32Array} normals
 * @returns {Uint8Array}
 */
function colorsFromNormals(normals) {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nz = Math.max(-1, Math.min(1, normals[i * 3 + 2]));
        const slope = Math.acos(Math.abs(nz));
        const [r, g, b] = slopeColor(slope);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }
    return colors;
}

function sendJson(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/api/lidar-cloud/health') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (url.pathname !== '/api/lidar-cloud') {
        sendJson(res, 404, { error: 'Not found' });
        return;
    }

    const t0 = Date.now();
    try {
        const lng = Number(url.searchParams.get('lng'));
        const lat = Number(url.searchParams.get('lat'));
        const radius = Math.min(
            MAX_RADIUS_M,
            Math.max(20, Number(url.searchParams.get('radius') ?? '250')),
        );
        const stride = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('stride') ?? '10', 10)));
        const mode = (url.searchParams.get('mode') ?? 'cloud').toLowerCase();
        const classFilter = parseClassFilter(url.searchParams.get('class'));

        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            sendJson(res, 400, { error: 'lng and lat are required' });
            return;
        }

        // Try the response cache before doing any work. The cache key includes
        // all parameters that influence the bytes, so a hit is byte-equivalent.
        const cacheKey = responseCacheKey(mode, lng, lat, radius, stride, classFilter);
        if (await tryServeCached(res, cacheKey)) {
            console.log(
                `[lidar-cloud] cache HIT ${cacheKey} (${mode}, lng=${lng.toFixed(5)} lat=${lat.toFixed(5)} r=${radius}m stride=${stride}) in ${((Date.now() - t0) / 1000).toFixed(2)}s`,
            );
            return;
        }

        const [x0, y0] = proj4('EPSG:4326', 'EPSG:2154', [lng, lat]);

        // Convert radius (meters) to a WGS84 lat/lng buffer big enough to
        // bracket the L93 bbox after reprojection. We pad by 20 % to be safe.
        const dLat = (radius * 1.2) / 111_320;
        const dLng = (radius * 1.2) / (111_320 * Math.cos((lat * Math.PI) / 180));
        const tiles = await findTiles(lng - dLng, lat - dLat, lng + dLng, lat + dLat);
        console.log(
            `[lidar-cloud] request lng=${lng.toFixed(5)} lat=${lat.toFixed(5)} r=${radius}m stride=${stride} → ${tiles.length} tile(s)`,
        );

        if (tiles.length === 0) {
            sendJson(res, 404, {
                error: 'no_lidar_tile',
                message: 'Aucune dalle LiDAR HD IGN ne couvre cette zone (acquisition non encore disponible).',
            });
            return;
        }

        // Download all tiles in parallel (deduplication already handled in getTile).
        const tilePaths = await Promise.all(tiles.map((tile) => getTile(tile.url)));

        // Extract points from all tiles in parallel.
        const results = await Promise.all(
            tilePaths.map((tilePath) => extractPoints(tilePath, x0, y0, radius, stride, classFilter))
        );

        /** @type {Float32Array[]} */
        const posParts = [];
        /** @type {Uint8Array[]} */
        const clsParts = [];
        for (const out of results) {
            if (out.positions.length > 0) {
                posParts.push(out.positions);
                clsParts.push(out.classifications);
            }
        }

        const totalPts = clsParts.reduce((a, c) => a + c.length, 0);
        const positions = new Float32Array(totalPts * 3);
        const classifications = new Uint8Array(totalPts);
        let pOff = 0;
        let cOff = 0;
        for (let i = 0; i < posParts.length; i++) {
            positions.set(posParts[i], pOff);
            pOff += posParts[i].length;
            classifications.set(clsParts[i], cOff);
            cOff += clsParts[i].length;
        }

        if (mode === 'shaded') {
            const tN = Date.now();
            const normals = computeNormalsKNN(positions, 12, 2);
            const colors = colorsFromNormals(normals);
            console.log(
                `[lidar-cloud] normals for ${totalPts.toLocaleString()} pts in ${((Date.now() - tN) / 1000).toFixed(1)}s`,
            );
            const shHeader = Buffer.alloc(24);
            shHeader.writeUInt32BE(0x4c494453, 0);    // "LIDS"
            shHeader.writeUInt32LE(totalPts, 4);
            shHeader.writeDoubleLE(lng, 8);
            shHeader.writeDoubleLE(lat, 16);
            const shHeaders = {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*',
                'X-Point-Count': String(totalPts),
                'X-Tile-Count': String(tiles.length),
            };
            const shBody = [
                shHeader,
                Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
                Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
                Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength),
                Buffer.from(classifications.buffer, classifications.byteOffset, classifications.byteLength),
            ];
            res.writeHead(200, shHeaders);
            for (const part of shBody) res.write(part);
            res.end();
            writeCache(cacheKey, shHeaders, shBody);
            const totalBytes = positions.byteLength + normals.byteLength + colors.byteLength + classifications.byteLength;
            console.log(
                `[lidar-cloud] sent shaded ${totalPts.toLocaleString()} pts (${(totalBytes / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
            );
            return;
        }

        if (mode === 'mesh') {
            const tMesh = Date.now();
            // Edge-length threshold: ~10x median spacing for 10 pt/m² IGN data
            // is ~3 m. With decimation we scale up. Min 1.5 m, max 8 m.
            const expectedSpacing = Math.sqrt(stride / 10); // meters (rough)
            const maxEdge = Math.min(8, Math.max(1.5, expectedSpacing * 10));
            const mesh = buildMesh(positions, maxEdge);
            const triCount = mesh.indices.length / 3;
            console.log(
                `[lidar-cloud] meshed ${totalPts.toLocaleString()} verts → ${triCount.toLocaleString()} tris (maxEdge=${maxEdge.toFixed(1)}m) in ${((Date.now() - tMesh) / 1000).toFixed(1)}s`,
            );
            const meshHeader = Buffer.alloc(28);
            meshHeader.writeUInt32BE(0x4c49444d, 0);    // "LIDM"
            meshHeader.writeUInt32LE(totalPts, 4);      // vertex count
            meshHeader.writeUInt32LE(triCount, 8);      // triangle count
            meshHeader.writeDoubleLE(lng, 12);
            meshHeader.writeDoubleLE(lat, 20);
            const meshHeaders = {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*',
                'X-Vertex-Count': String(totalPts),
                'X-Triangle-Count': String(triCount),
            };
            const meshBody = [
                meshHeader,
                Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength),
                Buffer.from(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength),
                Buffer.from(mesh.colors.buffer, mesh.colors.byteOffset, mesh.colors.byteLength),
                Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength),
            ];
            res.writeHead(200, meshHeaders);
            for (const part of meshBody) res.write(part);
            res.end();
            writeCache(cacheKey, meshHeaders, meshBody);
            const totalBytes = mesh.positions.byteLength + mesh.normals.byteLength + mesh.colors.byteLength + mesh.indices.byteLength;
            console.log(
                `[lidar-cloud] sent mesh ${totalPts.toLocaleString()} verts / ${triCount.toLocaleString()} tris (${(totalBytes / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
            );
            return;
        }

        const header = Buffer.alloc(24);
        header.writeUInt32BE(0x4c494441, 0);    // "LIDA"
        header.writeUInt32LE(totalPts, 4);
        header.writeDoubleLE(lng, 8);
        header.writeDoubleLE(lat, 16);

        const cloudHeaders = {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'X-Point-Count': String(totalPts),
            'X-Tile-Count': String(tiles.length),
        };
        const cloudBody = [
            header,
            Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
            Buffer.from(classifications.buffer, classifications.byteOffset, classifications.byteLength),
        ];
        res.writeHead(200, cloudHeaders);
        for (const part of cloudBody) res.write(part);
        res.end();
        writeCache(cacheKey, cloudHeaders, cloudBody);
        console.log(
            `[lidar-cloud] sent ${totalPts.toLocaleString()} pts (${((positions.byteLength + classifications.byteLength) / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
    } catch (err) {
        console.error('[lidar-cloud] error', err);
        sendJson(res, 500, { error: 'server_error', message: String(err?.message ?? err) });
    }
});

server.listen(PORT, () => {
    console.log(`[lidar-cloud] listening on http://localhost:${PORT}`);
    console.log(`[lidar-cloud] cache dir: ${CACHE_DIR}`);
});
