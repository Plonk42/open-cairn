/**
 * 3D surface reconstruction from a LiDAR point cloud.
 *
 * Pipeline:
 *   1. buildColumns         — column-sparse XY grid + per-column point buckets.
 *   2. computePointNormals  — PCA over k nearest neighbours per point (z-up).
 *   3. computeSDF (IMLS)    — implicit moving least squares evaluation of the
 *                              signed distance at every slab voxel.
 *   4. fillSdfGaps          — fills k-NN-underdetermined cells via in-band
 *                              linear interp; refuses to bridge long gaps to
 *                              avoid creating ghost iso-surfaces.
 *   5. floodfillOutside     — watertight-MC sealing of enclosed positive
 *                              pockets (cliffs, occluded under-sides).
 *   6. dualContouring       — per-cube QEF vertex placement using corner SDF
 *                              gradients as edge normals; recovers crease
 *                              features that Naive Surface Nets averages out.
 *   7. keepLargestComponent — drops disconnected mesh fragments left by
 *                              residual sentinel cells.
 *
 * Memory: SDF stored CSR-style — each (ix, iy) column carries only its z
 * range (padded by BAND_RADIUS), instead of the full AABB.
 */
import { slopeColor } from './slope';

export interface VoxelMeshResult {
    positions: Float32Array;
    normals: Float32Array;
    colors: Uint8Array;
    indices: Uint32Array;
}

const OUTSIDE = 1e6;
const K_NORMALS = 10;        // k-NN for per-point PCA normal estimation
const K_IMLS = 20;           // k-NN for IMLS SDF evaluation
const BAND_RADIUS = 4;       // voxels around each point that get SDF
const IMLS_BANDWIDTH = 1.5;  // gaussian h, in voxel units
const GAP_LIMIT = 2 * BAND_RADIUS; // fillSdfGaps refuses to bridge gaps larger than this

/** Same eigen-vector trick as normals.ts. Returns unit smallest eigenvector. */
function smallestEigenVec3(
    xx: number, yy: number, zz: number,
    xy: number, xz: number, yz: number,
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
    const m11 = xx - lambda, m12 = xy, m13 = xz;
    const m22 = yy - lambda, m23 = yz;
    const m33 = zz - lambda;
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

interface ColumnGrid {
    /** XY footprint in cells. */
    nx: number;
    ny: number;
    /** World origin for ix=0, iy=0 (cell index 0 starts at minX, minY). */
    minX: number;
    minY: number;
    voxelSize: number;
    /** Per-column z slab: [colMinZ, colMaxZ] (inclusive). EMPTY_COL if none. */
    colMinZ: Int32Array;
    colMaxZ: Int32Array;
    /** CSR offset into sdfData; length nx*ny+1. */
    colOffset: Int32Array;
    /** Per-column point bucket (indices into positions array). */
    buckets: Int32Array[];
}

const EMPTY_COL = 2147483647; // INT32_MAX

function buildColumns(positions: Float32Array, voxelSize: number): ColumnGrid {
    const n = positions.length / 3;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // 1-voxel pad in XY so cells at the edge have room for cubes.
    minX -= voxelSize; minY -= voxelSize;
    maxX += voxelSize; maxY += voxelSize;
    const nx = Math.max(2, Math.ceil((maxX - minX) / voxelSize));
    const ny = Math.max(2, Math.ceil((maxY - minY) / voxelSize));
    const ncol = nx * ny;
    const colMinZ = new Int32Array(ncol);
    const colMaxZ = new Int32Array(ncol);
    colMinZ.fill(EMPTY_COL);
    colMaxZ.fill(-EMPTY_COL);

    // First pass: assign each point to its column, accumulate counts and z range.
    const counts = new Int32Array(ncol);
    const pointCol = new Int32Array(n);
    const pointIz = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / voxelSize)));
        const iy = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / voxelSize)));
        const col = ix + iy * nx;
        pointCol[i] = col;
        // Provisional z floor (relative to a free origin); we'll rebase after we know minZ.
        const iz = Math.floor(z / voxelSize);
        pointIz[i] = iz;
        counts[col]++;
        if (iz < colMinZ[col]) colMinZ[col] = iz;
        if (iz > colMaxZ[col]) colMaxZ[col] = iz;
    }

    // Dilate each column's z range by BAND_RADIUS (room for SDF computation
    // and for sign-change edges with neighbors).
    for (let c = 0; c < ncol; c++) {
        if (counts[c] === 0) continue;
        colMinZ[c] -= BAND_RADIUS;
        colMaxZ[c] += BAND_RADIUS;
    }

    // Build CSR offsets.
    const colOffset = new Int32Array(ncol + 1);
    let total = 0;
    for (let c = 0; c < ncol; c++) {
        colOffset[c] = total;
        if (counts[c] > 0) total += (colMaxZ[c] - colMinZ[c] + 1);
    }
    colOffset[ncol] = total;

    // Allocate per-column point buckets.
    const buckets: Int32Array[] = new Array(ncol);
    const writePos = new Int32Array(ncol);
    for (let c = 0; c < ncol; c++) buckets[c] = new Int32Array(counts[c]);
    for (let i = 0; i < n; i++) {
        const col = pointCol[i];
        buckets[col][writePos[col]++] = i;
    }

    return { nx, ny, minX, minY, voxelSize, colMinZ, colMaxZ, colOffset, buckets };
}

/**
 * SDF accessor. Inside the slab returns the stored value. Outside the slab
 * extrapolates linearly in z from the nearest slab-edge value (the ramp
 * grows in voxel units, preserving sign convention: more positive above,
 * more negative below).
 */
function sdfAt(sdfData: Float32Array, g: ColumnGrid, col: number, iz: number): number {
    const minZ = g.colMinZ[col];
    if (minZ === EMPTY_COL) return OUTSIDE;
    const maxZ = g.colMaxZ[col];
    const base = g.colOffset[col];
    const v = g.voxelSize;
    if (iz < minZ) {
        return sdfData[base] + (iz - minZ) * v;
    }
    if (iz > maxZ) {
        return sdfData[base + (maxZ - minZ)] + (iz - maxZ) * v;
    }
    return sdfData[base + iz - minZ];
}

/** Per-point PCA normal (k-NN, smallest covariance eigenvector, oriented z-up). */
function computePointNormals(positions: Float32Array, g: ColumnGrid): Float32Array {
    const n = positions.length / 3;
    const out = new Float32Array(n * 3);
    const k = K_NORMALS;
    const search = 2;
    const distBuf = new Float64Array(k);
    const idxBuf = new Int32Array(k);
    const v = g.voxelSize;

    for (let i = 0; i < n; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        const ix = Math.min(g.nx - 1, Math.max(0, Math.floor((px - g.minX) / v)));
        const iy = Math.min(g.ny - 1, Math.max(0, Math.floor((py - g.minY) / v)));
        const x0 = Math.max(0, ix - search), x1 = Math.min(g.nx - 1, ix + search);
        const y0 = Math.max(0, iy - search), y1 = Math.min(g.ny - 1, iy + search);

        for (let h = 0; h < k; h++) { distBuf[h] = Infinity; idxBuf[h] = -1; }
        let maxDist = Infinity;
        let maxPos = 0;
        for (let ky = y0; ky <= y1; ky++) {
            for (let kx = x0; kx <= x1; kx++) {
                const bucket = g.buckets[kx + ky * g.nx];
                for (let bi = 0; bi < bucket.length; bi++) {
                    const j = bucket[bi];
                    if (j === i) continue;
                    const ex = positions[j * 3] - px;
                    const ey = positions[j * 3 + 1] - py;
                    const ez = positions[j * 3 + 2] - pz;
                    const d2 = ex * ex + ey * ey + ez * ez;
                    if (d2 >= maxDist) continue;
                    distBuf[maxPos] = d2;
                    idxBuf[maxPos] = j;
                    let m = -1, mp = 0;
                    for (let h = 0; h < k; h++) {
                        if (distBuf[h] > m) { m = distBuf[h]; mp = h; }
                    }
                    maxDist = m;
                    maxPos = mp;
                }
            }
        }

        let count = 0, mx = 0, my = 0, mz = 0;
        for (let h = 0; h < k; h++) {
            const j = idxBuf[h];
            if (j < 0) continue;
            mx += positions[j * 3];
            my += positions[j * 3 + 1];
            mz += positions[j * 3 + 2];
            count++;
        }
        if (count < 3) {
            out[i * 3 + 2] = 1;
            continue;
        }
        mx /= count; my /= count; mz /= count;
        let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
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
        const s = nz < 0 ? -1 : 1; // z-up orientation (terrain assumption)
        out[i * 3] = nx * s;
        out[i * 3 + 1] = ny * s;
        out[i * 3 + 2] = nz * s;
    }
    return out;
}

/**
 * IMLS signed distance: f(q) = Σ w_i · ((q - p_i) · n_i) / Σ w_i with
 * w_i = exp(-|q - p_i|² / h²). Each point contributes its OWN tangent plane
 * (vs. Hoppe which averages them via PCA), yielding sharper local geometry.
 */
function computeSDF(positions: Float32Array, pointNormals: Float32Array, g: ColumnGrid): Float32Array {
    const total = g.colOffset[g.colOffset.length - 1];
    const sdf = new Float32Array(total);
    sdf.fill(OUTSIDE);
    const k = K_IMLS;
    const search = BAND_RADIUS + 1;
    const distBuf = new Float64Array(k);
    const idxBuf = new Int32Array(k);
    const v = g.voxelSize;
    const h = IMLS_BANDWIDTH * v;
    const invH2 = 1 / (h * h);

    for (let iy = 0; iy < g.ny; iy++) {
        for (let ix = 0; ix < g.nx; ix++) {
            const col = ix + iy * g.nx;
            const minZ = g.colMinZ[col];
            if (minZ === EMPTY_COL) continue;
            const maxZ = g.colMaxZ[col];
            const base = g.colOffset[col];
            const x0 = Math.max(0, ix - search), x1 = Math.min(g.nx - 1, ix + search);
            const y0 = Math.max(0, iy - search), y1 = Math.min(g.ny - 1, iy + search);

            for (let iz = minZ; iz <= maxZ; iz++) {
                const qx = g.minX + (ix + 0.5) * v;
                const qy = g.minY + (iy + 0.5) * v;
                const qz = (iz + 0.5) * v;

                for (let h2 = 0; h2 < k; h2++) { distBuf[h2] = Infinity; idxBuf[h2] = -1; }
                let maxDist = Infinity;
                let maxPos = 0;
                for (let ky = y0; ky <= y1; ky++) {
                    for (let kx = x0; kx <= x1; kx++) {
                        const bucket = g.buckets[kx + ky * g.nx];
                        for (let bi = 0; bi < bucket.length; bi++) {
                            const j = bucket[bi];
                            const ex = positions[j * 3] - qx;
                            const ey = positions[j * 3 + 1] - qy;
                            const ez = positions[j * 3 + 2] - qz;
                            const d2 = ex * ex + ey * ey + ez * ez;
                            if (d2 >= maxDist) continue;
                            distBuf[maxPos] = d2;
                            idxBuf[maxPos] = j;
                            let m = -1, mp = 0;
                            for (let h2 = 0; h2 < k; h2++) {
                                if (distBuf[h2] > m) { m = distBuf[h2]; mp = h2; }
                            }
                            maxDist = m;
                            maxPos = mp;
                        }
                    }
                }

                let wSum = 0, fSum = 0, count = 0;
                for (let h2 = 0; h2 < k; h2++) {
                    const j = idxBuf[h2];
                    if (j < 0) continue;
                    const w = Math.exp(-distBuf[h2] * invH2);
                    const nx = pointNormals[j * 3];
                    const ny = pointNormals[j * 3 + 1];
                    const nz = pointNormals[j * 3 + 2];
                    const sd = (qx - positions[j * 3]) * nx
                             + (qy - positions[j * 3 + 1]) * ny
                             + (qz - positions[j * 3 + 2]) * nz;
                    fSum += w * sd;
                    wSum += w;
                    count++;
                }
                if (count >= 3 && wSum > 1e-12) {
                    sdf[base + iz - minZ] = fSum / wSum;
                }
            }
        }
    }
    return sdf;
}

// Cube corner offsets — bit 0 = x, bit 1 = y, bit 2 = z.
function cornerOffset(i: number): [number, number, number] {
    return [i & 1, (i >> 1) & 1, (i >> 2) & 1];
}

const EDGES: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 3], [2, 3], [0, 2],
    [4, 5], [5, 7], [6, 7], [4, 6],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

interface SurfaceNetsOutput {
    positions: Float32Array;
    indices: Uint32Array;
}

/**
 * Dual Contouring vertex pass. For each cube we collect the (point,
 * normal) of every edge crossing, then solve
 *     min_v Σ (n_i · (v - p_i))²
 * via the 3×3 normal equations (regularized toward the crossing centroid
 * to handle rank-deficient cases like flat surfaces). The cube vertex is
 * placed at the QEF minimum, clamped to the cube interior. Edge normals
 * are SDF gradients estimated at the cube corners by central differences.
 *
 * This recovers crease features that Naive Surface Nets averages out.
 */
function buildSurfaceNetsVertices(sdfData: Float32Array, g: ColumnGrid) {
    const nxm = g.nx - 1, nym = g.ny - 1;
    const ncol = g.nx * g.ny;
    const cellMinZ = new Int32Array(ncol);
    cellMinZ.fill(EMPTY_COL);
    const vertexIndexByCell: Int32Array[] = new Array(ncol);
    const positions: number[] = [];
    const corner = new Float32Array(8);
    const cornerN = new Float32Array(8 * 3);
    const eps = 0.02;

    for (let iy = 0; iy < nym; iy++) {
        for (let ix = 0; ix < nxm; ix++) {
            const cell = ix + iy * g.nx;
            const c0 = cell, c1 = cell + 1, c2 = cell + g.nx, c3 = cell + g.nx + 1;
            let zlo = EMPTY_COL, zhi = -EMPTY_COL;
            for (const c of [c0, c1, c2, c3]) {
                const m = g.colMinZ[c];
                if (m === EMPTY_COL) continue;
                if (m - 1 < zlo) zlo = m - 1;
                const M = g.colMaxZ[c];
                if (M > zhi) zhi = M;
            }
            if (zlo === EMPTY_COL) continue;
            cellMinZ[cell] = zlo;
            const arr = new Int32Array(zhi - zlo + 1);
            arr.fill(-1);
            vertexIndexByCell[cell] = arr;

            for (let iz = zlo; iz <= zhi; iz++) {
                let mask = 0;
                for (let cIdx = 0; cIdx < 8; cIdx++) {
                    const [dx, dy, dz] = cornerOffset(cIdx);
                    const sv = sdfAt(sdfData, g, (ix + dx) + (iy + dy) * g.nx, iz + dz);
                    corner[cIdx] = sv;
                    if (sv < 0) mask |= 1 << cIdx;
                }
                if (mask === 0 || mask === 255) continue;

                // Corner gradients via central differences (SDF normal at each corner).
                for (let cIdx = 0; cIdx < 8; cIdx++) {
                    const [dx, dy, dz] = cornerOffset(cIdx);
                    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
                    const xPlus = cx + 1 < g.nx ? sdfAt(sdfData, g, (cx + 1) + cy * g.nx, cz) : corner[cIdx];
                    const xMinus = cx > 0 ? sdfAt(sdfData, g, (cx - 1) + cy * g.nx, cz) : corner[cIdx];
                    const yPlus = cy + 1 < g.ny ? sdfAt(sdfData, g, cx + (cy + 1) * g.nx, cz) : corner[cIdx];
                    const yMinus = cy > 0 ? sdfAt(sdfData, g, cx + (cy - 1) * g.nx, cz) : corner[cIdx];
                    const zPlus = sdfAt(sdfData, g, cx + cy * g.nx, cz + 1);
                    const zMinus = sdfAt(sdfData, g, cx + cy * g.nx, cz - 1);
                    let gx = (xPlus - xMinus) * 0.5;
                    let gy = (yPlus - yMinus) * 0.5;
                    let gz = (zPlus - zMinus) * 0.5;
                    const gl = Math.hypot(gx, gy, gz);
                    if (gl > 1e-12) { gx /= gl; gy /= gl; gz /= gl; }
                    cornerN[cIdx * 3] = gx;
                    cornerN[cIdx * 3 + 1] = gy;
                    cornerN[cIdx * 3 + 2] = gz;
                }

                // QEF accumulator: 3x3 symmetric AᵀA and 3-vector Aᵀb. Plus centroid for regularization.
                let m11 = 0, m12 = 0, m13 = 0, m22 = 0, m23 = 0, m33 = 0;
                let b1 = 0, b2 = 0, b3 = 0;
                let cx = 0, cy = 0, cz = 0, nCross = 0;
                for (let e = 0; e < 12; e++) {
                    const a = EDGES[e][0];
                    const b = EDGES[e][1];
                    const va = corner[a];
                    const vb = corner[b];
                    if ((va < 0) === (vb < 0)) continue;
                    let t = va / (va - vb);
                    if (!Number.isFinite(t)) t = 0.5;
                    if (t < 0) t = 0; else if (t > 1) t = 1;
                    const [ax, ay, az] = cornerOffset(a);
                    const [bx, by, bz] = cornerOffset(b);
                    const ex = ax + (bx - ax) * t;
                    const ey = ay + (by - ay) * t;
                    const ez = az + (bz - az) * t;
                    let nx = cornerN[a * 3] + (cornerN[b * 3] - cornerN[a * 3]) * t;
                    let ny = cornerN[a * 3 + 1] + (cornerN[b * 3 + 1] - cornerN[a * 3 + 1]) * t;
                    let nz = cornerN[a * 3 + 2] + (cornerN[b * 3 + 2] - cornerN[a * 3 + 2]) * t;
                    const nl = Math.hypot(nx, ny, nz);
                    if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; }
                    m11 += nx * nx; m12 += nx * ny; m13 += nx * nz;
                    m22 += ny * ny; m23 += ny * nz; m33 += nz * nz;
                    const dot = nx * ex + ny * ey + nz * ez;
                    b1 += nx * dot; b2 += ny * dot; b3 += nz * dot;
                    cx += ex; cy += ey; cz += ez;
                    nCross++;
                }
                if (nCross === 0) continue;
                cx /= nCross; cy /= nCross; cz /= nCross;
                // Regularize toward centroid (handles rank-deficient flat surfaces).
                m11 += eps; m22 += eps; m33 += eps;
                b1 += eps * cx; b2 += eps * cy; b3 += eps * cz;
                const det = m11 * (m22 * m33 - m23 * m23)
                          - m12 * (m12 * m33 - m13 * m23)
                          + m13 * (m12 * m23 - m13 * m22);
                let vx: number, vy: number, vz: number;
                if (Math.abs(det) < 1e-10) {
                    vx = cx; vy = cy; vz = cz;
                } else {
                    const inv = 1 / det;
                    const i11 = (m22 * m33 - m23 * m23) * inv;
                    const i12 = (m13 * m23 - m12 * m33) * inv;
                    const i13 = (m12 * m23 - m13 * m22) * inv;
                    const i22 = (m11 * m33 - m13 * m13) * inv;
                    const i23 = (m12 * m13 - m11 * m23) * inv;
                    const i33 = (m11 * m22 - m12 * m12) * inv;
                    vx = i11 * b1 + i12 * b2 + i13 * b3;
                    vy = i12 * b1 + i22 * b2 + i23 * b3;
                    vz = i13 * b1 + i23 * b2 + i33 * b3;
                }
                // Clamp inside cube to suppress QEF runaway on near-singular systems.
                if (vx < 0) vx = 0; else if (vx > 1) vx = 1;
                if (vy < 0) vy = 0; else if (vy > 1) vy = 1;
                if (vz < 0) vz = 0; else if (vz > 1) vz = 1;
                const wx = g.minX + (ix + vx) * g.voxelSize;
                const wy = g.minY + (iy + vy) * g.voxelSize;
                const wz = (iz + vz) * g.voxelSize;
                arr[iz - zlo] = positions.length / 3;
                positions.push(wx, wy, wz);
            }
        }
    }
    return { positions, vertexIndexByCell, cellMinZ };
}

function vIdx(vertexIndexByCell: Int32Array[], cellMinZ: Int32Array, cell: number, iz: number): number {
    const arr = vertexIndexByCell[cell];
    if (!arr) return -1;
    const offset = iz - cellMinZ[cell];
    if (offset < 0 || offset >= arr.length) return -1;
    return arr[offset];
}

function emitQuadInto(indices: number[], a: number, b: number, c: number, d: number, flip: boolean) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
        indices.push(a, c, b, a, d, c);
    } else {
        indices.push(a, b, c, a, c, d);
    }
}

function buildSurfaceNetsQuads(
    sdfData: Float32Array,
    g: ColumnGrid,
    vertexIndexByCell: Int32Array[],
    cellMinZ: Int32Array,
): Uint32Array {
    const indices: number[] = [];
    for (let iy = 1; iy < g.ny - 1; iy++) {
        for (let ix = 1; ix < g.nx - 1; ix++) {
            const colHere = ix + iy * g.nx;
            const minZ = g.colMinZ[colHere];
            if (minZ === EMPTY_COL) continue;
            const maxZ = g.colMaxZ[colHere];

            // For each edge, iterate the union range with neighbor to be safe.
            const colXm = colHere - 1;
            const colYm = colHere - g.nx;
            // X edge: between (ix-1,iy,iz) and (ix,iy,iz).
            const xLo = Math.min(minZ, g.colMinZ[colXm] === EMPTY_COL ? minZ : g.colMinZ[colXm]);
            const xHi = Math.max(maxZ, g.colMinZ[colXm] === EMPTY_COL ? maxZ : g.colMaxZ[colXm]);
            for (let iz = xLo; iz <= xHi; iz++) {
                const here = sdfAt(sdfData, g, colHere, iz);
                const other = sdfAt(sdfData, g, colXm, iz);
                if ((here < 0) === (other < 0)) continue;
                const v0 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy - 1) * g.nx, iz - 1);
                const v1 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy) * g.nx, iz - 1);
                const v2 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy) * g.nx, iz);
                const v3 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy - 1) * g.nx, iz);
                emitQuadInto(indices, v0, v1, v2, v3, here < 0);
            }
            // Y edge.
            const yLo = Math.min(minZ, g.colMinZ[colYm] === EMPTY_COL ? minZ : g.colMinZ[colYm]);
            const yHi = Math.max(maxZ, g.colMinZ[colYm] === EMPTY_COL ? maxZ : g.colMaxZ[colYm]);
            for (let iz = yLo; iz <= yHi; iz++) {
                const here = sdfAt(sdfData, g, colHere, iz);
                const other = sdfAt(sdfData, g, colYm, iz);
                if ((here < 0) === (other < 0)) continue;
                const v0 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy - 1) * g.nx, iz - 1);
                const v1 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy - 1) * g.nx, iz);
                const v2 = vIdx(vertexIndexByCell, cellMinZ, (ix) + (iy - 1) * g.nx, iz);
                const v3 = vIdx(vertexIndexByCell, cellMinZ, (ix) + (iy - 1) * g.nx, iz - 1);
                emitQuadInto(indices, v0, v1, v2, v3, here < 0);
            }
            // Z edge: between iz-1 and iz of the same column.
            for (let iz = minZ; iz <= maxZ; iz++) {
                const here = sdfAt(sdfData, g, colHere, iz);
                const other = sdfAt(sdfData, g, colHere, iz - 1);
                if ((here < 0) === (other < 0)) continue;
                const v0 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy - 1) * g.nx, iz - 1);
                const v1 = vIdx(vertexIndexByCell, cellMinZ, (ix) + (iy - 1) * g.nx, iz - 1);
                const v2 = vIdx(vertexIndexByCell, cellMinZ, (ix) + (iy) * g.nx, iz - 1);
                const v3 = vIdx(vertexIndexByCell, cellMinZ, (ix - 1) + (iy) * g.nx, iz - 1);
                emitQuadInto(indices, v0, v1, v2, v3, here < 0);
            }
        }
    }
    return new Uint32Array(indices);
}

function surfaceNets(sdfData: Float32Array, g: ColumnGrid): SurfaceNetsOutput {
    const { positions, vertexIndexByCell, cellMinZ } = buildSurfaceNetsVertices(sdfData, g);
    const indices = buildSurfaceNetsQuads(sdfData, g, vertexIndexByCell, cellMinZ);
    return {
        positions: new Float32Array(positions),
        indices,
    };
}

/**
 * In-band gap fill. Short gaps (≤ GAP_LIMIT) are bridged by linear
 * interpolation. Long gaps are filled by sign-preserving extrapolation
 * from each side, keeping the value with larger magnitude — this avoids
 * inventing a spurious zero crossing (and the ghost iso-surface that
 * comes with it) in regions where we have no real local evidence.
 */
function fillSdfGaps(sdfData: Float32Array, g: ColumnGrid): void {
    const v = g.voxelSize;
    const ncol = g.nx * g.ny;
    for (let c = 0; c < ncol; c++) {
        const minZ = g.colMinZ[c];
        if (minZ === EMPTY_COL) continue;
        const len = g.colMaxZ[c] - minZ + 1;
        const base = g.colOffset[c];
        const valids: number[] = [];
        for (let i = 0; i < len; i++) {
            if (sdfData[base + i] !== OUTSIDE) valids.push(i);
        }
        if (valids.length === 0) continue;
        const firstIdx = valids[0];
        const firstVal = sdfData[base + firstIdx];
        for (let i = 0; i < firstIdx; i++) {
            sdfData[base + i] = firstVal + (i - firstIdx) * v;
        }
        for (let k = 0; k < valids.length - 1; k++) {
            const aIdx = valids[k];
            const bIdx = valids[k + 1];
            const span = bIdx - aIdx;
            if (span === 1) continue;
            const aVal = sdfData[base + aIdx];
            const bVal = sdfData[base + bIdx];
            if (span <= GAP_LIMIT) {
                for (let i = aIdx + 1; i < bIdx; i++) {
                    const t = (i - aIdx) / span;
                    sdfData[base + i] = aVal * (1 - t) + bVal * t;
                }
            } else {
                const aSign = aVal >= 0 ? 1 : -1;
                const bSign = bVal >= 0 ? 1 : -1;
                for (let i = aIdx + 1; i < bIdx; i++) {
                    const fromA = aVal + (i - aIdx) * v * aSign;
                    const fromB = bVal + (bIdx - i) * v * bSign;
                    sdfData[base + i] = Math.abs(fromA) > Math.abs(fromB) ? fromA : fromB;
                }
            }
        }
        const lastIdx = valids[valids.length - 1];
        const lastVal = sdfData[base + lastIdx];
        for (let i = lastIdx + 1; i < len; i++) {
            sdfData[base + i] = lastVal + (i - lastIdx) * v;
        }
    }
}

/**
 * Watertight-MC style floodfill: BFS through positive (air) cells from
 * "obvious outside" seeds (top of every column, full extent of the four
 * bbox-boundary columns). Any positive cell unreachable is an enclosed
 * pocket — we flip its sign so the iso-surface seals it as solid rock.
 * This is what closes overhangs and cliff faces in the absence of return
 * points on the occluded side.
 */
function floodfillOutside(sdfData: Float32Array, g: ColumnGrid): void {
    const ncol = g.nx * g.ny;
    const total = g.colOffset[ncol];
    const reached = new Uint8Array(total);
    const qCol: number[] = [];
    const qIz: number[] = [];

    const seed = (col: number, iz: number) => {
        const minZ = g.colMinZ[col];
        if (minZ === EMPTY_COL) return;
        const maxZ = g.colMaxZ[col];
        if (iz < minZ || iz > maxZ) return;
        const idx = g.colOffset[col] + (iz - minZ);
        if (reached[idx]) return;
        if (sdfData[idx] <= 0) return;
        reached[idx] = 1;
        qCol.push(col);
        qIz.push(iz);
    };

    for (let iy = 0; iy < g.ny; iy++) {
        for (let ix = 0; ix < g.nx; ix++) {
            const col = ix + iy * g.nx;
            const minZ = g.colMinZ[col];
            if (minZ === EMPTY_COL) continue;
            const maxZ = g.colMaxZ[col];
            // Top of column — always exposed to open sky.
            seed(col, maxZ);
            // Full extent of bbox-boundary columns — exposed laterally.
            if (ix === 0 || ix === g.nx - 1 || iy === 0 || iy === g.ny - 1) {
                for (let iz = minZ; iz < maxZ; iz++) seed(col, iz);
            }
        }
    }

    let head = 0;
    while (head < qCol.length) {
        const col = qCol[head];
        const iz = qIz[head];
        head++;
        const ix = col % g.nx;
        const iy = (col - ix) / g.nx;
        if (ix + 1 < g.nx) seed(col + 1, iz);
        if (ix > 0) seed(col - 1, iz);
        if (iy + 1 < g.ny) seed(col + g.nx, iz);
        if (iy > 0) seed(col - g.nx, iz);
        seed(col, iz + 1);
        seed(col, iz - 1);
    }

    for (let c = 0; c < ncol; c++) {
        const minZ = g.colMinZ[c];
        if (minZ === EMPTY_COL) continue;
        const len = g.colMaxZ[c] - minZ + 1;
        const base = g.colOffset[c];
        for (let i = 0; i < len; i++) {
            if (sdfData[base + i] > 0 && !reached[base + i]) {
                sdfData[base + i] = -sdfData[base + i];
            }
        }
    }
}

/** Smooth vertex normals = area-weighted average of incident triangle normals, flipped up. */
function computeMeshNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        normals[ia * 3] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
        normals[ib * 3] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
        normals[ic * 3] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
    }
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
            const s = nz < 0 ? -1 : 1;
            normals[i * 3] = (nx / len) * s;
            normals[i * 3 + 1] = (ny / len) * s;
            normals[i * 3 + 2] = (nz / len) * s;
        } else {
            normals[i * 3 + 2] = 1;
        }
    }
    return normals;
}

function colorize(normals: Float32Array): Uint8Array {
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

/**
 * Keep only the largest connected mesh component (union-find over triangle
 * vertices). Drops floating fragments / ghost shells left behind by
 * residual sentinel cells, and compacts the vertex array.
 */
function keepLargestComponent(positions: Float32Array, indices: Uint32Array): { positions: Float32Array, indices: Uint32Array } {
    const nV = positions.length / 3;
    if (nV === 0 || indices.length === 0) return { positions, indices };
    const parent = new Int32Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (a: number, b: number) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[ra] = rb;
    };
    for (let t = 0; t < indices.length; t += 3) {
        union(indices[t], indices[t + 1]);
        union(indices[t + 1], indices[t + 2]);
    }
    const sizes = new Map<number, number>();
    for (let i = 0; i < nV; i++) {
        const r = find(i);
        sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    let bestRoot = -1, bestSize = 0;
    for (const [root, size] of sizes) {
        if (size > bestSize) { bestSize = size; bestRoot = root; }
    }
    const remap = new Int32Array(nV).fill(-1);
    let newCount = 0;
    const keepInd: number[] = [];
    for (let t = 0; t < indices.length; t += 3) {
        if (find(indices[t]) !== bestRoot) continue;
        for (let k = 0; k < 3; k++) {
            const old = indices[t + k];
            if (remap[old] < 0) remap[old] = newCount++;
            keepInd.push(remap[old]);
        }
    }
    const newPos = new Float32Array(newCount * 3);
    for (let i = 0; i < nV; i++) {
        const ni = remap[i];
        if (ni < 0) continue;
        newPos[ni * 3] = positions[i * 3];
        newPos[ni * 3 + 1] = positions[i * 3 + 1];
        newPos[ni * 3 + 2] = positions[i * 3 + 2];
    }
    return { positions: newPos, indices: new Uint32Array(keepInd) };
}

/**
 * Reconstruct a 3D surface from a point cloud (column-sparse SDF + Surface Nets).
 *
 * @param positions Interleaved (dx, dy, z) METER_OFFSETS Float32.
 * @param voxelSize Grid resolution in meters. Total SDF memory is roughly
 *                  (footprint area / v²) × (mean column relief / v) × 4 bytes,
 *                  so doubling v divides memory by ~8.
 */
export function buildVoxelMesh(positions: Float32Array, voxelSize: number): VoxelMeshResult {
    const n = positions.length / 3;
    if (n < 16) {
        return {
            positions: new Float32Array(0),
            normals: new Float32Array(0),
            colors: new Uint8Array(0),
            indices: new Uint32Array(0),
        };
    }
    const g = buildColumns(positions, voxelSize);
    const pointNormals = computePointNormals(positions, g);
    const sdf = computeSDF(positions, pointNormals, g);
    fillSdfGaps(sdf, g);
    floodfillOutside(sdf, g);
    const { positions: rawPos, indices: rawInd } = surfaceNets(sdf, g);
    const { positions: meshPos, indices } = keepLargestComponent(rawPos, rawInd);
    const normals = computeMeshNormals(meshPos, indices);
    const colors = colorize(normals);
    return { positions: meshPos, normals, colors, indices };
}
