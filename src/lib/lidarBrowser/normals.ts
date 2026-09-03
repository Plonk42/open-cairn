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
 * CSR (compressed-sparse-row) spatial hash grid: counting-sorts point indices
 * into per-cell contiguous runs of a single `Int32Array`, replacing the
 * bucket-per-cell `Map<number, number[]>` scheme (one small boxed array per
 * populated cell — significant allocation/GC pressure at 10M+ points) with two
 * flat typed arrays plus a `Map<number, number>` from cell key to dense cell id
 * (still needed since world space is sparse, but each entry is now a single
 * integer instead of an array).
 *
 * Points are counting-sorted in ascending original-index order within each
 * cell — the same order the old `bucket.push(i)` scheme produced — so the
 * k-NN candidate iteration order (and therefore the exact floating-point
 * results, since accumulation is not associative) is unchanged.
 *
 * Shared by `computeNormalsKNN` (bulk PCA pass) and `PointGrid` (propagation
 * gather in `orientNormalsForPoisson`).
 */
class CsrGrid {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly invCell: number;
    /** `cellStart[d]..cellStart[d+1]` is the slice of `cellPoints` for dense cell `d`. */
    readonly cellStart: Int32Array;
    readonly cellPoints: Int32Array;
    private readonly cellIndex = new Map<number, number>();

    /**
     * `origin`, when supplied, fixes the grid's world-space origin instead of
     * deriving it from `positions`' own bounds. Required for the parallel
     * (Phase 2) path: each worker builds a grid over a small tile+halo subset
     * of points, but that subset's cell assignment must line up exactly with
     * the origin the full-cloud sequential grid would have used — otherwise
     * cell boundaries shift and the 3×3×3 ring can silently gather a
     * different candidate set, breaking exact parity with the sequential
     * result. See `normalsTiling.ts` for how the halo is sized to compensate.
     */
    constructor(positions: Float32Array, cellSize: number, origin?: { minX: number; minY: number; minZ: number }) {
        const n = positions.length / 3;
        const { minX, minY, minZ } = origin ?? CsrGrid.computeBounds(positions, n);
        this.minX = minX; this.minY = minY; this.minZ = minZ;
        this.invCell = 1 / cellSize;

        // Pass 1: assign each point a dense cell id, tallying occupants per cell.
        const pointCell = new Int32Array(n);
        const counts: number[] = [];
        for (let i = 0; i < n; i++) {
            const ix = Math.floor((positions[i * 3] - minX) * this.invCell);
            const iy = Math.floor((positions[i * 3 + 1] - minY) * this.invCell);
            const iz = Math.floor((positions[i * 3 + 2] - minZ) * this.invCell);
            const key = cellKey(ix, iy, iz);
            let d = this.cellIndex.get(key);
            if (d === undefined) {
                d = counts.length;
                this.cellIndex.set(key, d);
                counts.push(0);
            }
            pointCell[i] = d;
            counts[d]++;
        }

        // Prefix-sum → cellStart, then scatter (ascending i ⇒ ascending order per cell).
        const numCells = counts.length;
        const cellStart = new Int32Array(numCells + 1);
        for (let d = 0; d < numCells; d++) cellStart[d + 1] = cellStart[d] + counts[d];
        const cursor = cellStart.slice(0, numCells);
        const cellPoints = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            const d = pointCell[i];
            cellPoints[cursor[d]++] = i;
        }
        this.cellStart = cellStart;
        this.cellPoints = cellPoints;
    }

    private static computeBounds(positions: Float32Array, n: number): { minX: number; minY: number; minZ: number } {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        for (let i = 0; i < n; i++) {
            const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
        }
        return { minX, minY, minZ };
    }

    /** Dense id of cell `(ix, iy, iz)`, or -1 when the cell is empty. */
    denseOf(ix: number, iy: number, iz: number): number {
        return this.cellIndex.get(cellKey(ix, iy, iz)) ?? -1;
    }
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
 * running worst (largest-distance) slot. Shared by `computeNormalsKNN` (bulk
 * PCA pass, via `computeOneNormal`) and `PointGrid` (propagation gather).
 */
interface KnnQuery {
    i: number; x: number; y: number; z: number; k: number;
    dist: Float64Array; idx: Int32Array;
    maxDist: number; maxPos: number;
}

/**
 * Gather up to `q.k` nearest neighbours of point `q.i` from `grid`'s 3×3×3
 * cell ring into `q.dist`/`q.idx` (fixed-size, -1/Infinity padded). The one
 * k-NN gather routine shared by `computeNormalsKNN`/`computeNormalsTile` and
 * `PointGrid.gather` — split from the per-cell scan (`scanCellRange`) to keep
 * each function's cognitive complexity small.
 */
function gatherKnnRing(grid: CsrGrid, positions: Float32Array, q: KnnQuery): void {
    const cx = Math.floor((q.x - grid.minX) * grid.invCell);
    const cy = Math.floor((q.y - grid.minY) * grid.invCell);
    const cz = Math.floor((q.z - grid.minZ) * grid.invCell);
    for (const off of CELL_RING_27) {
        const d = grid.denseOf(cx + off[0], cy + off[1], cz + off[2]);
        if (d < 0) continue;
        scanCellRange(grid, positions, grid.cellStart[d], grid.cellStart[d + 1], q);
    }
}

/** Scan one cell's point range, maintaining `q`'s fixed-size nearest-neighbour buffers. */
function scanCellRange(grid: CsrGrid, positions: Float32Array, start: number, end: number, q: KnnQuery): void {
    const cellPoints = grid.cellPoints;
    for (let p = start; p < end; p++) {
        const j = cellPoints[p];
        if (j === q.i) continue;
        const ex = positions[j * 3] - q.x, ey = positions[j * 3 + 1] - q.y, ez = positions[j * 3 + 2] - q.z;
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
 * @param robust      Crease-preserving robust refit strength, 0..1. 0 (default)
 *                    keeps the plain least-squares fit bit-for-bit. See
 *                    {@link refineNormalRobust}.
 * @returns           Interleaved (nx, ny, nz) per point, normalized.
 */
export function computeNormalsKNN(
    positions: Float32Array,
    k = 12,
    cellSize = 2,
    forceUpward = true,
    quality?: Float32Array,
    robust = 0,
): Float32Array {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    if (n < 4) {
        for (let i = 0; i < n; i++) normals[i * 3 + 2] = 1;
        return normals;
    }

    // 1. Build the CSR spatial grid (bounds + counting-sort into cells).
    const grid = new CsrGrid(positions, cellSize);

    // 2. For each point, gather up to k neighbours from the 3×3×3 cell ring,
    // fit the local covariance and take its smallest eigenvector.
    const query = makeKnnQuery(k);
    const scratch = makeFitScratch(k);
    const fit: NormalFit = { forceUpward, robust };
    const out: NormalsOutput = { normals, index: 0, quality, qualityIndex: 0 };
    for (let i = 0; i < n; i++) {
        out.index = i;
        out.qualityIndex = i;
        computeOneNormal(grid, positions, i, fit, query, scratch, out);
    }
    return normals;
}

/**
 * How the local plane is fitted around one point. Bundled so the sequential and
 * per-tile entry points hand `computeOneNormal` the exact same settings.
 */
interface NormalFit {
    /** Flip each normal so nz ≥ 0. */
    forceUpward: boolean;
    /** Crease-preserving robust refit strength, 0..1 (0 = plain k-NN PCA). */
    robust: number;
}

/**
 * Per-point scratch buffers, allocated once per pass and mutated in place:
 * `eig` holds the eigenvalues of the last accepted fit, `tmpEig` those of the
 * pass being evaluated, `weights` the robust weights of the current refit pass,
 * `center` its weighted centroid.
 */
interface FitScratch {
    eig: Float64Array;
    tmpEig: Float64Array;
    weights: Float64Array;
    center: Float64Array;
}

function makeFitScratch(k: number): FitScratch {
    return {
        eig: new Float64Array(3),
        tmpEig: new Float64Array(3),
        weights: new Float64Array(k),
        center: new Float64Array(3),
    };
}

function makeKnnQuery(k: number): KnnQuery {
    return { i: -1, x: 0, y: 0, z: 0, k, dist: new Float64Array(k), idx: new Int32Array(k), maxDist: Infinity, maxPos: 0 };
}

/** Where `computeOneNormal` writes its result — reused/mutated across points, not reallocated. */
interface NormalsOutput {
    normals: Float32Array;
    index: number;
    quality?: Float32Array;
    qualityIndex?: number;
}

/**
 * Compute the k-NN PCA normal for a single point `i` and write it into
 * `out.normals[out.index]` (`out.quality[out.qualityIndex]` too, when given).
 * Factored out of `computeNormalsKNN`'s loop body so `computeNormalsTile` (the
 * per-tile entry point run inside `normalsWorker.ts` for Phase 2
 * parallelization) can share the *exact* same gather + PCA arithmetic —
 * required for bit-for-bit parity between the sequential and parallel paths,
 * since floating-point accumulation order is not associative.
 */
function computeOneNormal(
    grid: CsrGrid,
    positions: Float32Array,
    i: number,
    fit: NormalFit,
    query: KnnQuery,
    scratch: FitScratch,
    out: NormalsOutput,
): void {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const k = query.k;
    query.i = i; query.x = x; query.y = y; query.z = z;
    for (let h = 0; h < k; h++) { query.dist[h] = Infinity; query.idx[h] = -1; }
    query.maxDist = Infinity; query.maxPos = 0;
    gatherKnnRing(grid, positions, query);
    const idx = query.idx;
    const { normals: outNormals, index: outIdx, quality, qualityIndex = outIdx } = out;

    // Centroid + covariance over self + collected neighbours.
    let mx = x, my = y, mz = z, count = 1;
    for (let h = 0; h < k; h++) {
        const j = idx[h];
        if (j < 0) continue;
        mx += positions[j * 3];
        my += positions[j * 3 + 1];
        mz += positions[j * 3 + 2];
        count++;
    }
    if (count < 4) {
        outNormals[outIdx * 3 + 2] = 1;
        return;
    }
    mx /= count; my /= count; mz /= count;

    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
    {
        const ex = x - mx, ey = y - my, ez = z - mz;
        cxx += ex * ex; cyy += ey * ey; czz += ez * ez;
        cxy += ex * ey; cxz += ex * ez; cyz += ey * ez;
    }
    for (let h = 0; h < k; h++) {
        const j = idx[h];
        if (j < 0) continue;
        const ex = positions[j * 3] - mx;
        const ey = positions[j * 3 + 1] - my;
        const ez = positions[j * 3 + 2] - mz;
        cxx += ex * ex; cyy += ey * ey; czz += ez * ez;
        cxy += ex * ey; cxz += ex * ez; cyz += ey * ez;
    }

    const eig = scratch.eig;
    const n = smallestEigenVec3(cxx, cyy, czz, cxy, cxz, cyz, eig);
    let fitCount = count;
    let perpDist = n[0] * (x - mx) + n[1] * (y - my) + n[2] * (z - mz);
    if (fit.robust > 0) {
        const w = refineNormalRobust(positions, query, fit.robust, n, scratch);
        if (w > 0) {
            const c = scratch.center;
            fitCount = w;
            perpDist = n[0] * (x - c[0]) + n[1] * (y - c[1]) + n[2] * (z - c[2]);
        }
    }
    if (quality) quality[qualityIndex] = pcaQuality(eig, fitCount, perpDist);
    const s = fit.forceUpward && n[2] < 0 ? -1 : 1;
    outNormals[outIdx * 3] = n[0] * s;
    outNormals[outIdx * 3 + 1] = n[1] * s;
    outNormals[outIdx * 3 + 2] = n[2] * s;
}

/**
 * Iteratively-reweighted plane refits (option 4 of `docs/ROCK_AND_CLIFF_DETAIL.md`).
 *
 * A plain least-squares fit over a fixed k-neighbourhood straddles any crease
 * that falls inside that neighbourhood and returns the bisector of the two
 * facets — every ridge, ledge and fault line is rounded off *before* the solver
 * ever sees the data. Here each neighbour is instead weighted by
 * `exp(-r²/2σ²)` on its distance `r` to the CURRENT plane, taken through the
 * query point itself: after a pass or two the points on the far side of the
 * crease have collapsed to ~0 weight and the fit sits squarely on the facet the
 * query point belongs to.
 *
 * The rejection is self-limiting: on genuinely smooth ground every residual is
 * within sensor noise, all weights stay ≈ 1 and the result is the plain fit.
 * And because it works on the whole k-neighbourhood (≈ 1 m at LiDAR HD density,
 * i.e. several octree cells across) the crease it recovers is a real
 * metre-scale edge, not per-triangle faceting.
 *
 * `n` is refined in place. Returns the effective (summed) neighbour weight of
 * the last accepted pass — also the sample count `pcaQuality` needs — or 0 when
 * no pass was accepted, in which case `n` and `scratch.eig` still hold the
 * plain fit.
 */
function refineNormalRobust(
    positions: Float32Array,
    query: KnnQuery,
    robust: number,
    n: [number, number, number],
    scratch: FitScratch,
): number {
    // Graduated non-convexity: the first pass is barely selective (the starting
    // plane IS the bisector, so on a crease every neighbour looks like an
    // outlier), later passes tighten as the fit locks onto one facet. Jumping
    // straight to the final tolerance would shed the good points too.
    const finalTighten = ROBUST_TIGHTEN_LOOSE
        + (ROBUST_TIGHTEN_TIGHT - ROBUST_TIGHTEN_LOOSE) * robust;
    let accepted = 0;
    for (let pass = 0; pass < ROBUST_PASSES; pass++) {
        const t = ROBUST_TIGHTEN_LOOSE
            * Math.pow(finalTighten / ROBUST_TIGHTEN_LOOSE, pass / (ROBUST_PASSES - 1));
        const w = weightedPlaneFit(positions, query, n, t, scratch);
        if (w <= 0) break;
        accepted = w;
    }
    return accepted;
}

/** Number of reweighted passes over which the tolerance is tightened. */
const ROBUST_PASSES = 4;
/** Residual tolerance as a multiple of the mean absolute residual: first pass, then last pass at `robust` = 1. */
const ROBUST_TIGHTEN_LOOSE = 1;
const ROBUST_TIGHTEN_TIGHT = 0.25;
/** Floor on the tolerance (m) — roughly the vertical noise of IGN LiDAR HD.
 *  Without it a locally perfect plane would tighten to σ = 0 and reject everything. */
const ROBUST_SIGMA_MIN_M = 0.06;
/** Effective neighbour weight below which a refit is discarded as degenerate. */
const ROBUST_MIN_WEIGHT = 3;
/** Min λmid/λmax of the surviving neighbourhood: below this it has collapsed to
 *  a line (e.g. a single scan column) and its "plane" normal is arbitrary. */
const ROBUST_MIN_SPREAD = 0.02;

/**
 * One reweighted least-squares pass of {@link refineNormalRobust}: measure each
 * neighbour's distance to the plane `n` through the query point, grade it by
 * `exp(-r²/2σ²)` with σ = `tighten` × the mean absolute residual, then refit on
 * the weighted covariance. Deriving σ from the residuals themselves is what
 * makes the pass scale-free: on smooth ground they are all sensor noise, σ
 * clamps to its floor, every weight stays ≈ 1 and the fit is left alone.
 *
 * Updates `n` (sign-locked to the incoming normal so successive passes can't
 * oscillate), `scratch.eig` and `scratch.center`; returns the summed weight, or
 * 0 when the surviving neighbourhood is too small or too degenerate to trust,
 * leaving the previous fit in place.
 */
function weightedPlaneFit(
    positions: Float32Array,
    query: KnnQuery,
    n: [number, number, number],
    tighten: number,
    scratch: FitScratch,
): number {
    const { x, y, z, k, idx } = query;
    const w = scratch.weights;

    let rsum = 0, rcount = 0;
    for (let h = 0; h < k; h++) {
        const j = idx[h];
        if (j < 0) { w[h] = 0; continue; }
        w[h] = n[0] * (positions[j * 3] - x)
            + n[1] * (positions[j * 3 + 1] - y)
            + n[2] * (positions[j * 3 + 2] - z);
        rsum += Math.abs(w[h]);
        rcount++;
    }
    if (rcount < 3) return 0;
    const sigma = Math.max(ROBUST_SIGMA_MIN_M, (rsum / rcount) * tighten);
    const invTwoSigma2 = 1 / (2 * sigma * sigma);

    // Self carries weight 1: the plane is anchored on the query point, which is
    // what keeps the fit on the facet that point actually belongs to.
    let wsum = 1, mx = x, my = y, mz = z;
    for (let h = 0; h < k; h++) {
        const j = idx[h];
        if (j < 0) continue;
        const r = w[h];
        const wj = Math.exp(-r * r * invTwoSigma2);
        w[h] = wj;
        wsum += wj;
        mx += wj * positions[j * 3];
        my += wj * positions[j * 3 + 1];
        mz += wj * positions[j * 3 + 2];
    }
    if (wsum < ROBUST_MIN_WEIGHT) return 0;
    mx /= wsum; my /= wsum; mz /= wsum;

    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
    {
        const ex = x - mx, ey = y - my, ez = z - mz;
        cxx += ex * ex; cyy += ey * ey; czz += ez * ez;
        cxy += ex * ey; cxz += ex * ez; cyz += ey * ez;
    }
    for (let h = 0; h < k; h++) {
        const j = idx[h];
        if (j < 0) continue;
        const wj = w[h];
        const ex = positions[j * 3] - mx;
        const ey = positions[j * 3 + 1] - my;
        const ez = positions[j * 3 + 2] - mz;
        cxx += wj * ex * ex; cyy += wj * ey * ey; czz += wj * ez * ez;
        cxy += wj * ex * ey; cxz += wj * ex * ez; cyz += wj * ey * ez;
    }

    const eig = scratch.tmpEig;
    const [nx, ny, nz] = smallestEigenVec3(cxx, cyy, czz, cxy, cxz, cyz, eig);
    if (eig[1] < eig[2] * ROBUST_MIN_SPREAD) return 0;
    const s = nx * n[0] + ny * n[1] + nz * n[2] < 0 ? -1 : 1;
    n[0] = nx * s; n[1] = ny * s; n[2] = nz * s;
    scratch.eig.set(eig);
    scratch.center[0] = mx; scratch.center[1] = my; scratch.center[2] = mz;
    return wsum;
}

/**
 * Per-tile entry point for Phase 2 parallelization: computes normals (and
 * optionally quality) for the points listed in `queryLocalIndices` (indices
 * into `positions`, a tile+halo copy — see `normalsTiling.ts`), using a CSR
 * grid anchored at the *global* `origin` so cell boundaries — and therefore
 * k-NN results — are identical to what the single-threaded `computeNormalsKNN`
 * would produce.
 *
 * `positions` must list its points in ascending *original/global* index
 * order (which `planNormalsTiles` guarantees via its `localToGlobal`
 * mapping) — not, e.g., sorted by spatial coordinate — so that `CsrGrid`'s
 * per-cell candidate order (and therefore the k-NN gather's floating-point
 * accumulation order) exactly matches the sequential grid's. Query order
 * itself doesn't matter: each query point is computed independently.
 *
 * Run inside `normalsWorker.ts`; also directly unit-testable without any
 * worker/threading machinery.
 */
export function computeNormalsTile(
    positions: Float32Array,
    queryLocalIndices: Int32Array,
    options: {
        k: number;
        cellSize: number;
        forceUpward: boolean;
        origin: { minX: number; minY: number; minZ: number };
        wantQuality: boolean;
        /** Crease-preserving robust refit strength, 0..1. Default 0 (plain fit). */
        robust?: number;
    },
): { normals: Float32Array; quality?: Float32Array } {
    const { k, cellSize, forceUpward, origin, wantQuality, robust = 0 } = options;
    const queryCount = queryLocalIndices.length;
    const normals = new Float32Array(queryCount * 3);
    const quality = wantQuality ? new Float32Array(queryCount) : undefined;
    if (positions.length / 3 < 4) {
        for (let q = 0; q < queryCount; q++) normals[q * 3 + 2] = 1;
        return { normals, quality };
    }

    const grid = new CsrGrid(positions, cellSize, origin);
    const query = makeKnnQuery(k);
    const scratch = makeFitScratch(k);
    const fit: NormalFit = { forceUpward, robust };
    const out: NormalsOutput = { normals, index: 0, quality, qualityIndex: 0 };
    for (let q = 0; q < queryCount; q++) {
        out.index = q;
        out.qualityIndex = q;
        computeOneNormal(grid, positions, queryLocalIndices[q], fit, query, scratch, out);
    }
    return { normals, quality };
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

/**
 * Uniform 3D grid over a point set for fast k-NN gathers. Wraps a `CsrGrid`
 * so neighbour queries stay parameter-light. Mirrors the grid built by
 * `computeNormalsKNN`.
 */
class PointGrid {
    private readonly grid: CsrGrid;

    constructor(private readonly positions: Float32Array, cellSize: number) {
        this.grid = new CsrGrid(positions, cellSize);
    }

    /** Fill `idxBuf` with up to `neighbors` nearest neighbours of `i` (-1 padded). */
    gather(i: number, neighbors: number, distBuf: Float64Array, idxBuf: Int32Array): void {
        for (let h = 0; h < neighbors; h++) { distBuf[h] = Infinity; idxBuf[h] = -1; }
        const p = this.positions;
        const q: KnnQuery = {
            i, x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2], k: neighbors,
            dist: distBuf, idx: idxBuf, maxDist: Infinity, maxPos: 0,
        };
        gatherKnnRing(this.grid, this.positions, q);
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

/** ASPRS vegetation classes (low / medium / high). */
const VEG_CLASSES = new Set([3, 4, 5]);

/**
 * Per-point normals tuned per class: vegetation (3/4/5) uses a smaller
 * neighbourhood and a tighter grid with NO upward forcing — tree canopies are
 * spiky and faceted, so a large planar fit smears them and forcing nz≥0 flattens
 * the foliage. Everything else keeps the default ground/building-friendly fit.
 *
 * Points are split by class, each subset gets its own k-NN PCA pass, then the
 * normals are scattered back into a single buffer aligned with `positions`.
 */
export function computeNormalsVegAware(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
): Float32Array {
    let vegCount = 0;
    for (let i = 0; i < pointCount; i++) if (VEG_CLASSES.has(classifications[i])) vegCount++;
    // No vegetation (or nothing but vegetation) → a single default pass is fine.
    if (vegCount === 0) return computeNormalsKNN(positions, 12, 2);

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

    const vegN = computeNormalsKNN(vegPos, 8, 1.5, true);
    const restN = computeNormalsKNN(restPos, 12, 2, true);

    const out = new Float32Array(pointCount * 3);
    scatterNormals(out, vegN, vegSrc);
    scatterNormals(out, restN, restSrc);
    return out;
}

/** Copy `src` normals into `dst` at the original point indices in `srcIdx`. */
export function scatterNormals(dst: Float32Array, src: Float32Array, srcIdx: Int32Array): void {
    for (let j = 0; j < srcIdx.length; j++) {
        const i = srcIdx[j];
        dst[i * 3] = src[j * 3];
        dst[i * 3 + 1] = src[j * 3 + 1];
        dst[i * 3 + 2] = src[j * 3 + 2];
    }
}
