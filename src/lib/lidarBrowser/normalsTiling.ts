/**
 * Pure, Worker-free partitioning logic for Phase 2 (multi-worker) normals
 * computation. Split out of `normals.ts`/`normalsPool.ts` so it can be
 * unit-tested directly (no `Worker`, no async) — critical since jsdom (the
 * vitest test environment) has no real `Worker` implementation, so the actual
 * worker-pool code path can never be exercised by the automated test suite.
 * Instead, tests call `planNormalsTiles` + `computeNormalsTile` directly and
 * compare the reassembled result against sequential `computeNormalsKNN`
 * output to guarantee exact parity.
 */

/** Global (whole-cloud) bounds used to anchor every tile's grid the same way. */
export interface NormalsOrigin {
    minX: number;
    minY: number;
    minZ: number;
}

/** One worker's share of work: a tile+halo point subset plus its query indices. */
export interface NormalsTilePlan {
    /**
     * Interleaved (x, y, z) positions for this tile's points (query points +
     * halo), ordered by ascending *original/global* index (matching
     * `localToGlobal`) — required so `CsrGrid`'s per-cell candidate order,
     * and therefore the k-NN gather's floating-point accumulation order,
     * exactly matches the sequential grid's (not, e.g., sorted by spatial
     * coordinate, which would silently reorder same-cell candidates).
     */
    localPositions: Float32Array;
    /** `localToGlobal[li]` is the original index (into the full cloud) of local point `li`. Strictly ascending. */
    localToGlobal: Int32Array;
    /** Local indices (into `localPositions`/`localToGlobal`) of this tile's query points. */
    queryLocalIndices: Int32Array;
    /** Global grid origin — must be reused verbatim by every tile's `computeNormalsTile` call. */
    origin: NormalsOrigin;
}

/** Split axis index: 0=x, 1=y, 2=z. */
type Axis = 0 | 1 | 2;

function computeGlobalBounds(positions: Float32Array, n: number): { origin: NormalsOrigin; maxX: number; maxY: number; maxZ: number } {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { origin: { minX, minY, minZ }, maxX, maxY, maxZ };
}

/** Axis with the largest extent — the split axis for banding. */
function pickSplitAxis(origin: NormalsOrigin, maxX: number, maxY: number, maxZ: number): Axis {
    const ex = maxX - origin.minX, ey = maxY - origin.minY, ez = maxZ - origin.minZ;
    if (ex >= ey && ex >= ez) return 0;
    return ey >= ez ? 1 : 2;
}

/** Indices `0..n-1` sorted ascending by their coordinate along `axis`. */
function sortIndicesByAxis(positions: Float32Array, n: number, axis: Axis): Int32Array {
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => positions[a * 3 + axis] - positions[b * 3 + axis]);
    return order;
}

/** Contiguous `[start, end)` boundaries in `order`-space splitting `n` points into `tileCount` near-equal-count bands. */
function computeBandBoundaries(n: number, tileCount: number): Int32Array {
    const boundaries = new Int32Array(tileCount + 1);
    let start = 0;
    for (let t = 0; t < tileCount; t++) {
        const remaining = tileCount - t;
        start += Math.ceil((n - start) / remaining);
        boundaries[t + 1] = Math.min(start, n);
    }
    return boundaries;
}

/**
 * Extend a query band `[qStart, qEnd)` (indices into `order`) left/right while
 * the next candidate's coordinate along `axis` is within `haloRadius` of the
 * band's own coordinate range. `order` is sorted ascending along `axis`, so
 * this is a simple two-pointer walk.
 *
 * `haloRadius` must be `2 * cellSize` (not `1 * cellSize`) — a query point's
 * own grid cell can start up to `cellSize` before it, and its 3×3×3 ring
 * reaches one further full cell to either side, so a needed neighbour can sit
 * just under `2 * cellSize` away. See `normals.ts`'s `CsrGrid` doc comment.
 */
function extendBandWithHalo(
    positions: Float32Array,
    order: Int32Array,
    axis: Axis,
    qStart: number,
    qEnd: number,
    haloRadius: number,
): { left: number; right: number } {
    const n = order.length;
    const queryMinCoord = positions[order[qStart] * 3 + axis];
    const queryMaxCoord = positions[order[qEnd - 1] * 3 + axis];
    let left = qStart;
    while (left > 0 && positions[order[left - 1] * 3 + axis] >= queryMinCoord - haloRadius) left--;
    let right = qEnd;
    while (right < n && positions[order[right] * 3 + axis] <= queryMaxCoord + haloRadius) right++;
    return { left, right };
}

/**
 * Build one tile's plan from a `[qStart, qEnd)` query band and its
 * `[left, right)` halo-extended range (all indices into `order`).
 *
 * `order[left..right)` is in split-axis order, which is *not* a valid
 * per-cell candidate order for `CsrGrid` (see `NormalsTilePlan.localPositions`
 * doc) — so `localToGlobal` is re-sorted ascending by global index here,
 * and each query point's position within that resorted array is looked up
 * to build `queryLocalIndices`. Query order itself is irrelevant (each query
 * point is computed independently), only *candidate* order matters.
 */
function buildTilePlan(
    positions: Float32Array,
    order: Int32Array,
    qStart: number,
    qEnd: number,
    left: number,
    right: number,
    origin: NormalsOrigin,
): NormalsTilePlan {
    const localToGlobal = order.slice(left, right).sort((a, b) => a - b);
    const localOf = new Map<number, number>();
    for (let li = 0; li < localToGlobal.length; li++) localOf.set(localToGlobal[li], li);

    const localPositions = new Float32Array(localToGlobal.length * 3);
    for (let li = 0; li < localToGlobal.length; li++) {
        const gi = localToGlobal[li];
        localPositions[li * 3] = positions[gi * 3];
        localPositions[li * 3 + 1] = positions[gi * 3 + 1];
        localPositions[li * 3 + 2] = positions[gi * 3 + 2];
    }

    const queryLocalIndices = new Int32Array(qEnd - qStart);
    for (let i = 0; i < queryLocalIndices.length; i++) {
        // Every query global index was included in [left, right) by construction, so the lookup always hits.
        const local = localOf.get(order[qStart + i]) ?? -1;
        queryLocalIndices[i] = local;
    }

    return { localPositions, localToGlobal, queryLocalIndices, origin };
}

/**
 * Split `positions` (interleaved x,y,z, `n` points) into up to `tileCount`
 * tile plans for parallel k-NN normals computation, each carrying enough
 * halo around its query band that a per-tile `CsrGrid` (anchored at the
 * shared global `origin`) gathers the *exact* same 3×3×3-ring neighbour set
 * `computeNormalsKNN` would for those points on the full cloud.
 *
 * Points are banded along whichever axis (x, y, or z) has the largest extent,
 * sorted ascending, then cut into `tileCount` near-equal-count contiguous
 * chunks — the halo is added on top by growing each chunk's boundaries while
 * neighbouring points are within `2 * cellSize`.
 *
 * Returns fewer than `tileCount` tiles when `n` is too small to usefully
 * split (e.g. `tileCount > n`); returns a single tile (no halo needed) when
 * `tileCount <= 1`.
 */
export function planNormalsTiles(positions: Float32Array, tileCount: number, cellSize: number): NormalsTilePlan[] {
    const n = positions.length / 3;
    const { origin, maxX, maxY, maxZ } = computeGlobalBounds(positions, n);

    if (tileCount <= 1 || n === 0) {
        const localToGlobal = new Int32Array(n);
        const queryLocalIndices = new Int32Array(n);
        for (let i = 0; i < n; i++) { localToGlobal[i] = i; queryLocalIndices[i] = i; }
        return [{ localPositions: positions.slice(), localToGlobal, queryLocalIndices, origin }];
    }

    const effectiveTileCount = Math.min(tileCount, n);
    const axis = pickSplitAxis(origin, maxX, maxY, maxZ);
    const order = sortIndicesByAxis(positions, n, axis);
    const boundaries = computeBandBoundaries(n, effectiveTileCount);
    const haloRadius = 2 * cellSize;

    const tiles: NormalsTilePlan[] = [];
    for (let t = 0; t < effectiveTileCount; t++) {
        const qStart = boundaries[t];
        const qEnd = boundaries[t + 1];
        if (qStart >= qEnd) continue;
        const { left, right } = extendBandWithHalo(positions, order, axis, qStart, qEnd, haloRadius);
        tiles.push(buildTilePlan(positions, order, qStart, qEnd, left, right, origin));
    }
    return tiles;
}
