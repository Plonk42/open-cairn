/**
 * Browser-side LiDAR HD pipeline. Orchestrates:
 *   1. WFS query   → tile URLs
 *   2. COPC walk   → cropped points (parallel across tiles)
 *   3. mode-specific finalization (shaded cloud / mixed)
 *
 * Returns the same data shapes as `src/lib/lidarCloud.ts` types.
 */
import type { LidarMeshData, LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import { buildForestRaster, fetchForestPolygons, labelForestPoints } from './bdforet';
import { extractPoints } from './extract';
import { buildGridMesh } from './gridMesh';
import {
    buildVegGroundGrid, computeVegHeights, DEFAULT_VEG_GROUND_GAP, DEFAULT_VEG_GROUND_ROUGH,
    sanitizeVegHeights, type VegGroundGrid,
} from './groundHeight';
import { buildMesh } from './mesh';
import { orientNormalsForPoisson } from './normals';
import { computeNormalsKNNAsync, computeNormalsVegAwareAsync } from './normalsPool';
import { reconstructPoisson } from './poissonRecon';
import { noopProgress, STAGE_LABELS, type ProgressCallback } from './progress';
import { l93RectAxes, lngLatToL93 } from './proj';
import type { ScanData } from './scanOrient';
import { colorsFromNormals, vertexColor, type ShaderPreset } from './slope';
import { detectTreetops } from './treetops';
import { findTiles } from './wfs';

export interface BrowserFetchParams {
    lng: number;
    lat: number;
    radius: number;
    stride: number;
    classes?: number[];
    /** Poisson mode only: target decimation stride for the ground/water points
     *  fed to the reconstruction. Lets the ground be sampled more coarsely than
     *  the (vegetation) `stride` so the slow PoissonRecon octree builds faster
     *  without thinning the non-ground overlay. Absolute, like `stride`; values
     *  below `stride` have no effect (points were already decimated on extract). */
    poissonGroundStride?: number;
    /** Octree depth for the 'poisson' mode (8 = fast, 12 = fine). */
    poissonDepth?: number;
    /** Min samples per octree node for PoissonRecon. Default 1.5. */
    poissonSamplesPerNode?: number;
    /** Interpolation weight for PoissonRecon. Default 4. */
    poissonPointWeight?: number;
    /** Colour shader preset applied to all geometry. */
    shader?: ShaderPreset;
    /** Delaunay mode: smooth the ground surface via a regular grid heightfield
     *  (denoises, kills self-shadow stripes) instead of raw Delaunay. */
    gridMesh?: boolean;
    /** Grid cell resolution (m) when gridMesh is on. Default 1. */
    gridCell?: number;
    /** Vertical gap (m) above which stacked vegetation masses are counted
     *  separately for the height-above-ground metric. Default 3. */
    groundGapM?: number;
    /** Local ground relief (m) above which the hybrid height keeps the stacked
     *  metric; below it trusts the vertical-to-ground height. 0 disables the
     *  hybrid (pure stacked). Default 12. */
    groundRoughM?: number;
    /** Optional oriented capture rectangle. When set, the loaded area is this
     *  rotated rectangle (centred on lng/lat) instead of the square `radius`
     *  box; `radius` must be the rect's enclosing-circle radius so tile and node
     *  selection still bracket the whole footprint. `bearingDeg` is the ground
     *  azimuth (deg from north, clockwise) of the rectangle's length axis. */
    rect?: { halfWidthM: number; halfLengthM: number; bearingDeg: number };
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
}

const MAX_RADIUS_M = 1500;

function fmtMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`;
}

function startTimer(): () => number {
    const t0 = performance.now();
    return () => performance.now() - t0;
}

function logStage(label: string, ms: number, extra?: string): void {
    const suffix = extra ? ' (' + extra + ')' : '';
    console.log(`[lidar] ${label}: ${fmtMs(ms)}${suffix}`);
}

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

/** Per-node scan dimensions, parallel to the kept classifications. */
interface ScanNode {
    classifications: Uint8Array;
    scanAngle?: Float32Array;
    sourceId?: Uint16Array;
    gpsTime?: Float64Array;
}

/**
 * Concatenate the optional per-point scan dimensions across nodes, in the same
 * order and offsets as {@link concatPositions}/{@link concatClasses} (skipping
 * empty nodes so the indices stay aligned with the merged positions).
 */
function mergeScan(results: ScanNode[], totalPts: number): {
    scanAngle: Float32Array; sourceId: Uint16Array; gpsTime: Float64Array;
} {
    const scanAngle = new Float32Array(totalPts);
    const sourceId = new Uint16Array(totalPts);
    const gpsTime = new Float64Array(totalPts);
    let off = 0;
    for (const r of results) {
        if (r.classifications.length === 0) continue;
        if (r.scanAngle) scanAngle.set(r.scanAngle, off);
        if (r.sourceId) sourceId.set(r.sourceId, off);
        if (r.gpsTime) gpsTime.set(r.gpsTime, off);
        off += r.classifications.length;
    }
    return { scanAngle, sourceId, gpsTime };
}

/** Merged cloud as returned by {@link fetchCommon}. */
interface CommonCloud {
    positions: Float32Array;
    classifications: Uint8Array;
    scanAngle?: Float32Array;
    sourceId?: Uint16Array;
    gpsTime?: Float64Array;
    pointCount: number;
}

/** Ground/non-ground split plus the ground subset's scan dimensions. */
interface GroundSplit {
    groundPos: Float32Array;
    groundCount: number;
    ngPos: Float32Array;
    ngCls: Uint8Array;
    groundScan: ScanData | null;
}

/** Allocate the ground scan buffers, or null when the cloud carries no scan dims. */
function makeGroundScan(c: CommonCloud, groundCount: number): ScanData | null {
    if (!c.scanAngle || !c.sourceId || !c.gpsTime) return null;
    return {
        scanAngle: new Float32Array(groundCount),
        sourceId: new Uint16Array(groundCount),
        gpsTime: new Float64Array(groundCount),
    };
}

/** Copy point `i`'s scan dims into ground slot `gi` (no-op without scan data). */
function copyScanPoint(c: CommonCloud, dst: ScanData | null, gi: number, i: number): void {
    if (!dst) return;
    dst.scanAngle[gi] = c.scanAngle![i];
    dst.sourceId[gi] = c.sourceId![i];
    dst.gpsTime[gi] = c.gpsTime![i];
}

/**
 * Split the merged cloud into ground (class 2) + water (class 9, fed to the
 * mesh reconstruction) and everything else (kept as a shaded overlay), in a
 * single pass. Water points lie on the terrain surface and must be included so
 * ponds/lakes are reconstructed rather than leaving holes in the mesh.
 * The ground subset's ScanAngle / PointSourceId / GpsTime are carried
 * alongside so Poisson's flight-line orientation operates on exactly the mesh
 * input points (null in Delaunay mode, which decodes no scan dimensions).
 */
function splitGround(c: CommonCloud): GroundSplit {
    let groundCount = 0;
    for (let i = 0; i < c.pointCount; i++) if (c.classifications[i] === 2 || c.classifications[i] === 9) groundCount++;
    const groundPos = new Float32Array(groundCount * 3);
    const ngPos = new Float32Array((c.pointCount - groundCount) * 3);
    const ngCls = new Uint8Array(c.pointCount - groundCount);
    const groundScan = makeGroundScan(c, groundCount);
    let gi = 0; let ni = 0;
    for (let i = 0; i < c.pointCount; i++) {
        const x = c.positions[i * 3], y = c.positions[i * 3 + 1], z = c.positions[i * 3 + 2];
        if (c.classifications[i] === 2 || c.classifications[i] === 9) {
            groundPos[gi * 3] = x; groundPos[gi * 3 + 1] = y; groundPos[gi * 3 + 2] = z;
            copyScanPoint(c, groundScan, gi, i);
            gi++;
        } else {
            ngPos[ni * 3] = x; ngPos[ni * 3 + 1] = y; ngPos[ni * 3 + 2] = z;
            ngCls[ni] = c.classifications[i];
            ni++;
        }
    }
    return { groundPos, groundCount, ngPos, ngCls, groundScan };
}

/** Decimated ground subset for the Poisson reconstruction input. */
interface DecimatedGround {
    pos: Float32Array;
    count: number;
    scan: ScanData | null;
}

/**
 * Keep one ground point in `extra` (uniform stride) for the Poisson input only.
 * The caller computes `extra` from the absolute ground stride relative to the
 * extraction stride, so the ground mesh can be reconstructed from far fewer
 * points than the vegetation overlay. `extra <= 1` returns the input unchanged.
 */
function decimateGround(
    groundPos: Float32Array, groundCount: number, groundScan: ScanData | null, extra: number,
): DecimatedGround {
    if (extra <= 1 || groundCount === 0) return { pos: groundPos, count: groundCount, scan: groundScan };
    const count = Math.ceil(groundCount / extra);
    const pos = new Float32Array(count * 3);
    const scan: ScanData | null = groundScan && {
        scanAngle: new Float32Array(count),
        sourceId: new Uint16Array(count),
        gpsTime: new Float64Array(count),
    };
    let k = 0;
    for (let i = 0; i < groundCount; i += extra) {
        pos[k * 3] = groundPos[i * 3];
        pos[k * 3 + 1] = groundPos[i * 3 + 1];
        pos[k * 3 + 2] = groundPos[i * 3 + 2];
        if (scan && groundScan) {
            scan.scanAngle[k] = groundScan.scanAngle[i];
            scan.sourceId[k] = groundScan.sourceId[i];
            scan.gpsTime[k] = groundScan.gpsTime[i];
        }
        k++;
    }
    return { pos: pos.subarray(0, k * 3), count: k, scan };
}

/**
 * Run steps 1+2 (WFS query → COPC extract on every covering tile, in
 * parallel) and return the merged point set. Used by all three modes.
 *
 * When `opts.needScan` is set, per-point ScanAngle / PointSourceId / GpsTime are
 * also decoded (Poisson mode uses them for flight-line normal orientation).
 */
async function fetchCommon(params: BrowserFetchParams, opts?: { needScan?: boolean }): Promise<{
    positions: Float32Array;
    classifications: Uint8Array;
    scanAngle?: Float32Array;
    sourceId?: Uint16Array;
    gpsTime?: Float64Array;
    pointCount: number;
    radius: number;
    centerLng: number;
    centerLat: number;
}> {
    const needScan = opts?.needScan ?? false;
    const onProgress = params.onProgress ?? noopProgress;
    const radius = Math.min(MAX_RADIUS_M, Math.max(20, params.radius));
    const stride = Math.max(1, Math.min(200, Math.floor(params.stride)));
    const classFilter = params.classes && params.classes.length > 0
        ? new Set(params.classes)
        : null;

    // Lambert-93 center of the request.
    const [x0, y0] = lngLatToL93(params.lng, params.lat);

    // Oriented-rectangle crop (Lambert-93 axes + half-extents), or null for the
    // default square. The square `radius` AABB still drives tile/node selection.
    const rectCrop = params.rect
        ? {
            ...l93RectAxes(params.lng, params.lat, params.rect.bearingDeg),
            halfWidthM: params.rect.halfWidthM,
            halfLengthM: params.rect.halfLengthM,
        }
        : null;

    // WGS84 bbox big enough to bracket the L93 query box after reprojection
    // (20 % padding to compensate for the grid rotation at extreme latitudes).
    onProgress({ stage: 'wfs', message: STAGE_LABELS.wfs });
    const wfsTimer = startTimer();
    const dLat = (radius * 1.2) / 111_320;
    const dLng = (radius * 1.2) / (111_320 * Math.cos((params.lat * Math.PI) / 180));
    const tiles = await findTiles(
        params.lng - dLng, params.lat - dLat,
        params.lng + dLng, params.lat + dLat,
        params.signal,
    );
    logStage('wfs', wfsTimer(), `${tiles.length} dalle${tiles.length > 1 ? 's' : ''}`);
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
    const tilesTimer = startTimer();
    let completedTiles = 0;
    const results = await Promise.all(tiles.map(async (tile) => {
        const r = await extractPoints({
            tileUrl: tile.url,
            x0, y0, radius, stride,
            classFilter,
            rect: rectCrop,
            needScan,
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
    let rawTotal = 0;
    let inBboxTotal = 0;
    const posParts: Float32Array[] = [];
    const clsParts: Uint8Array[] = [];
    for (const r of results) {
        rawTotal += r.rawPointCount;
        inBboxTotal += r.inBboxPointCount;
        if (r.classifications.length === 0) continue;
        posParts.push(r.positions);
        clsParts.push(r.classifications);
        totalPts += r.classifications.length;
    }
    const positions = concatPositions(posParts, totalPts);
    const classifications = concatClasses(clsParts, totalPts);
    const scan = needScan ? mergeScan(results, totalPts) : undefined;
    const safeStride = Math.max(1, Math.floor(stride));
    const areaM2 = (2 * radius) * (2 * radius);
    const inBboxDensity = inBboxTotal / areaM2;
    const keptDensity = totalPts / areaM2;
    logStage('tiles', tilesTimer(),
        `${tiles.length} dalle${tiles.length > 1 ? 's' : ''} → `
        + `${rawTotal.toLocaleString()} raw → ~${inBboxTotal.toLocaleString()} in-bbox → ${totalPts.toLocaleString()} kept`
        + ` (stride ${safeStride}, ${inBboxDensity.toFixed(2)} → ${keptDensity.toFixed(2)} pts/m²)`);

    return {
        positions,
        classifications,
        scanAngle: scan?.scanAngle,
        sourceId: scan?.sourceId,
        gpsTime: scan?.gpsTime,
        pointCount: totalPts,
        radius,
        centerLng: params.lng,
        centerLat: params.lat,
    };
}

/**
 * Enrich a shaded cloud with IGN BD Forêt® species typing (`forestTfv`) and
 * per-tree seeds (`treeSeed`) for species-accurate vegetation rendering.
 *
 * Both are best-effort: treetop seeds need a height-above-ground field, and the
 * BD Forêt query is a network call that may fail or return no stands. In every
 * fallback case the cloud is returned unchanged and vegetation simply renders
 * with the generic ramp — never blocking a capture.
 */
async function enrichForest(
    shaded: LidarShadedCloudData,
    onProgress: ProgressCallback,
    signal?: AbortSignal,
): Promise<void> {
    if (shaded.heightAboveGround) {
        const tTops = startTimer();
        shaded.treeSeed = detectTreetops(
            shaded.positions, shaded.heightAboveGround, shaded.classifications, shaded.pointCount,
        ) ?? undefined;
        logStage('treetops (cimes)', tTops());
    }
    onProgress({ stage: 'forest', message: STAGE_LABELS.forest });
    const tForest = startTimer();
    try {
        const polygons = await fetchForestPolygons(
            shaded.centerLng, shaded.centerLat, shaded.radius, signal,
        );
        const tClassify = startTimer();
        if (polygons.length > 0) {
            // Rasterise once and keep it on the cloud, then label the points with
            // sharp edges as a baseline. The overlay re-runs the labelling live
            // (sharp / feather / scatter) from this raster, no re-fetch needed.
            const raster = buildForestRaster(
                shaded.positions, shaded.pointCount, shaded.classifications,
                shaded.centerLng, shaded.centerLat, polygons,
            );
            if (raster) {
                shaded.forestRaster = raster;
                shaded.forestTfv = labelForestPoints(
                    shaded.positions, shaded.pointCount, shaded.classifications,
                    shaded.centerLng, shaded.centerLat, raster,
                );
            }
        }
        logStage('forest classify', tClassify(), `${polygons.length} peuplement${polygons.length > 1 ? 's' : ''}`);
        logStage('forest (BD Forêt)', tForest(), `${polygons.length} peuplement${polygons.length > 1 ? 's' : ''}`);
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        console.warn('[lidar] BD Forêt typing skipped:', (err as Error)?.message ?? err);
    }
}

/**
 * Build the non-ground shaded point-cloud overlay shared by the Delaunay and
 * Poisson mesh modes: vegetation-aware normals, slope colours, height above
 * ground (stacked-ground per-column clustering, so a tree leaning on a cliff
 * keeps its full height and trees on different ledges each keep their own), the
 * robust "tallest tree" foliage scale that drives the "Hauteur max · Auto"
 * control, and best-effort BD Forêt species typing.
 */
async function buildNonGroundShaded(
    c: { positions: Float32Array; classifications: Uint8Array; pointCount: number; centerLng: number; centerLat: number; radius: number },
    nonGround: { pos: Float32Array; cls: Uint8Array; count: number },
    shader: ShaderPreset,
    veg: { gapM: number; grid: VegGroundGrid | null; roughM: number },
    onProgress: ProgressCallback,
    signal?: AbortSignal,
): Promise<LidarShadedCloudData> {
    const { pos: ngPos, cls: ngCls, count: nonGroundCount } = nonGround;
    onProgress({ stage: 'normals', message: STAGE_LABELS.normals, detail: `${nonGroundCount.toLocaleString()} pts` });
    const tNg = startTimer();
    const ngNormals = await computeNormalsVegAwareAsync(ngPos, ngCls, nonGroundCount);
    logStage('normals (non-sol)', tNg(), `${nonGroundCount.toLocaleString()} pts`);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors, detail: 'nuage non-sol' });
    const tNgCol = startTimer();
    const ngColors = colorsFromNormals(ngNormals, shader, ngPos);
    // Height above ground via per-column vertical clustering, blended with the
    // plain vertical-to-ground height over trustworthy (low-relief) ground so
    // spreading broadleaf crowns recover their full height (see computeVegHeights).
    const ngVegDiag = new Uint8Array(nonGroundCount * 4);
    const ngHeight = computeVegHeights(
        ngPos, ngCls, nonGroundCount, veg.gapM, veg.grid, veg.roughM, { diag: ngVegDiag },
    );
    // Robust canopy top (drives the "Hauteur max · Auto" foliage scale). Mutates
    // ngHeight in place to clamp cliff-edge artefacts, mirroring the shaded path.
    const ngVegHeightAuto = sanitizeVegHeights(ngHeight, ngCls, nonGroundCount, ngVegDiag) ?? undefined;
    logStage('colors (non-sol)', tNgCol());
    const shadedData: LidarShadedCloudData = {
        kind: 'shaded',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: ngPos,
        normals: ngNormals,
        colors: ngColors,
        classifications: ngCls,
        heightAboveGround: ngHeight,
        vegHeightAuto: ngVegHeightAuto,
        vegDiag: ngVegDiag,
        vegGroundGrid: veg.grid ?? undefined,
        pointCount: nonGroundCount,
        radius: c.radius,
    };
    await enrichForest(shadedData, onProgress, signal);
    return shadedData;
}

/** Shaded point cloud (per-point normals + slope coloring). */
export async function fetchLidarShaded(
    params: BrowserFetchParams,
): Promise<LidarShadedCloudData> {
    const onProgress = params.onProgress ?? noopProgress;
    const shader = params.shader ?? 'cliff';
    const total = startTimer();
    const c = await fetchCommon(params);
    onProgress({ stage: 'normals', message: STAGE_LABELS.normals, detail: `${c.pointCount.toLocaleString()} points` });
    const tNormals = startTimer();
    const normals = await computeNormalsVegAwareAsync(c.positions, c.classifications, c.pointCount);
    logStage('normals', tNormals(), `${c.pointCount.toLocaleString()} pts`);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors });
    const tColors = startTimer();
    const colors = colorsFromNormals(normals, shader, c.positions);
    // Bare-earth reference from the ground/water returns, then the hybrid height
    // (stacked, blended with vertical-to-ground over low-relief terrain).
    const groundGrid = buildVegGroundGrid(c.positions, c.pointCount, c.classifications);
    const vegDiag = new Uint8Array(c.pointCount * 4);
    const heightAboveGround = computeVegHeights(
        c.positions, c.classifications, c.pointCount,
        params.groundGapM ?? DEFAULT_VEG_GROUND_GAP,
        groundGrid, params.groundRoughM ?? DEFAULT_VEG_GROUND_ROUGH, { diag: vegDiag },
    );
    // Clamp cliff-edge height artefacts and derive the robust "tallest tree"
    // height (drives the automatic foliage colour scale).
    const vegHeightAuto = heightAboveGround
        ? sanitizeVegHeights(heightAboveGround, c.classifications, c.pointCount, vegDiag) ?? undefined
        : undefined;
    logStage('colors', tColors());
    const shaded: LidarShadedCloudData = {
        kind: 'shaded',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: c.positions,
        normals,
        colors,
        classifications: c.classifications,
        heightAboveGround,
        vegHeightAuto,
        vegDiag,
        vegGroundGrid: groundGrid ?? undefined,
        pointCount: c.pointCount,
        radius: c.radius,
    };
    await enrichForest(shaded, onProgress, params.signal);
    logStage('TOTAL (shaded)', total());
    onProgress({ stage: 'done', message: STAGE_LABELS.done, detail: `${c.pointCount.toLocaleString()} points` });
    return shaded;
}

/**
 * Delaunay mode: build a Delaunay 2.5D ground mesh AND keep a shaded point
 * cloud of every non-ground point. One fetch, two outputs — lets the user
 * toggle vegetation/buildings classes client-side without re-fetching.
 */
export async function fetchLidarDelaunay(
    params: BrowserFetchParams,
): Promise<LidarMixedData> {
    const onProgress = params.onProgress ?? noopProgress;
    const shader = params.shader ?? 'cliff';
    const total = startTimer();
    // Delaunay mode ignores any incoming `classes` filter (we need ground for
    // the mesh AND non-ground for the cloud). The runtime mask in the
    // overlay decides which classes the user actually sees.
    const c = await fetchCommon({ ...params, classes: undefined });

    // Split into ground (class 2) + water (class 9) and the rest. Water
    // points lie on the terrain surface and must be in the mesh to avoid holes
    // over ponds and lakes.
    const { groundPos, groundCount, ngPos, ngCls } = splitGround(c);
    const nonGroundCount = ngCls.length;

    // 1. Ground mesh — Delaunay (cheapest, best with 2.5D ground class).
    onProgress({ stage: 'mesh', message: STAGE_LABELS.mesh, detail: `${groundCount.toLocaleString()} pts sol+eau` });
    const tMesh = startTimer();
    const expectedSpacing = Math.sqrt(params.stride / 10);
    const maxEdge = Math.min(8, Math.max(1.5, expectedSpacing * 10));
    const groundMesh = params.gridMesh
        ? buildGridMesh(groundPos, params.gridCell ?? 1, shader)
        : buildMesh(groundPos, maxEdge, shader);
    const meshVertexCount = groundMesh.positions.length / 3;
    logStage(params.gridMesh ? 'grid' : 'delaunay', tMesh(), `${groundCount.toLocaleString()} pts sol+eau → ${(groundMesh.indices.length / 3).toLocaleString()} tri`);
    const meshData: LidarMeshData = {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: groundMesh.positions,
        normals: groundMesh.normals,
        colors: groundMesh.colors,
        indices: groundMesh.indices,
        vertexCount: meshVertexCount,
        triangleCount: groundMesh.indices.length / 3,
        radius: c.radius,
    };

    // 2. Non-ground shaded cloud — normals + slope colors. Even though
    //    vegetation normals are noisy, they're what the WebGL layer wants.
    //    Height above ground uses per-column stacked clustering blended with the
    //    vertical height over the flat-ground reference built from the mesh's
    //    ground/water points.
    const shadedData = await buildNonGroundShaded(
        c, { pos: ngPos, cls: ngCls, count: nonGroundCount }, shader,
        {
            gapM: params.groundGapM ?? DEFAULT_VEG_GROUND_GAP,
            grid: buildVegGroundGrid(groundPos, groundCount),
            roughM: params.groundRoughM ?? DEFAULT_VEG_GROUND_ROUGH,
        },
        onProgress, params.signal,
    );

    logStage('TOTAL (delaunay)', total());
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
 * Compute area-weighted per-vertex normals (flipped so nz ≥ 0) and slope-based
 * RGBA colors for an indexed triangle mesh. Used by the Poisson path whose
 * output PLY contains only positions + faces.
 */
function normalsAndColorsFromMesh(
    positions: Float32Array,
    indices: Uint32Array,
    shader: ShaderPreset = 'cliff',
): {
    normals: Float32Array;
    colors: Uint8Array;
    roughness: Float32Array;
} {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    // Track Σ|face_normal| per vertex; comparing it to |Σface_normal| after
    // accumulation gives a coherence metric in [0,1] — high on smooth slabs,
    // low on rocky outcrops where neighbour faces disagree. Used below to
    // darken & desaturate rugged areas so they pop visually.
    const sumMag = new Float32Array(n);
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
        const mag = Math.hypot(nx, ny, nz);
        sumMag[ia] += mag; sumMag[ib] += mag; sumMag[ic] += mag;
    }
    const colors = new Uint8Array(n * 4);
    const roughnessArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        // Compute coherence BEFORE normalizing (len = |Σ face_normals| pre-normalized)
        const coherence = sumMag[i] > 0 ? len / sumMag[i] : 1;
        roughnessArr[i] = 1 - coherence;
        if (len > 0) {
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            normals[i * 3 + 2] = 1;
        }
        // Rocky-outcrop detection: coherence = |Σ face_normals| / Σ|face_normals|.
        // Near 1 = smooth slab; near 0 = faces diverge = boulder / crevice.
        // We blend the palette colour toward dark grey so rough surfaces pop
        // sharply against the surrounding material regardless of slope.
        // Parameters are intentionally aggressive to create visible rock texture:
        //   dead-zone < 0.05: perfectly smooth mesh cells are untouched
        //   ramp 0.05 → 0.32: transitions quickly
        //   max blend 80 %: fully rough = almost dark grey
        const z = positions[i * 3 + 2];
        const [cr, cg, cb] = vertexColor(
            normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2],
            z, shader, roughnessArr[i],
        );
        colors[i * 4] = cr;
        colors[i * 4 + 1] = cg;
        colors[i * 4 + 2] = cb;
        colors[i * 4 + 3] = 255;
    }
    // roughnessArr is stored so callers can recolorize without re-fetching.
    return { normals, colors, roughness: roughnessArr };
}

/**
 * Poisson reconstruction mode: ground points → per-point normals via k-NN
 * PCA → PoissonRecon WASM (octree solver) → triangle mesh. Mirrors the
 * mixed mode by also returning a shaded point cloud of every non-ground
 * point (vegetation, buildings, …) so the user can toggle classes without
 * re-fetching.
 */
export async function fetchLidarPoisson(
    params: BrowserFetchParams,
): Promise<LidarMixedData> {
    const onProgress = params.onProgress ?? noopProgress;
    const depth = Math.max(6, Math.min(12, Math.floor(params.poissonDepth ?? 9)));
    const shader = params.shader ?? 'cliff';
    const total = startTimer();

    // Fetch every class — Poisson reconstruction uses only ground, but the
    // overlay uses everything else. Scan dimensions feed flight-line orientation.
    const c = await fetchCommon({ ...params, classes: undefined }, { needScan: true });

    // Split ground (class 2) from the rest (with the ground scan subset).
    const { groundPos, groundCount, ngPos, ngCls, groundScan } = splitGround(c);
    const nonGroundCount = ngCls.length;

    // Decimate the ground subset further for the (slow) reconstruction only:
    // the absolute `poissonGroundStride` lets the ground/water be sampled more
    // coarsely than the vegetation. The full `groundPos` still feeds the
    // veg-height ground grid below so foliage heights stay accurate.
    const extractionStride = Math.max(1, Math.floor(params.stride));
    const groundStride = Math.max(extractionStride, Math.floor(params.poissonGroundStride ?? extractionStride));
    const extraGroundStride = Math.max(1, Math.round(groundStride / extractionStride));
    const ps = decimateGround(groundPos, groundCount, groundScan, extraGroundStride);
    const psCount = ps.count;

    // 1. Ground mesh via PoissonRecon.
    onProgress({
        stage: 'normals',
        message: STAGE_LABELS.normals,
        detail: `${psCount.toLocaleString()} pts sol`,
    });
    const tGroundNrm = startTimer();
    // Poisson needs a *coherently oriented* gradient field, not an upward one:
    // forcing nz≥0 flips the normals under overhangs, arches and cave roofs so
    // the solver can't represent those cavities and seals them into smooth
    // "bubbles". Compute unoriented normals + a PCA fit-quality score, then
    // cascade a consistent orientation from the strongest cues outward
    // (laser scan-angle → +z prior → quality-weighted propagation) and weight
    // each normal by quality so crisp points drive the isosurface.
    const groundQuality = new Float32Array(psCount);
    const groundNormals = await computeNormalsKNNAsync(ps.pos, 12, 2, false, groundQuality);
    orientNormalsForPoisson(ps.pos, groundNormals, groundQuality, ps.scan);
    logStage('normals (sol)', tGroundNrm(), `${psCount.toLocaleString()} pts${ps.scan ? ' · scan' : ''}`);
    // Interleave [x,y,z,nx,ny,nz] for PoissonRecon's PLY input.
    const oriented = new Float32Array(psCount * 6);
    for (let i = 0; i < psCount; i++) {
        oriented[i * 6] = ps.pos[i * 3];
        oriented[i * 6 + 1] = ps.pos[i * 3 + 1];
        oriented[i * 6 + 2] = ps.pos[i * 3 + 2];
        oriented[i * 6 + 3] = groundNormals[i * 3];
        oriented[i * 6 + 4] = groundNormals[i * 3 + 1];
        oriented[i * 6 + 5] = groundNormals[i * 3 + 2];
    }
    onProgress({
        stage: 'mesh',
        message: STAGE_LABELS.mesh,
        detail: `Poisson depth ${depth}`,
    });
    const tPoisson = startTimer();
    const mesh = await reconstructPoisson(oriented, {
        depth,
        samplesPerNode: params.poissonSamplesPerNode,
        pointWeight: params.poissonPointWeight,
        onPhase: (label, fraction) => onProgress({
            stage: 'mesh',
            message: STAGE_LABELS.mesh,
            detail: `Poisson depth ${depth} · ${label}`,
            progress: fraction,
        }),
    });
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;
    logStage('poisson', tPoisson(), `depth ${depth} → ${vertexCount.toLocaleString()} verts / ${triangleCount.toLocaleString()} tri`);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors, detail: 'mesh sol' });
    const tMeshCol = startTimer();
    const { normals: meshNrm, colors: meshCols, roughness: meshRoughness } = normalsAndColorsFromMesh(mesh.positions, mesh.indices, shader);
    logStage('colors (mesh sol)', tMeshCol());
    const meshData: LidarMeshData = {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: mesh.positions,
        normals: meshNrm,
        colors: meshCols,
        roughness: meshRoughness,
        indices: mesh.indices,
        vertexCount,
        triangleCount,
        radius: c.radius,
    };

    // 2. Non-ground shaded cloud overlay. Height above ground uses per-column
    //    stacked clustering blended with the vertical height over the flat-ground
    //    reference built from the Poisson ground/water points.
    const shadedData = await buildNonGroundShaded(
        c, { pos: ngPos, cls: ngCls, count: nonGroundCount }, shader,
        {
            gapM: params.groundGapM ?? DEFAULT_VEG_GROUND_GAP,
            grid: buildVegGroundGrid(groundPos, groundCount),
            roughM: params.groundRoughM ?? DEFAULT_VEG_GROUND_ROUGH,
        },
        onProgress, params.signal,
    );

    logStage('TOTAL (poisson)', total());
    onProgress({
        stage: 'done',
        message: STAGE_LABELS.done,
        detail: `${triangleCount.toLocaleString()} tri + ${nonGroundCount.toLocaleString()} pts`,
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
