/**
 * Curvature-adaptive ground decimation, run BEFORE normals + PoissonRecon (and
 * before the Delaunay "Brut" `buildMesh`) to cut reconstruction cost without
 * degrading relief detail.
 *
 * The classic uniform index-stride thins every region equally, so it either
 * keeps too many points on flat ground or erases detail on features. This
 * replaces it with a per-cell, **orientation-invariant** roughness measure that
 * drives a continuous stride: planar cells are thinned hardest, and the stride
 * ramps geometrically down toward 1 as local surface relief rises — whatever
 * its orientation.
 *
 * Design rationale (why orientation-invariant, not a vertical/ΔZ test):
 * a smooth cliff needs no more points than a smooth field, while a rough patch —
 * a ridge crest, a fault, a boulder, a cave mouth — must stay dense whether it
 * faces up or sideways. So the criterion is the local surface geometry, not the
 * slope: for each small XY cell we fit the best plane (3D PCA of the cell's
 * point covariance) and measure two orientation-invariant quantities:
 *   - `sigma` = λ0/(λ0+λ1+λ2), the PCA surface variation (0 = perfect plane);
 *   - `maxResidual` = the largest perpendicular distance of any cell point from
 *     that fitted plane (an absolute "thickness" in meters).
 * `maxResidual` (not an RMS) is used on purpose so a *minority* of off-plane
 * points — a thin arête, a fissure wall, a boulder edge — dominates the cell's
 * roughness and keeps it dense.
 *
 * Instead of a binary keep/thin threshold, the two quantities are normalised
 * against `sigmaTol` / `residualTol` into a single `detail` score in `[0, 1]`
 * (1 = a cell that saturates either tolerance — genuine relief), which drives
 * a **continuous gamma-law keep-fraction** (like JPEG quantisation, where more
 * local detail survives more compression): `keepFraction = flatStride **
 * (detail - 1)`. A perfectly flat cell (detail 0) keeps `1/flatStride` of its
 * points; a cell with full-blown relief (detail 1) keeps every point; anything
 * in between keeps a proportionally interpolated fraction — no per-cell
 * rounding to a handful of discrete strides, so nearby roughness levels produce
 * nearby densities instead of a two-value (thinned/not-thinned) jump. The
 * fraction is applied with a running accumulator (not `Math.random`), so the
 * kept subset is evenly spread and fully deterministic.
 *
 * `flatStride <= 1` (or an empty cloud) is a byte-identical passthrough, so the
 * feature degrades gracefully to a no-op when disabled.
 */
import type { ScanData } from './scanOrient';

export interface AdaptiveDecimateOptions {
    /** XY analysis cell size in meters. Smaller = finer detail preserved. */
    cellM: number;
    /** Max decimation factor for perfectly-flat cells (keeps 1/flatStride of their points). `<= 1` => passthrough. */
    flatStride: number;
    /** PCA surface variation at which a cell reaches full detail (kept at 100%). */
    sigmaTol: number;
    /** Max out-of-plane residual (m) at which a cell reaches full detail (kept at 100%). */
    residualTol: number;
}

export interface AdaptiveDecimateResult {
    pos: Float32Array;
    count: number;
    scan: ScanData | null;
}

/** Sensible defaults tuned for IGN LiDAR HD (~10 pts/m²) ground/water. */
export const DEFAULT_ADAPTIVE_CELL_M = 1.5;
export const DEFAULT_ADAPTIVE_SIGMA_TOL = 0.05;
export const DEFAULT_ADAPTIVE_RESIDUAL_M = 0.3;

/** Cells with fewer points than this are treated as full detail (can't fit a plane). */
const MIN_ANALYZE_POINTS = 6;

/**
 * Eigen-decomposition of a symmetric 3×3 covariance matrix (Cardano closed
 * form, identical math to `normals.smallestEigenVec3`). Returns the three
 * eigenvalues sorted ascending and the eigenvector of the smallest one (the
 * best-fit plane normal). Covariance eigenvalues are non-negative, so ascending
 * value == ascending magnitude.
 */
function planeFit(
    xx: number, yy: number, zz: number,
    xy: number, xz: number, yz: number,
): { eig: [number, number, number]; normal: [number, number, number] } {
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
    const l0 = Math.min(l1, l2, l3);
    const lmax = Math.max(l1, l2, l3);
    const lmid = l1 + l2 + l3 - l0 - lmax;
    // Eigenvector of the smallest eigenvalue = plane normal.
    const m11 = xx - l0, m12 = xy, m13 = xz;
    const m22 = yy - l0, m23 = yz;
    const m33 = zz - l0;
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
    if (len2 < 1e-20) return { eig: [l0, lmid, lmax], normal: [0, 0, 1] };
    const inv = 1 / Math.sqrt(len2);
    return { eig: [l0, lmid, lmax], normal: [nx * inv, ny * inv, nz * inv] };
}

/**
 * Measure a single cell's orientation-invariant roughness as a `detail` score
 * in `[0, 1]`: 0 for a perfect thin plane (at any orientation), rising toward 1
 * as PCA surface variation or the max out-of-plane residual reach (or exceed)
 * `sigmaTol` / `residualTol`. Drives the continuous keep-fraction below.
 */
function cellDetail(
    positions: Float32Array, idx: number[], sigmaTol: number, residualTol: number,
): number {
    const n = idx.length;
    if (n < MIN_ANALYZE_POINTS) return 1; // too few to fit a plane — treat as full detail.
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < n; j++) {
        const b = idx[j] * 3;
        sx += positions[b]; sy += positions[b + 1]; sz += positions[b + 2];
    }
    const invN = 1 / n;
    const mx = sx * invN, my = sy * invN, mz = sz * invN;
    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
    for (let j = 0; j < n; j++) {
        const b = idx[j] * 3;
        const dx = positions[b] - mx, dy = positions[b + 1] - my, dz = positions[b + 2] - mz;
        cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
        cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
    }
    cxx *= invN; cyy *= invN; czz *= invN; cxy *= invN; cxz *= invN; cyz *= invN;
    const { eig, normal } = planeFit(cxx, cyy, czz, cxy, cxz, cyz);
    const sum = eig[0] + eig[1] + eig[2];
    const sigma = sum > 1e-12 ? eig[0] / sum : 0;
    // Max perpendicular distance to the fitted plane — lets a minority of
    // off-plane points (arête, fissure wall, boulder edge) that barely move the
    // eigenvalues still drive the cell's roughness.
    const [nx, ny, nz] = normal;
    let maxResidual = 0;
    for (let j = 0; j < n; j++) {
        const b = idx[j] * 3;
        const d = Math.abs((positions[b] - mx) * nx + (positions[b + 1] - my) * ny + (positions[b + 2] - mz) * nz);
        if (d > maxResidual) maxResidual = d;
    }
    const bySigma = sigmaTol > 0 ? sigma / sigmaTol : 0;
    const byResidual = residualTol > 0 ? maxResidual / residualTol : 0;
    return Math.min(1, Math.max(bySigma, byResidual));
}

/**
 * Continuous (JPEG-quantisation-like) keep-fraction for a cell of the given
 * `detail` score: `1/flatStride` for a perfectly flat cell (detail 0), ramping
 * geometrically up toward 1 (kept in full) as detail rises to 1. Unlike an
 * integer stride, this is never rounded — a cell at detail 0.5 keeps a
 * genuinely intermediate fraction of its points instead of snapping to one of
 * only two discrete densities.
 */
function cellKeepFraction(detail: number, flatStride: number): number {
    return flatStride ** (detail - 1);
}

/**
 * Bucket point indices into XY cells (ascending original index within each
 * cell, matching the gridMesh/normals binning convention).
 */
function bucketByCell(positions: Float32Array, count: number, invCell: number): Map<number, number[]> {
    let minX = Infinity, minY = Infinity;
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
    }
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
        const ix = Math.floor((positions[i * 3] - minX) * invCell);
        const iy = Math.floor((positions[i * 3 + 1] - minY) * invCell);
        const key = iy * 100000 + ix;
        const b = buckets.get(key);
        if (b) b.push(i);
        else buckets.set(key, [i]);
    }
    return buckets;
}

/** Emit the flagged points (in original order) into a fresh, scan-aligned result. */
function emitKept(
    positions: Float32Array, count: number, scan: ScanData | null, keep: Uint8Array, kept: number,
): AdaptiveDecimateResult {
    const pos = new Float32Array(kept * 3);
    const outScan: ScanData | null = scan && {
        scanAngle: new Float32Array(kept),
        sourceId: new Uint16Array(kept),
        gpsTime: new Float64Array(kept),
    };
    let k = 0;
    for (let i = 0; i < count; i++) {
        if (!keep[i]) continue;
        pos[k * 3] = positions[i * 3];
        pos[k * 3 + 1] = positions[i * 3 + 1];
        pos[k * 3 + 2] = positions[i * 3 + 2];
        if (outScan && scan) {
            outScan.scanAngle[k] = scan.scanAngle[i];
            outScan.sourceId[k] = scan.sourceId[i];
            outScan.gpsTime[k] = scan.gpsTime[i];
        }
        k++;
    }
    return { pos, count: kept, scan: outScan };
}

/**
 * Curvature-adaptive decimation of a ground point subset. Thins locally-planar
 * cells continuously toward `1/flatStride` while keeping every cell with real
 * surface relief close to (or at) full density. Carries the per-point scan
 * channels (scan angle / source id / gps time) for the kept points so Poisson
 * normal orientation stays valid. Output points preserve the input ordering.
 * Never increases the point count.
 */
export function adaptiveDecimateGround(
    positions: Float32Array, count: number, scan: ScanData | null,
    opts: AdaptiveDecimateOptions,
): AdaptiveDecimateResult {
    const flatStride = Math.max(1, Math.floor(opts.flatStride));
    if (flatStride <= 1 || count === 0) return { pos: positions, count, scan };
    const cellM = opts.cellM > 0 ? opts.cellM : DEFAULT_ADAPTIVE_CELL_M;
    const buckets = bucketByCell(positions, count, 1 / cellM);

    // Per cell: derive a roughness-driven keep-fraction (flat => 1/flatStride,
    // rough => up to 1) and keep that fraction of the cell's points via a
    // running accumulator — this evenly distributes the kept points at exactly
    // the target density, continuous in `detail` (no snapping to a handful of
    // discrete integer strides). Flags are set in original-index space so the
    // emit pass preserves ordering and scan alignment.
    const keep = new Uint8Array(count);
    for (const idx of buckets.values()) {
        const detail = cellDetail(positions, idx, opts.sigmaTol, opts.residualTol);
        const keepFraction = cellKeepFraction(detail, flatStride);
        let acc = 0;
        for (const pointIdx of idx) {
            acc += keepFraction;
            if (acc >= 1) {
                keep[pointIdx] = 1;
                acc -= 1;
            }
        }
    }

    let kept = 0;
    for (let i = 0; i < count; i++) kept += keep[i];
    if (kept === count) return { pos: positions, count, scan };
    return emitKept(positions, count, scan, keep, kept);
}
