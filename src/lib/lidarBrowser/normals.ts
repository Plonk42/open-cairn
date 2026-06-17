/**
 * Per-point normals via k-NN PCA. Port of
 * `services/lidar-cloud/server.mjs::computeNormalsKNN()`.
 *
 * Strategy: bucket points into a 3D uniform grid (cell size ≈ expected
 * neighborhood radius), then for each point gather up to k neighbors from
 * the 27 surrounding cells, compute the local covariance matrix and take
 * the eigenvector of its smallest eigenvalue as the surface normal.
 *
 * The whole thing is pure compute; runs about 2–4× slower than the Node
 * version in a Web Worker (TurboFan vs V8 optimizing both the same code,
 * but workers pay a small message-passing tax) — still well under a
 * second for typical IGN crops (≤ 100k points).
 */

import { buildFlightLines, type FlightLineModel, type ScanData } from './scanOrient';

/**
 * Smallest eigenvector of a 3×3 symmetric matrix
 * `[xx xy xz; xy yy yz; xz yz zz]` via Cardano + cross-product trick.
 * Returns a unit vector, falling back to `[0, 0, 1]` on degenerate input.
 *
 * When `outEig` is supplied it is filled with the three eigenvalues sorted
 * ascending by magnitude `[|λmin|, |λmid|, |λmax|]` (same scale as the input
 * matrix), used by the caller to derive a PCA-flatness quality score.
 */
function smallestEigenVec3(
    xx: number, yy: number, zz: number,
    xy: number, xz: number, yz: number,
    outEig?: Float64Array,
): [number, number, number] {
    const tr = xx + yy + zz;
    const p = xx * yy + xx * zz + yy * zz - xy * xy - xz * xz - yz * yz;
    const q = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
    const a = tr / 3;
    const P = p - tr * tr / 3;
    const Q = -q + (tr * p) / 3 - 2 * (tr * tr * tr) / 27;
    const halfP = P / 3;
    const halfQ = Q / 2;
    let l1: number, l2: number, l3: number;
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
    if (outEig) {
        const a1 = Math.abs(l1), a2 = Math.abs(l2), a3 = Math.abs(l3);
        outEig[0] = Math.min(a1, a2, a3);
        outEig[2] = Math.max(a1, a2, a3);
        outEig[1] = a1 + a2 + a3 - outEig[0] - outEig[2];
    }
    const m11 = xx - lambda, m12 = xy, m13 = xz;
    const m22 = yy - lambda, m23 = yz;
    const m33 = zz - lambda;
    // Try three row-pairs; pick the cross product with the largest norm.
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
    let nx: number, ny: number, nz: number, len2: number;
    if (n1 >= n2 && n1 >= n3) { nx = c1x; ny = c1y; nz = c1z; len2 = n1; }
    else if (n2 >= n3) { nx = c2x; ny = c2y; nz = c2z; len2 = n2; }
    else { nx = c3x; ny = c3y; nz = c3z; len2 = n3; }
    if (len2 < 1e-20) return [0, 0, 1];
    const inv = 1 / Math.sqrt(len2);
    return [nx * inv, ny * inv, nz * inv];
}

/**
 * Hash 3D cell coords to a Number key (kept inside the safe-integer range).
 * Layout: `(ix+10000) + (iy+10000)*1e5 + (iz+10000)*1e10`. Number keys are
 * ~10× faster than BigInt for `Map` operations.
 */
function cellKey(ix: number, iy: number, iz: number): number {
    return (ix + 10000) + (iy + 10000) * 100000 + (iz + 10000) * 10000000000;
}

/**
 * Compute per-point normals via k-NN PCA on a 3D uniform grid.
 *
 * @param positions   Interleaved (dx, dy, z) METER_OFFSETS float32.
 * @param k           Number of nearest neighbors to use (default 12).
 * @param cellSize    Grid cell size in meters (default 2).
 * @param forceUpward When true (default), flip each normal so nz ≥ 0.
 *                    Pass `false` for Poisson reconstruction — the caller
 *                    is responsible for running orientation propagation.
 * @param quality     Optional out-array (length n). When supplied, each entry
 *                    receives a PCA fit-quality score in [0, 1] combining the
 *                    local ellipsoid flatness with an outlier-rejection term —
 *                    used downstream to weight orientation votes and the final
 *                    Poisson confidence (normal magnitude).
 * @returns           Interleaved (nx, ny, nz) per point, normalized.
 */
export function computeNormalsKNN(
    positions: Float32Array,
    k = 12,
    cellSize = 2,
    forceUpward = true,
    quality?: Float32Array,
): Float32Array {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    if (n < 4) {
        for (let i = 0; i < n; i++) normals[i * 3 + 2] = 1;
        return normals;
    }

    // 1. Compute bounds (for the grid origin) and bucket points.
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
    const grid = new Map<number, number[]>();
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

    // 2. For each point, gather up to k neighbours from the 3×3×3 cell ring.
    const distBuf = new Float64Array(k);
    const idxBuf = new Int32Array(k);
    const eig = new Float64Array(3);
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

        // 3. Centroid + covariance over self + collected neighbours.
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

        const [nx, ny, nz] = smallestEigenVec3(cxx, cyy, czz, cxy, cxz, cyz, eig);
        if (quality) quality[i] = pcaQuality(eig, count, nx * (x - mx) + ny * (y - my) + nz * (z - mz));
        const s = forceUpward && nz < 0 ? -1 : 1;
        normals[i * 3] = nx * s;
        normals[i * 3 + 1] = ny * s;
        normals[i * 3 + 2] = nz * s;
    }
    return normals;
}

/**
 * PCA fit-quality heuristic (Boissonnat-style), in [0, 1]. Port of
 * `plane_fitting.h::quality()`.
 *
 * `qual1` rewards a flat ellipsoid (one eigenvalue much smaller than the other
 * two): `1 − λmin·λmax / λmid²`. `qual2` rejects the query point being an
 * outlier of its own neighbourhood: `1 − 3·d⊥² / λmax_mean`, where `d⊥` is the
 * point's perpendicular distance to the fitted plane. Eigenvalues come in the
 * matrix's sum-of-squares scale, so `λmax` is divided by `count` to compare it
 * against the (mean-scale) squared distance.
 */
function pcaQuality(eig: Float64Array, count: number, perpDist: number): number {
    const eMin = eig[0], eMid = eig[1], eMax = eig[2];
    const qual1 = eMid === 0 ? 0 : Math.max(1 - (eMin * eMax) / (eMid * eMid), 0);
    const eMaxMean = eMax / count;
    const qual2 = eMaxMean === 0 ? 0 : Math.max(1 - (3 * perpDist * perpDist) / eMaxMean, 0);
    return qual1 * qual2;
}

/** The 27 cell offsets of a 3×3×3 grid ring, precomputed to flatten loops. */
const CELL_RING_27: ReadonlyArray<readonly [number, number, number]> = (() => {
    const out: Array<[number, number, number]> = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) out.push([dx, dy, dz]);
        }
    }
    return out;
})();

/**
 * Transient working state for a single k-NN gather: the query point, the
 * neighbour count, and the partially-filled nearest-neighbour buffers plus the
 * running worst (largest-distance) slot.
 */
interface KnnQuery {
    i: number; x: number; y: number; z: number; k: number;
    dist: Float64Array; idx: Int32Array;
    maxDist: number; maxPos: number;
}

/**
 * Uniform 3D grid over a point set for fast k-NN gathers. Encapsulates the
 * bounds and bucket map so neighbour queries stay parameter-light. Mirrors the
 * grid built inline by `computeNormalsKNN`.
 */
class PointGrid {
    private readonly invCell: number;
    private readonly minX: number;
    private readonly minY: number;
    private readonly minZ: number;
    private readonly grid = new Map<number, number[]>();

    constructor(private readonly positions: Float32Array, cellSize: number) {
        const n = positions.length / 3;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        for (let i = 0; i < n; i++) {
            const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
        }
        this.minX = minX; this.minY = minY; this.minZ = minZ;
        this.invCell = 1 / cellSize;
        for (let i = 0; i < n; i++) {
            const key = cellKey(
                Math.floor((positions[i * 3] - minX) * this.invCell),
                Math.floor((positions[i * 3 + 1] - minY) * this.invCell),
                Math.floor((positions[i * 3 + 2] - minZ) * this.invCell),
            );
            let bucket = this.grid.get(key);
            if (!bucket) { bucket = []; this.grid.set(key, bucket); }
            bucket.push(i);
        }
    }

    /** Fill `idxBuf` with up to `neighbors` nearest neighbours of `i` (-1 padded). */
    gather(i: number, neighbors: number, distBuf: Float64Array, idxBuf: Int32Array): void {
        for (let h = 0; h < neighbors; h++) { distBuf[h] = Infinity; idxBuf[h] = -1; }
        const p = this.positions;
        const q: KnnQuery = {
            i, x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2], k: neighbors,
            dist: distBuf, idx: idxBuf, maxDist: Infinity, maxPos: 0,
        };
        const cx = Math.floor((q.x - this.minX) * this.invCell);
        const cy = Math.floor((q.y - this.minY) * this.invCell);
        const cz = Math.floor((q.z - this.minZ) * this.invCell);
        for (const off of CELL_RING_27) {
            const bucket = this.grid.get(cellKey(cx + off[0], cy + off[1], cz + off[2]));
            if (bucket) this.scanBucket(bucket, q);
        }
    }

    private scanBucket(bucket: number[], q: KnnQuery): void {
        const p = this.positions;
        for (const j of bucket) {
            if (j === q.i) continue;
            const ex = p[j * 3] - q.x, ey = p[j * 3 + 1] - q.y, ez = p[j * 3 + 2] - q.z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 >= q.maxDist) continue;
            q.dist[q.maxPos] = d2;
            q.idx[q.maxPos] = j;
            let m = -1, mp = 0;
            for (let h = 0; h < q.k; h++) {
                if (q.dist[h] > m) { m = q.dist[h]; mp = h; }
            }
            q.maxDist = m; q.maxPos = mp;
        }
    }
}

/**
 * Orientation state during the propagation cascade. Ordered so that
 * `state >= ST_ORIENTED` means "settled — may serve as a voting source".
 * Mirrors the `EOrient` enum of LidarTerrainMesh (`las_normal.cpp`).
 */
const ST_DEAD = 0;      // unsettled, no settled neighbour — skipped until revived
const ST_NONE = 1;      // unsettled, still on/near the frontier
const ST_TMP = 2;       // flipped this pass, not yet usable as a voting source
const ST_ORIENTED = 3;  // threshold: states ≥ this are settled voting sources
const ST_PLAGUE = 4;    // settled by propagation
const ST_Z = 5;         // settled by the +z heuristic
const ST_SCAN = 6;      // settled by the scan-angle (flight-line) cue

const SCAN_TOL = 0.25;
const Z_TOL = 0.55;
const FLIP_TOL = 0.7;
const PROPAGATE_NEIGHBORS = 16;
const MAX_PROPAGATE_PASSES = 50;

/** Shared working state threaded through the propagation passes. */
interface PropagateCtx {
    grid: PointGrid;
    normals: Float32Array;
    quality: Float32Array;
    state: Uint8Array;
    distBuf: Float64Array;
    idxBuf: Int32Array;
    toVisit: Uint8Array;
}

function flip(normals: Float32Array, i: number): void {
    normals[i * 3] *= -1;
    normals[i * 3 + 1] *= -1;
    normals[i * 3 + 2] *= -1;
}

/**
 * Scan-angle orientation pass — the strongest cue. For every point whose flight
 * line has a valid reconstructed azimuth, rebuild the laser-beam direction from
 * `(thetaAcross, scanAngle)` and flip the normal to face *back toward the
 * sensor* (a surface can only be observed from the side the beam came from).
 * Acts only when the alignment is confident relative to the point's fit quality.
 */
function orientWithScan(
    normals: Float32Array, quality: Float32Array, state: Uint8Array,
    scan: ScanData, model: FlightLineModel,
): void {
    const n = state.length;
    for (let i = 0; i < n; i++) {
        const fl = model.lines[model.sourceIdx[i]];
        if (!fl.valid) continue;
        const scanRad = scan.scanAngle[i] * Math.PI / 180;
        const sinA = Math.sin(scanRad);
        const bx = Math.cos(fl.thetaAcross) * sinA;
        const by = Math.sin(fl.thetaAcross) * sinA;
        const bz = -Math.cos(scanRad);
        const test = normals[i * 3] * bx + normals[i * 3 + 1] * by + normals[i * 3 + 2] * bz;
        if (Math.abs(test) > SCAN_TOL + 2 * (1 - quality[i])) {
            state[i] = ST_SCAN;
            if (test > 0) flip(normals, i);
        }
    }
}

/**
 * Positive-z pass — a geometric prior. Aerial LiDAR is seen from above, so a
 * confidently near-horizontal surface faces up. Seeds every such point (the
 * "multi-seed" of the cascade), with the confidence threshold relaxed for
 * low-quality fits so only trustworthy points are pinned.
 */
function orientWithZ(normals: Float32Array, quality: Float32Array, state: Uint8Array): void {
    const n = state.length;
    for (let i = 0; i < n; i++) {
        if (state[i] >= ST_Z) continue;
        const nz = normals[i * 3 + 2];
        if (Math.abs(nz) > Z_TOL + 2 * (1 - quality[i])) {
            state[i] = ST_Z;
            if (nz < 0) flip(normals, i);
        }
    }
}

/** Guarantee at least one settled seed so propagation always has a source. */
function ensureSeed(normals: Float32Array, state: Uint8Array): void {
    const n = state.length;
    for (let i = 0; i < n; i++) if (state[i] >= ST_ORIENTED) return;
    let best = -1, bestAbs = -1;
    for (let i = 0; i < n; i++) {
        const a = Math.abs(normals[i * 3 + 2]);
        if (a > bestAbs) { bestAbs = a; best = i; }
    }
    if (best < 0) return;
    state[best] = ST_Z;
    if (normals[best * 3 + 2] < 0) flip(normals, best);
}

/**
 * Try to settle one unsettled point by a quality-weighted majority vote over
 * its already-settled k-nearest neighbours. A neighbour only votes when the
 * normal agreement |n_i·n_k| clears a quality-scaled threshold, so ambiguous
 * crease crossings stay silent until both sides are firmly oriented. On a flip
 * the neighbourhood is marked `toVisit` to revive dead points next pass.
 */
function settlePoint(ctx: PropagateCtx, i: number): void {
    const { grid, normals, quality, state, distBuf, idxBuf, toVisit } = ctx;
    grid.gather(i, PROPAGATE_NEIGHBORS, distBuf, idxBuf);
    const nix = normals[i * 3], niy = normals[i * 3 + 1], niz = normals[i * 3 + 2];
    const qi = quality[i];
    let majority = 0, votes = 0;
    for (let h = 0; h < PROPAGATE_NEIGHBORS; h++) {
        const j = idxBuf[h];
        if (j < 0 || state[j] < ST_ORIENTED) continue;
        const test = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
        if (Math.abs(test) > FLIP_TOL + (1 - FLIP_TOL) * (1 - qi * quality[j])) {
            majority += test > 0 ? 1 : -1;
            votes++;
        }
    }
    if (majority === 0 || Math.abs(majority) < votes / 2) return;
    state[i] = ST_TMP;
    if (majority < 0) flip(normals, i);
    for (let h = 0; h < PROPAGATE_NEIGHBORS; h++) {
        const k = idxBuf[h];
        if (k >= 0) toVisit[k] = 1;
    }
}

/** One propagation sweep. Returns the number of points newly settled. */
function propagatePass(ctx: PropagateCtx): number {
    const { state, toVisit } = ctx;
    const n = state.length;
    toVisit.fill(0);
    for (let i = 0; i < n; i++) {
        if (state[i] >= ST_ORIENTED || state[i] === ST_DEAD) continue;
        settlePoint(ctx, i);
    }
    let newly = 0;
    for (let i = 0; i < n; i++) {
        if (state[i] < ST_TMP) state[i] = toVisit[i] ? ST_NONE : ST_DEAD;
        else if (state[i] === ST_TMP) { state[i] = ST_PLAGUE; newly++; }
    }
    return newly;
}

function countUnsettled(state: Uint8Array): number {
    let c = 0;
    for (const s of state) if (s < ST_ORIENTED) c++;
    return c;
}

/**
 * Final confidence weighting. PoissonRecon uses each input normal's *magnitude*
 * as the sample weight, so scaling by the PCA fit quality lets crisp, well-fit
 * points dominate the isosurface while noisy ones contribute softly. Points
 * that were never oriented get weight 0 — they add no (potentially wrong)
 * constraint and the solver interpolates across them.
 */
function weightByQuality(normals: Float32Array, quality: Float32Array, state: Uint8Array): void {
    const n = state.length;
    for (let i = 0; i < n; i++) {
        const w = state[i] >= ST_ORIENTED ? quality[i] : 0;
        normals[i * 3] *= w; normals[i * 3 + 1] *= w; normals[i * 3 + 2] *= w;
    }
}

/**
 * Orient unsigned PCA normals into a globally coherent gradient field for
 * Poisson reconstruction, then weight them by fit quality. Mutates `normals`
 * in place. Port of the orientation pipeline in
 * `LidarTerrainMesh/src/compute_normals.cpp`.
 *
 * Why this and not a plain "force nz ≥ 0": forcing every normal upward flips the
 * ones under overhangs, arches and cave roofs, so the solver can't represent
 * those cavities and seals them into smooth "bubbles". Instead we cascade a
 * consistent sign from the most trustworthy cues outward:
 *  1. **Scan angle** (if available): the laser-beam direction fixes the sign
 *     unambiguously, even on near-vertical cliffs the +z prior can't help.
 *  2. **Positive z**: confident near-horizontal points are pinned facing up.
 *  3. **Propagation**: a quality-weighted majority vote floods the orientation
 *     across the remaining points, resolving smooth links first and ambiguous
 *     creases last so a bad flip can't cascade.
 *  4. **Quality weighting**: normals are scaled by fit quality (Poisson reads
 *     magnitude as confidence); unsettled points are zeroed out.
 */
export function orientNormalsForPoisson(
    positions: Float32Array,
    normals: Float32Array,
    quality: Float32Array,
    scan: ScanData | null,
    cellSize = 3,
): void {
    const n = positions.length / 3;
    if (n < 4) return;
    const state = new Uint8Array(n).fill(ST_NONE);

    if (scan) {
        const model = buildFlightLines(positions, scan);
        orientWithScan(normals, quality, state, scan, model);
    }
    orientWithZ(normals, quality, state);
    ensureSeed(normals, state);

    const ctx: PropagateCtx = {
        grid: new PointGrid(positions, cellSize),
        normals, quality, state,
        distBuf: new Float64Array(PROPAGATE_NEIGHBORS),
        idxBuf: new Int32Array(PROPAGATE_NEIGHBORS),
        toVisit: new Uint8Array(n),
    };
    let unsettled = countUnsettled(state);
    let progress = 1;
    for (let pass = 1;
        unsettled > 0 && (progress > 0.0001 || pass < 10) && pass <= MAX_PROPAGATE_PASSES;
        pass++) {
        const settled = propagatePass(ctx);
        progress = unsettled > 0 ? settled / unsettled : 0;
        unsettled -= settled;
    }

    weightByQuality(normals, quality, state);
}
