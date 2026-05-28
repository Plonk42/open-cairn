/**
 * True-3D mesh via voxel occupancy + Marching Cubes.
 *
 * Unlike the 2.5D builders (Delaunay/grid heightfield), this method
 * represents the cloud as a 3D scalar field, so arches, caves, overhangs,
 * cliff undersides and tunnels (Pont d'Arc!) all get real geometry rather
 * than being collapsed onto a heightmap.
 *
 * Pipeline:
 *   1. Voxelize: choose a cell size that keeps the grid ≤ ~32 M voxels for
 *      the input bbox. Splat each point trilinearly into the 8 surrounding
 *      voxel corners (cell-centred grid). The splat weights replace what
 *      would otherwise be an explicit blur pass: the field is already
 *      smooth at the resolution of the data, while preserving the
 *      sub-voxel position of every point.
 *   2. Normalise the field: `field = min(weight / fullWeight, 1)`. Voxels
 *      with too little support stay near 0 (rejects outliers).
 *   3. Marching Cubes at iso = 0.5. Inside = solid, outside = air.
 *   4. Shade by slope using the standard palette.
 *
 * Notes:
 *   - Single-shell thin features (a 1-voxel-thick cave roof) will produce
 *     two surfaces (top + bottom) — that's actually desirable, you can see
 *     the underside.
 *   - The mesh vertex/triangle count scales with surface area, not point
 *     count, so it can be cheaper than Delaunay for very dense clouds.
 *   - Sparse outliers may produce stray blobs; raise `minHits` to ignore
 *     voxels with too few points.
 */
import { marchingCubes } from './marchingCubes';
import { slopeColor } from './slope';

export interface VoxelMeshOptions {
    /** Voxel size in meters (auto-clamped if grid would exceed maxVoxels). */
    cellSize?: number;
    /** Hard upper bound on total voxel count (default 32 M ≈ 128 MB field). */
    maxVoxels?: number;
    /** Minimum point hits per voxel to count as occupied (default 1). */
    minHits?: number;
    /** Iso-surface threshold on the soft 0..1 field (default 0.5). */
    iso?: number;
    /** Trilinear weight total that maps to field value 1.0 (default 2).
     *  Higher = more conservative (need more points to call a voxel solid). */
    fullHits?: number;
    /** Minimum splatted weight to consider a voxel non-empty (default 0.25). */
    minHits?: number;
    /** Optional extra blur passes (default 0). Use 1 only if the surface
     *  looks too jagged — every pass costs cliff detail. */
    smoothPasses?: number;
}

export interface MeshResult {
    positions: Float32Array;
    normals: Float32Array;
    colors: Uint8Array;
    indices: Uint32Array;
}

const EMPTY: MeshResult = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Uint8Array(0),
    indices: new Uint32Array(0),
};

export function buildVoxelMesh(
    positions: Float32Array,
    opts: VoxelMeshOptions = {},
): MeshResult {
    const n = positions.length / 3;
    if (n < 8) return EMPTY;

    const maxVoxels = opts.maxVoxels ?? 32_000_000;
    const minHits = opts.minHits ?? 0.25;
    const iso = opts.iso ?? 0.5;
    const fullHits = Math.max(0.1, opts.fullHits ?? 2);
    const smoothPasses = opts.smoothPasses ?? 0;

    // 1. Bounds.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    // 1-voxel padding so MC can close the surface at the bbox border.
    const pad = 1;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    if (spanX <= 0 || spanY <= 0 || spanZ <= 0) return EMPTY;

    // 2. Pick cell size so volume / cellSize³ ≤ maxVoxels.
    const baseCell = opts.cellSize ?? 0.4;
    const minCellFromCap = Math.cbrt((spanX * spanY * spanZ) / maxVoxels);
    const cellSize = Math.max(baseCell, minCellFromCap);

    const W = Math.ceil(spanX / cellSize) + 1 + 2 * pad;
    const H = Math.ceil(spanY / cellSize) + 1 + 2 * pad;
    const D = Math.ceil(spanZ / cellSize) + 1 + 2 * pad;
    const total = W * H * D;
    if (total > maxVoxels * 1.5) return EMPTY;

    // 3. Trilinear splat. Treat the field as samples at integer voxel
    //    centres; for each point we find the 8 surrounding centres and
    //    distribute a unit weight by (1-fx)(1-fy)(1-fz) tri-weights. This
    //    naturally smooths the discrete grid while keeping sub-voxel
    //    spatial precision — strictly better than count-then-blur.
    const weights = new Float32Array(total);
    const ox = minX - pad * cellSize;
    const oy = minY - pad * cellSize;
    const oz = minZ - pad * cellSize;
    const invCell = 1 / cellSize;
    const sy = W;
    const sz = W * H;
    for (let i = 0; i < n; i++) {
        // Coordinates in voxel-centre units (so floor gives the lower corner).
        const gx = (positions[i * 3] - ox) * invCell - 0.5;
        const gy = (positions[i * 3 + 1] - oy) * invCell - 0.5;
        const gz = (positions[i * 3 + 2] - oz) * invCell - 0.5;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const iz = Math.floor(gz);
        if (ix < 0 || iy < 0 || iz < 0 || ix + 1 >= W || iy + 1 >= H || iz + 1 >= D) continue;
        const fx = gx - ix;
        const fy = gy - iy;
        const fz = gz - iz;
        const gx0 = 1 - fx, gx1 = fx;
        const gy0 = 1 - fy, gy1 = fy;
        const gz0 = 1 - fz, gz1 = fz;
        const base = ix + iy * sy + iz * sz;
        weights[base] += gx0 * gy0 * gz0;
        weights[base + 1] += gx1 * gy0 * gz0;
        weights[base + sy] += gx0 * gy1 * gz0;
        weights[base + 1 + sy] += gx1 * gy1 * gz0;
        weights[base + sz] += gx0 * gy0 * gz1;
        weights[base + 1 + sz] += gx1 * gy0 * gz1;
        weights[base + sy + sz] += gx0 * gy1 * gz1;
        weights[base + 1 + sy + sz] += gx1 * gy1 * gz1;
    }

    // 4. Soft occupancy field. Map splatted weight → [0, 1] linearly up to
    //    `fullHits`. Below `minHits` it's snapped to 0 (rejects outliers).
    let field = new Float32Array(total);
    const invFull = 1 / fullHits;
    for (let k = 0; k < total; k++) {
        const w = weights[k];
        field[k] = w >= minHits ? Math.min(1, w * invFull) : 0;
    }

    // 5. Optional extra smoothing (default 0). Each pass costs cliff detail.
    for (let pass = 0; pass < smoothPasses; pass++) {
        field = blur3Axis(field, W, H, D, 0);
        field = blur3Axis(field, W, H, D, 1);
        field = blur3Axis(field, W, H, D, 2);
    }

    // 6. Marching Cubes.
    const mc = marchingCubes(field, W, H, D, iso);
    if (mc.indices.length === 0) return EMPTY;

    // 7. Convert positions from voxel units to METER_OFFSETS.
    const nVerts = mc.positions.length / 3;
    const outPos = new Float32Array(nVerts * 3);
    for (let v = 0; v < nVerts; v++) {
        outPos[v * 3] = ox + mc.positions[v * 3] * cellSize;
        outPos[v * 3 + 1] = oy + mc.positions[v * 3 + 1] * cellSize;
        outPos[v * 3 + 2] = oz + mc.positions[v * 3 + 2] * cellSize;
    }

    // 8. Slope-based vertex colors. Normals already point outward (away
    //    from solid), so use |nz| for slope: |nz|=1 → flat, 0 → vertical.
    const outColors = new Uint8Array(nVerts * 4);
    for (let v = 0; v < nVerts; v++) {
        const nz = Math.max(-1, Math.min(1, mc.normals[v * 3 + 2]));
        const slope = Math.acos(Math.abs(nz));
        const [r, g, b] = slopeColor(slope);
        outColors[v * 4] = r;
        outColors[v * 4 + 1] = g;
        outColors[v * 4 + 2] = b;
        outColors[v * 4 + 3] = 255;
    }

    return {
        positions: outPos,
        normals: mc.normals,
        colors: outColors,
        indices: mc.indices,
    };
}

/**
 * 3-tap [1,2,1]/4 box blur along a single axis. Out-of-bounds samples are
 * clamped to the edge. Returns a new Float32Array (callers can swap).
 */
function blur3Axis(
    src: Float32Array,
    W: number, H: number, D: number,
    axis: number,
): Float32Array {
    const dst = new Float32Array(src.length);
    const sx = 1;
    const sy = W;
    const sz = W * H;
    const stride = axis === 0 ? sx : axis === 1 ? sy : sz;
    const lim = axis === 0 ? W : axis === 1 ? H : D;
    for (let iz = 0; iz < D; iz++) {
        for (let iy = 0; iy < H; iy++) {
            for (let ix = 0; ix < W; ix++) {
                const i = ix * sx + iy * sy + iz * sz;
                const cur = axis === 0 ? ix : axis === 1 ? iy : iz;
                const a = cur > 0 ? src[i - stride] : src[i];
                const b = src[i];
                const c = cur < lim - 1 ? src[i + stride] : src[i];
                dst[i] = (a + 2 * b + c) * 0.25;
            }
        }
    }
    return dst;
}
