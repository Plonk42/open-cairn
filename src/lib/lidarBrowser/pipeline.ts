/**
 * Browser-side LiDAR HD pipeline. Orchestrates:
 *   1. WFS query   → tile URLs
 *   2. COPC walk   → cropped points (parallel across tiles)
 *   3. mode-specific finalization (raw cloud / mesh / shaded)
 *
 * Returns the same data shapes as the existing `src/lib/lidarCloud.ts`
 * service client so it can be swapped in without touching the store or
 * the overlay.
 *
 * Currently runs on the main thread. Phase 2 will move it into a Web
 * Worker to keep the UI fluid during long extractions.
 */
import type { LidarCloudData, LidarMeshData, LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import { extractPoints } from './extract';
import { buildGridMesh } from './gridMesh';
import { buildMesh } from './mesh';
import { computeNormalsKNN } from './normals';
import { noopProgress, type ProgressCallback, STAGE_LABELS } from './progress';
import { lngLatToL93 } from './proj';
import { colorsFromNormals } from './slope';
import { buildVoxelMesh } from './voxelMesh';
import { findTiles } from './wfs';

/** Available mesh reconstruction methods. */
export type MeshMethod = 'delaunay' | 'grid' | 'voxel';

export interface BrowserFetchParams {
    lng: number;
    lat: number;
    radius: number;
    stride: number;
    classes?: number[];
    /** Mesh reconstruction algorithm (only used by the mesh fetch). */
    meshMethod?: MeshMethod;
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

/** Raw point cloud — same shape as `fetchLidarCloud()` from the service client. */
export async function fetchLidarCloudBrowser(
    params: BrowserFetchParams,
): Promise<LidarCloudData> {
    const onProgress = params.onProgress ?? noopProgress;
    const c = await fetchCommon(params);
    onProgress({ stage: 'done', message: STAGE_LABELS.done, detail: `${c.pointCount.toLocaleString()} points` });
    return {
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: c.positions,
        classifications: c.classifications,
        pointCount: c.pointCount,
        radius: c.radius,
    };
}

/** Shaded point cloud (per-point normals + slope coloring). */
export async function fetchLidarShadedBrowser(
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

/** Slope-shaded triangulated mesh. Method selectable: `delaunay` (2.5D
 *  Delaunator, fast but cliff-stripe artefacts), `grid` (regular
 *  heightfield, clean cliffs, no caves), or `voxel` (3D Marching Cubes,
 *  represents arches/caves/overhangs at the cost of more compute).
 */
export async function fetchLidarMeshBrowser(
    params: BrowserFetchParams,
): Promise<LidarMeshData> {
    const onProgress = params.onProgress ?? noopProgress;
    const c = await fetchCommon(params);
    const method: MeshMethod = params.meshMethod ?? 'delaunay';
    onProgress({ stage: 'mesh', message: STAGE_LABELS.mesh, detail: `${c.pointCount.toLocaleString()} points (${method})` });

    let mesh: { positions: Float32Array; normals: Float32Array; colors: Uint8Array; indices: Uint32Array };
    let vertexCount: number;
    if (method === 'grid') {
        // Cell size ≈ point spacing. IGN HD is ~10 pt/m² so ~0.3 m spacing;
        // 0.5 m grid is fine enough to keep cliff detail while staying
        // robust to gaps. Bump hole-fill passes accordingly.
        mesh = buildGridMesh(c.positions, 0.5, 3);
        vertexCount = mesh.positions.length / 3;
    } else if (method === 'voxel') {
        mesh = buildVoxelMesh(c.positions, {
            cellSize: 0.4,
            smoothPasses: 0,
            iso: 0.5,
            fullHits: 2,
            maxVoxels: 32_000_000,
        });
        vertexCount = mesh.positions.length / 3;
    } else {
        // Edge-length threshold: ~10× median spacing for 10 pt/m² IGN data ≈ 3 m;
        // scales up with stride. Clamp to [1.5 m, 8 m].
        const expectedSpacing = Math.sqrt(params.stride / 10);
        const maxEdge = Math.min(8, Math.max(1.5, expectedSpacing * 10));
        mesh = buildMesh(c.positions, maxEdge);
        vertexCount = c.pointCount;
    }
    onProgress({ stage: 'done', message: STAGE_LABELS.done, detail: `${mesh.indices.length / 3} triangles` });
    return {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: mesh.positions,
        normals: mesh.normals,
        colors: mesh.colors,
        indices: mesh.indices,
        vertexCount,
        triangleCount: mesh.indices.length / 3,
        radius: c.radius,
    };
}

/**
 * Mixed mode: build a Delaunay ground mesh AND keep a shaded point cloud
 * of every non-ground point. One fetch, two outputs — lets the user
 * toggle vegetation/buildings classes client-side without re-fetching.
 */
export async function fetchLidarMixedBrowser(
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
