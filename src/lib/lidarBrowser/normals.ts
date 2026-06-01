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

/**
 * Smallest eigenvector of a 3×3 symmetric matrix
 * `[xx xy xz; xy yy yz; xz yz zz]` via Cardano + cross-product trick.
 * Returns a unit vector, falling back to `[0, 0, 1]` on degenerate input.
 */
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
 * @returns           Interleaved (nx, ny, nz) per point, normalized.
 */
export function computeNormalsKNN(
    positions: Float32Array,
    k = 12,
    cellSize = 2,
    forceUpward = true,
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

        const [nx, ny, nz] = smallestEigenVec3(cxx, cyy, czz, cxy, cxz, cyz);
        const s = forceUpward && nz < 0 ? -1 : 1;
        normals[i * 3] = nx * s;
        normals[i * 3 + 1] = ny * s;
        normals[i * 3 + 2] = nz * s;
    }
    return normals;
}

/**
 * Propagate normal orientation by BFS through a k-NN graph (Hoppe 1992,
 * MST-equivalent in practice for terrain). Mutates `normals` in place.
 *
 * Algorithm:
 *  1. Seed = highest-z point, forced to nz ≥ 0.
 *  2. BFS through the k-NN graph; for each unvisited neighbor j, if
 *     `n_i · n_j < 0` flip `n_j`. This keeps the gradient field
 *     coherent across the surface, which Poisson needs to avoid
 *     extrapolated "bubbles" near cliffs, ridges and scan boundaries.
 *  3. Any unvisited remainder (disconnected components) gets the +Z
 *     fallback.
 *
 * Memory: bitset(n) + queue(n*4) — fits comfortably in WASM heap.
 */
export function propagateNormalOrientation(
    positions: Float32Array,
    normals: Float32Array,
    cellSize = 3,
    neighbors = 8,
): void {
    const n = positions.length / 3;
    if (n < 4) return;

    // Build the same uniform grid as computeNormalsKNN.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxZ = -Infinity, seedIdx = 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) { maxZ = z; seedIdx = i; }
    }
    const invCell = 1 / cellSize;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const ix = Math.floor((positions[i * 3] - minX) * invCell);
        const iy = Math.floor((positions[i * 3 + 1] - minY) * invCell);
        const iz = Math.floor((positions[i * 3 + 2] - minZ) * invCell);
        const key = cellKey(ix, iy, iz);
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(i);
    }

    // Force seed to +Z and run BFS.
    if (normals[seedIdx * 3 + 2] < 0) {
        normals[seedIdx * 3] *= -1;
        normals[seedIdx * 3 + 1] *= -1;
        normals[seedIdx * 3 + 2] *= -1;
    }
    const visited = new Uint8Array(n);
    visited[seedIdx] = 1;
    const queue = new Int32Array(n);
    queue[0] = seedIdx;
    let qHead = 0, qTail = 1;

    const distBuf = new Float64Array(neighbors);
    const idxBuf = new Int32Array(neighbors);

    while (qHead < qTail) {
        const i = queue[qHead++];
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        const nix = normals[i * 3], niy = normals[i * 3 + 1], niz = normals[i * 3 + 2];
        const cx = Math.floor((x - minX) * invCell);
        const cy = Math.floor((y - minY) * invCell);
        const cz = Math.floor((z - minZ) * invCell);
        for (let h = 0; h < neighbors; h++) { distBuf[h] = Infinity; idxBuf[h] = -1; }
        let maxDist = Infinity, maxPos = 0;
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
                        let m = -1, mp = 0;
                        for (let h = 0; h < neighbors; h++) {
                            if (distBuf[h] > m) { m = distBuf[h]; mp = h; }
                        }
                        maxDist = m; maxPos = mp;
                    }
                }
            }
        }
        for (let h = 0; h < neighbors; h++) {
            const j = idxBuf[h];
            if (j < 0 || visited[j]) continue;
            visited[j] = 1;
            const njx = normals[j * 3], njy = normals[j * 3 + 1], njz = normals[j * 3 + 2];
            if (nix * njx + niy * njy + niz * njz < 0) {
                normals[j * 3] = -njx;
                normals[j * 3 + 1] = -njy;
                normals[j * 3 + 2] = -njz;
            }
            queue[qTail++] = j;
        }
    }

    // Fallback for any disconnected components: force +Z.
    for (let i = 0; i < n; i++) {
        if (!visited[i] && normals[i * 3 + 2] < 0) {
            normals[i * 3] *= -1;
            normals[i * 3 + 1] *= -1;
            normals[i * 3 + 2] *= -1;
        }
    }
}
