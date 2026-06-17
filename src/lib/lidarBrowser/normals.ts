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
 * Binary max-heap of frontier edges for MST orientation propagation, keyed by
 * normal-alignment priority. Parallel typed arrays avoid per-edge allocation;
 * `src`/`dst` carry the (already-oriented source, to-orient target) endpoints.
 */
class EdgeHeap {
    private cap = 1024;
    prio = new Float64Array(this.cap);
    src = new Int32Array(this.cap);
    dst = new Int32Array(this.cap);
    size = 0;

    push(prio: number, src: number, dst: number): void {
        if (this.size === this.cap) {
            this.cap *= 2;
            const p = new Float64Array(this.cap); p.set(this.prio); this.prio = p;
            const s = new Int32Array(this.cap); s.set(this.src); this.src = s;
            const d = new Int32Array(this.cap); d.set(this.dst); this.dst = d;
        }
        const { prio: P, src: S, dst: D } = this;
        let c = this.size++;
        P[c] = prio; S[c] = src; D[c] = dst;
        while (c > 0) {
            const parent = (c - 1) >> 1;
            if (P[parent] >= P[c]) break;
            const tp = P[parent]; P[parent] = P[c]; P[c] = tp;
            const ts = S[parent]; S[parent] = S[c]; S[c] = ts;
            const td = D[parent]; D[parent] = D[c]; D[c] = td;
            c = parent;
        }
    }

    pop(): void {
        const { prio: P, src: S, dst: D } = this;
        this.size--;
        if (this.size <= 0) return;
        P[0] = P[this.size]; S[0] = S[this.size]; D[0] = D[this.size];
        let c = 0;
        for (; ;) {
            const l = 2 * c + 1, r = l + 1;
            let big = c;
            if (l < this.size && P[l] > P[big]) big = l;
            if (r < this.size && P[r] > P[big]) big = r;
            if (big === c) break;
            const tp = P[big]; P[big] = P[c]; P[c] = tp;
            const ts = S[big]; S[big] = S[c]; S[c] = ts;
            const td = D[big]; D[big] = D[c]; D[c] = td;
            c = big;
        }
    }
}

/**
 * Propagate a globally-coherent normal orientation across a k-NN graph using
 * Hoppe (1992) minimum-spanning-tree propagation. Mutates `normals` in place.
 *
 * Why MST and not plain BFS: PCA normals have an arbitrary sign, so orientation
 * must be flooded from a seed. A FIFO BFS crosses sharp creases (cliff edges,
 * ridges — where neighbouring normals are nearly perpendicular and the relative
 * sign is ambiguous) at the *same priority* as smooth surfaces, so one bad flip
 * at a crease propagates and inverts a whole region. The visible symptom is an
 * "inflated cushion": Poisson reconstructs that region's isosurface inside-out,
 * smooth side up and relief detail underneath.
 *
 * MST propagation instead always extends from the frontier edge with the
 * *highest* normal agreement |n_i · n_j| (a Prim frontier). Confident, smooth
 * connections are resolved first; ambiguous crease crossings happen last, when
 * both sides are already firmly oriented — so a flip can no longer cascade.
 *
 * Algorithm:
 *  1. Pick the highest-z unvisited point as a component seed, forced to nz ≥ 0
 *     (aerial LiDAR is seen from above, so the top of each piece faces up).
 *  2. Grow a max-priority frontier keyed by |n_i · n_j|; orient each newly
 *     attached point relative to the already-oriented neighbour it attaches to.
 *  3. When the frontier drains, reseed at the next-highest unvisited point.
 *     This orients every disconnected component with the same up-prior, while
 *     still allowing overhangs/cave roofs to point downward *within* a piece.
 *  4. Majority vote per component: once a component is coherently oriented, its
 *     global sign is still arbitrary (the single seed point can be noisy or
 *     near-horizontal, so the whole piece can end up coherently *inside-out* —
 *     the "cushion on top, detail underneath" symptom). A ground/cliff surface
 *     seen from above must mostly face up, so if the component's summed nz is
 *     negative we flip the entire component. This is far more robust than
 *     trusting one seed normal.
 */

/** Flip every normal in `members` so the component, as a whole, faces upward. */
function orientComponentUpward(normals: Float32Array, members: number[]): void {
    let sumNz = 0;
    for (const m of members) sumNz += normals[m * 3 + 2];
    if (sumNz >= 0) return;
    for (const m of members) {
        normals[m * 3] *= -1;
        normals[m * 3 + 1] *= -1;
        normals[m * 3 + 2] *= -1;
    }
}

export function propagateNormalOrientation(
    positions: Float32Array,
    normals: Float32Array,
    cellSize = 3,
    neighbors = 8,
): void {
    const n = positions.length / 3;
    if (n < 4) return;

    const grid = new PointGrid(positions, cellSize);

    // Indices sorted by descending z, used to pick each component's seed.
    const byZ = new Int32Array(n);
    for (let i = 0; i < n; i++) byZ[i] = i;
    byZ.sort((a, b) => positions[b * 3 + 2] - positions[a * 3 + 2]);

    const visited = new Uint8Array(n);
    const distBuf = new Float64Array(neighbors);
    const idxBuf = new Int32Array(neighbors);
    const heap = new EdgeHeap();

    // Push frontier edges from an already-oriented node `i` to its unvisited
    // k-nearest neighbours, keyed by absolute normal alignment. |dot| is
    // sign-independent, so it's a valid confidence weight even though n_j
    // isn't oriented yet.
    const pushEdges = (i: number): void => {
        grid.gather(i, neighbors, distBuf, idxBuf);
        const nix = normals[i * 3], niy = normals[i * 3 + 1], niz = normals[i * 3 + 2];
        for (let h = 0; h < neighbors; h++) {
            const j = idxBuf[h];
            if (j < 0 || visited[j]) continue;
            const dot = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
            heap.push(Math.abs(dot), i, j);
        }
    };

    for (let s = 0; s < n; s++) {
        const seed = byZ[s];
        if (visited[seed]) continue;

        // Seed each component with the up-prior (top of the piece faces up).
        if (normals[seed * 3 + 2] < 0) {
            normals[seed * 3] *= -1;
            normals[seed * 3 + 1] *= -1;
            normals[seed * 3 + 2] *= -1;
        }
        visited[seed] = 1;
        const members: number[] = [seed];
        pushEdges(seed);

        while (heap.size > 0) {
            const i = heap.src[0];
            const j = heap.dst[0];
            heap.pop();
            if (visited[j]) continue;
            visited[j] = 1;
            members.push(j);
            // Orient j to agree with its most-aligned visited neighbour i.
            const njx = normals[j * 3], njy = normals[j * 3 + 1], njz = normals[j * 3 + 2];
            if (normals[i * 3] * njx + normals[i * 3 + 1] * njy + normals[i * 3 + 2] * njz < 0) {
                normals[j * 3] = -njx;
                normals[j * 3 + 1] = -njy;
                normals[j * 3 + 2] = -njz;
            }
            pushEdges(j);
        }

        // Fix a coherently-but-globally-inverted component (the whole-mesh flip).
        orientComponentUpward(normals, members);
    }
}
