/**
 * Browser-side LiDAR HD pipeline. Orchestrates:
 *   1. WFS query   → tile URLs
 *   2. COPC walk   → cropped points (parallel across tiles)
 *   3. mode-specific finalization (shaded cloud / mixed)
 *
 * Returns the same data shapes as `src/lib/lidarCloud.ts` types.
 */
import type { LidarMeshData, LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import { extractPoints } from './extract';
import { buildMesh } from './mesh';
import { computeNormalsKNN } from './normals';
import { reconstructPoisson } from './poissonRecon';
import { noopProgress, type ProgressCallback, STAGE_LABELS } from './progress';
import { lngLatToL93 } from './proj';
import { colorsFromNormals, slopeColor } from './slope';
import { buildVoxelMesh } from './voxelMesh';
import { findTiles } from './wfs';

export interface BrowserFetchParams {
    lng: number;
    lat: number;
    radius: number;
    stride: number;
    classes?: number[];
    /** Voxel size in meters for the 'volume' mode (Surface Nets). */
    voxelSize?: number;
    /** Octree depth for the 'poisson' mode (8 = fast, 12 = fine). */
    poissonDepth?: number;
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
}

const MAX_RADIUS_M = 1000;

function concatPositions(parts: Float32Array[], totalPts: number): Float32Array {
    const out = new Float32Array(totalPts * 3);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

function concatClasses(parts: Uint8Array[], totalPts: number): Uint8Array {
    const out = new Uint8Array(totalPts);
    let off = 0;
    for (const c of parts) { out.set(c, off); off += c.length; }
    return out;
}

/**
 * Run steps 1+2 (WFS query → COPC extract on every covering tile, in
 * parallel) and return the merged point set. Used by all three modes.
 */
async function fetchCommon(params: BrowserFetchParams): Promise<{
    positions: Float32Array;
    classifications: Uint8Array;
    pointCount: number;
    radius: number;
    centerLng: number;
    centerLat: number;
}> {
    const onProgress = params.onProgress ?? noopProgress;
    const radius = Math.min(MAX_RADIUS_M, Math.max(20, params.radius));
    const stride = Math.max(1, Math.min(200, Math.floor(params.stride)));
    const classFilter = params.classes && params.classes.length > 0
        ? new Set(params.classes)
        : null;

    // Lambert-93 center of the request.
    const [x0, y0] = lngLatToL93(params.lng, params.lat);

    // WGS84 bbox big enough to bracket the L93 query box after reprojection
    // (20 % padding to compensate for the grid rotation at extreme latitudes).
    onProgress({ stage: 'wfs', message: STAGE_LABELS.wfs });
    const dLat = (radius * 1.2) / 111_320;
    const dLng = (radius * 1.2) / (111_320 * Math.cos((params.lat * Math.PI) / 180));
    const tiles = await findTiles(
        params.lng - dLng, params.lat - dLat,
        params.lng + dLng, params.lat + dLat,
        params.signal,
    );
    if (tiles.length === 0) {
        const err = new Error(
            'Aucune dalle LiDAR HD IGN ne couvre cette zone (acquisition non encore disponible).',
        );
        (err as Error & { code?: string }).code = 'no_lidar_tile';
        throw err;
    }

    // Decode every covering tile in parallel — HTTP Range requests interleave.
    onProgress({
        stage: 'tiles',
        message: STAGE_LABELS.tiles,
        detail: `${tiles.length} dalle${tiles.length > 1 ? 's' : ''}`,
        progress: 0,
    });
    let completedTiles = 0;
    const results = await Promise.all(tiles.map(async (tile) => {
        const r = await extractPoints({
            tileUrl: tile.url,
            x0, y0, radius, stride,
            classFilter,
            signal: params.signal,
        });
        completedTiles++;
        onProgress({
            stage: 'tiles',
            message: STAGE_LABELS.tiles,
            detail: `${completedTiles}/${tiles.length} dalle${tiles.length > 1 ? 's' : ''}`,
            progress: completedTiles / tiles.length,
        });
        return r;
    }));

    let totalPts = 0;
    const posParts: Float32Array[] = [];
    const clsParts: Uint8Array[] = [];
    for (const r of results) {
        if (r.classifications.length === 0) continue;
        posParts.push(r.positions);
        clsParts.push(r.classifications);
        totalPts += r.classifications.length;
    }
    const positions = concatPositions(posParts, totalPts);
    const classifications = concatClasses(clsParts, totalPts);

    return {
        positions,
        classifications,
        pointCount: totalPts,
        radius,
        centerLng: params.lng,
        centerLat: params.lat,
    };
}

/** Shaded point cloud (per-point normals + slope coloring). */
export async function fetchLidarShaded(
    params: BrowserFetchParams,
): Promise<LidarShadedCloudData> {
    const onProgress = params.onProgress ?? noopProgress;
    const c = await fetchCommon(params);
    onProgress({ stage: 'normals', message: STAGE_LABELS.normals, detail: `${c.pointCount.toLocaleString()} points` });
    const normals = computeNormalsKNN(c.positions, 12, 2);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors });
    const colors = colorsFromNormals(normals);
    onProgress({ stage: 'done', message: STAGE_LABELS.done, detail: `${c.pointCount.toLocaleString()} points` });
    return {
        kind: 'shaded',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: c.positions,
        normals,
        colors,
        classifications: c.classifications,
        pointCount: c.pointCount,
        radius: c.radius,
    };
}

/**
 * Mixed mode: build a Delaunay ground mesh AND keep a shaded point cloud
 * of every non-ground point. One fetch, two outputs — lets the user
 * toggle vegetation/buildings classes client-side without re-fetching.
 */
export async function fetchLidarMixed(
    params: BrowserFetchParams,
): Promise<LidarMixedData> {
    const onProgress = params.onProgress ?? noopProgress;
    // Mixed mode ignores any incoming `classes` filter (we need ground for
    // the mesh AND non-ground for the cloud). The runtime mask in the
    // overlay decides which classes the user actually sees.
    const c = await fetchCommon({ ...params, classes: undefined });

    // Split into ground (class 2) and the rest. We keep `nonGround` in a
    // single pass to avoid double-iterating the cloud.
    let groundCount = 0;
    for (let i = 0; i < c.pointCount; i++) if (c.classifications[i] === 2) groundCount++;
    const nonGroundCount = c.pointCount - groundCount;
    const groundPos = new Float32Array(groundCount * 3);
    const ngPos = new Float32Array(nonGroundCount * 3);
    const ngCls = new Uint8Array(nonGroundCount);
    let gi = 0; let ni = 0;
    for (let i = 0; i < c.pointCount; i++) {
        const cls = c.classifications[i];
        const x = c.positions[i * 3];
        const y = c.positions[i * 3 + 1];
        const z = c.positions[i * 3 + 2];
        if (cls === 2) {
            groundPos[gi * 3] = x; groundPos[gi * 3 + 1] = y; groundPos[gi * 3 + 2] = z;
            gi++;
        } else {
            ngPos[ni * 3] = x; ngPos[ni * 3 + 1] = y; ngPos[ni * 3 + 2] = z;
            ngCls[ni] = cls;
            ni++;
        }
    }

    // 1. Ground mesh — Delaunay (cheapest, best with 2.5D ground class).
    onProgress({ stage: 'mesh', message: STAGE_LABELS.mesh, detail: `${groundCount.toLocaleString()} pts sol` });
    const expectedSpacing = Math.sqrt(params.stride / 10);
    const maxEdge = Math.min(8, Math.max(1.5, expectedSpacing * 10));
    const groundMesh = buildMesh(groundPos, maxEdge);
    const meshData: LidarMeshData = {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: groundMesh.positions,
        normals: groundMesh.normals,
        colors: groundMesh.colors,
        indices: groundMesh.indices,
        vertexCount: groundCount,
        triangleCount: groundMesh.indices.length / 3,
        radius: c.radius,
    };

    // 2. Non-ground shaded cloud — normals + slope colors. Even though
    //    vegetation normals are noisy, they're what the WebGL layer wants.
    onProgress({ stage: 'normals', message: STAGE_LABELS.normals, detail: `${nonGroundCount.toLocaleString()} pts` });
    const ngNormals = computeNormalsKNN(ngPos, 12, 2);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors });
    const ngColors = colorsFromNormals(ngNormals);
    const shadedData: LidarShadedCloudData = {
        kind: 'shaded',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: ngPos,
        normals: ngNormals,
        colors: ngColors,
        classifications: ngCls,
        pointCount: nonGroundCount,
        radius: c.radius,
    };

    onProgress({
        stage: 'done',
        message: STAGE_LABELS.done,
        detail: `${meshData.triangleCount} tri + ${nonGroundCount.toLocaleString()} pts`,
    });

    return {
        kind: 'mixed',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        radius: c.radius,
        mesh: meshData,
        shaded: shadedData,
    };
}

/**
 * Volume mode: true 3D surface reconstruction via Hoppe SDF + Surface Nets.
 * Eliminates the vertical "curtains" of the 2.5D Delaunay mesh on cliffs.
 * Only the ground class (2) feeds the reconstruction by default.
 */
export async function fetchLidarVolume(
    params: BrowserFetchParams,
): Promise<LidarMeshData> {
    const onProgress = params.onProgress ?? noopProgress;
    const voxelSize = Math.max(0.2, Math.min(4, params.voxelSize ?? 0.5));
    // Force ground-only for the reconstruction; vegetation/buildings would
    // pollute the SDF (they are not the ground surface).
    const c = await fetchCommon({ ...params, classes: [2] });
    onProgress({
        stage: 'mesh',
        message: STAGE_LABELS.mesh,
        detail: `${c.pointCount.toLocaleString()} pts sol, voxel ${voxelSize} m`,
    });
    const m = buildVoxelMesh(c.positions, voxelSize);
    const triangleCount = m.indices.length / 3;
    const vertexCount = m.positions.length / 3;
    onProgress({
        stage: 'done',
        message: STAGE_LABELS.done,
        detail: `${triangleCount.toLocaleString()} triangles`,
    });
    return {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: m.positions,
        normals: m.normals,
        colors: m.colors,
        indices: m.indices,
        vertexCount,
        triangleCount,
        radius: c.radius,
    };
}

/**
 * Compute area-weighted per-vertex normals (flipped so nz ≥ 0) and slope-based
 * RGBA colors for an indexed triangle mesh. Used by the Poisson path whose
 * output PLY contains only positions + faces.
 */
function normalsAndColorsFromMesh(positions: Float32Array, indices: Uint32Array): {
    normals: Float32Array;
    colors: Uint8Array;
} {
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
        // Trust PoissonRecon's face winding — flipping per-face by sign(nz)
        // would destroy coherence at edges where some faces tilt slightly down,
        // creating bogus vertex normals and bright specular speckles.
        normals[ia * 3] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
        normals[ib * 3] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
        normals[ic * 3] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
    }
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            normals[i * 3 + 2] = 1;
        }
        const nzn = Math.max(-1, Math.min(1, normals[i * 3 + 2]));
        const slope = Math.acos(Math.abs(nzn));
        const [r, g, b] = slopeColor(slope);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }
    return { normals, colors };
}

/**
 * Poisson reconstruction mode: ground-only point cloud → per-point normals
 * via k-NN PCA → PoissonRecon WASM (octree solver) → triangle mesh.
 * Higher octree depth = finer mesh and longer runtime.
 */
export async function fetchLidarPoisson(
    params: BrowserFetchParams,
): Promise<LidarMeshData> {
    const onProgress = params.onProgress ?? noopProgress;
    const depth = Math.max(6, Math.min(12, Math.floor(params.poissonDepth ?? 9)));

    // Ground only — vegetation/buildings would pollute the implicit surface.
    const c = await fetchCommon({ ...params, classes: [2] });
    onProgress({
        stage: 'normals',
        message: STAGE_LABELS.normals,
        detail: `${c.pointCount.toLocaleString()} pts sol`,
    });
    const normals = computeNormalsKNN(c.positions, 12, 2, true);
    // Interleave [x,y,z,nx,ny,nz] for PoissonRecon's PLY input.
    const oriented = new Float32Array(c.pointCount * 6);
    for (let i = 0; i < c.pointCount; i++) {
        oriented[i * 6] = c.positions[i * 3];
        oriented[i * 6 + 1] = c.positions[i * 3 + 1];
        oriented[i * 6 + 2] = c.positions[i * 3 + 2];
        oriented[i * 6 + 3] = normals[i * 3];
        oriented[i * 6 + 4] = normals[i * 3 + 1];
        oriented[i * 6 + 5] = normals[i * 3 + 2];
    }
    onProgress({
        stage: 'mesh',
        message: STAGE_LABELS.mesh,
        detail: `Poisson depth ${depth}`,
    });
    const mesh = await reconstructPoisson(oriented, { depth });
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors });
    const { normals: nrm, colors } = normalsAndColorsFromMesh(mesh.positions, mesh.indices);
    onProgress({
        stage: 'done',
        message: STAGE_LABELS.done,
        detail: `${triangleCount.toLocaleString()} triangles`,
    });
    return {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: mesh.positions,
        normals: nrm,
        colors,
        indices: mesh.indices,
        vertexCount,
        triangleCount,
        radius: c.radius,
    };
}
