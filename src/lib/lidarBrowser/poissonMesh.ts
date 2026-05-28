/**
 * Hoppe tangent-plane signed-distance reconstruction.
 *
 * A practical, single-pass approximation of Poisson surface reconstruction
 * (Hoppe et al., "Surface Reconstruction from Unorganized Points", 1992):
 * for every voxel near the input cloud, the SDF is computed as
 *   sdf(v) = (v − pNearest) · nNearest
 * where pNearest is the closest input point to v and nNearest is its
 * oriented surface normal. Marching Cubes at iso = 0 then extracts the
 * implicit surface.
 *
 * Pipeline:
 *   1. Per-point normals via `computeNormalsKNN` (already oriented nz ≥ 0;
 *      good enough for top-down LiDAR — vegetation normals get noisy but
 *      they're filtered out upstream when this is used on the ground class).
 *   2. Voxelize the bbox at `cellSize` (auto-clamped to stay below `maxVoxels`).
 *   3. Bucket points into a uniform grid at the same cellSize so we can find
 *      the nearest point for each voxel in O(1) on average.
 *   4. For every point, paint a small band of voxels around it. Each voxel
 *      remembers the SQUARED distance to the closest point that touched it
 *      and stores the signed distance from that point's tangent plane.
 *   5. Voxels never touched stay at +sentinel (outside). The SDF inside the
 *      band crosses 0 at the surface; below the band the field jumps back
 *      to +sentinel, which produces a thin shell — acceptable for LiDAR
 *      because the bottom shell is hidden inside the terrain body.
 *   6. Marching Cubes at iso = 0, colourise by slope from MC gradients.
 *
 * Trade-offs vs the soft-occupancy `voxelMesh`:
 *   + Genuine SDF: surfaces sit exactly on the points, no isovalue tuning.
 *   + Sharper edges than the splatted-occupancy field.
 *   − Requires oriented normals (extra ~hundreds of ms via computeNormalsKNN).
 *   − Single-sided data (LiDAR) yields a thin shell, not a closed solid —
 *     fine for top-down viewing.
 *   − Band-painting cost is O(N · band³). With band = 2 → 125 voxels/point.
 */
import { marchingCubes } from './marchingCubes';
import { computeNormalsKNN } from './normals';
import { slopeColor } from './slope';

export interface PoissonMeshOptions {
    /** Voxel size in metres (auto-clamped if grid would exceed maxVoxels). */
    cellSize?: number;
    /** Hard upper bound on total voxel count (default 32 M ≈ 128 MB field). */
    maxVoxels?: number;
    /** Half-width of the SDF band around each point, in voxel units (default 2). */
    bandCells?: number;
    /** k for k-NN PCA normals (default 12). */
    normalsK?: number;
    /** Neighbour-search cell size for computeNormalsKNN, in metres (default 2). */
    normalsCellSize?: number;
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

/** Sentinel for voxels outside the SDF band — kept finite so MC never trips
 *  on NaN/Inf gradients, but large enough that it's always classified as
 *  "outside" relative to band values which are bounded by bandCells·cellSize. */
const OUTSIDE = 1e6;

export function buildPoissonMesh(
    positions: Float32Array,
    opts: PoissonMeshOptions = {},
): MeshResult {
    const n = positions.length / 3;
    if (n < 8) return EMPTY;

    const maxVoxels = opts.maxVoxels ?? 32_000_000;
    const bandCells = Math.max(1, opts.bandCells ?? 2);
    const normalsK = opts.normalsK ?? 12;
    const normalsCellSize = opts.normalsCellSize ?? 2;

    // 1. Per-point oriented normals (nz ≥ 0).
    const normals = computeNormalsKNN(positions, normalsK, normalsCellSize);

    // 2. Bounds + cell size.
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
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    if (spanX <= 0 || spanY <= 0 || spanZ <= 0) return EMPTY;

    const baseCell = opts.cellSize ?? 0.4;
    const minCellFromCap = Math.cbrt((spanX * spanY * spanZ) / maxVoxels);
    const cellSize = Math.max(baseCell, minCellFromCap);

    // Padding = bandCells + 1, so the SDF band can extend fully outside the
    // bbox without clipping and MC can close the surface at the borders.
    const pad = bandCells + 1;
    const W = Math.ceil(spanX / cellSize) + 1 + 2 * pad;
    const H = Math.ceil(spanY / cellSize) + 1 + 2 * pad;
    const D = Math.ceil(spanZ / cellSize) + 1 + 2 * pad;
    const total = W * H * D;
    if (total > maxVoxels * 1.5) return EMPTY;

    const ox = minX - pad * cellSize;
    const oy = minY - pad * cellSize;
    const oz = minZ - pad * cellSize;
    const invCell = 1 / cellSize;
    const sy = W;
    const sz = W * H;

    // 3. Field initialised to +OUTSIDE. `bestD2` tracks the squared distance
    //    of the closest point that ever painted each voxel, so a closer
    //    point can overwrite a previous SDF value.
    const field = new Float32Array(total);
    const bestD2 = new Float32Array(total);
    for (let k = 0; k < total; k++) {
        field[k] = OUTSIDE;
        bestD2[k] = Infinity;
    }

    // 4. Paint SDF band around every point.
    //    Voxel coordinate of voxel centre (ix,iy,iz):
    //       (ox + (ix + 0.5) * cellSize, oy + (iy + 0.5) * cellSize, oz + (iz + 0.5) * cellSize)
    //    so the voxel "containing" world point p has indices
    //       ix = floor((p.x - ox) * invCell - 0.5)   (rounded by Math.round below)
    for (let i = 0; i < n; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];

        // Centre voxel for this point (nearest voxel centre).
        const cix = Math.round((px - ox) * invCell - 0.5);
        const ciy = Math.round((py - oy) * invCell - 0.5);
        const ciz = Math.round((pz - oz) * invCell - 0.5);

        const ix0 = Math.max(0, cix - bandCells);
        const ix1 = Math.min(W - 1, cix + bandCells);
        const iy0 = Math.max(0, ciy - bandCells);
        const iy1 = Math.min(H - 1, ciy + bandCells);
        const iz0 = Math.max(0, ciz - bandCells);
        const iz1 = Math.min(D - 1, ciz + bandCells);

        for (let iz = iz0; iz <= iz1; iz++) {
            const vz = oz + (iz + 0.5) * cellSize;
            const ez = vz - pz;
            for (let iy = iy0; iy <= iy1; iy++) {
                const vy = oy + (iy + 0.5) * cellSize;
                const ey = vy - py;
                let idxBase = ix0 + iy * sy + iz * sz;
                for (let ix = ix0; ix <= ix1; ix++) {
                    const vx = ox + (ix + 0.5) * cellSize;
                    const ex = vx - px;
                    const d2 = ex * ex + ey * ey + ez * ez;
                    if (d2 < bestD2[idxBase]) {
                        bestD2[idxBase] = d2;
                        // SDF from this point's tangent plane.
                        field[idxBase] = ex * nx + ey * ny + ez * nz;
                    }
                    idxBase++;
                }
            }
        }
    }

    // 5. Marching Cubes at iso = 0.
    const mc = marchingCubes(field, W, H, D, 0);
    if (mc.indices.length === 0) return EMPTY;

    // 6. Voxel-grid positions → METER_OFFSETS.
    const nVerts = mc.positions.length / 3;
    const outPos = new Float32Array(nVerts * 3);
    for (let v = 0; v < nVerts; v++) {
        outPos[v * 3] = ox + mc.positions[v * 3] * cellSize;
        outPos[v * 3 + 1] = oy + mc.positions[v * 3 + 1] * cellSize;
        outPos[v * 3 + 2] = oz + mc.positions[v * 3 + 2] * cellSize;
    }

    // 7. Slope-based colours from MC normals (|nz|=1 flat, 0 vertical).
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
