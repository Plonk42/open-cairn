/**
 * Browser-side LiDAR HD pipeline. Orchestrates:
 *   1. WFS query   → tile URLs
 *   2. COPC walk   → cropped points (parallel across tiles)
 *   3. mode-specific finalization (shaded cloud / mixed)
 *
 * Returns the same data shapes as `src/lib/lidarCloud.ts` types.
 */
import type { LidarMeshData, LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import {
    adaptiveDecimateGround, DEFAULT_ADAPTIVE_CELL_M,
    DEFAULT_ADAPTIVE_RESIDUAL_M, DEFAULT_ADAPTIVE_SIGMA_TOL,
} from './adaptiveDecimate';
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
import { buildPoissonBase, buildPoissonBaseMask, poissonBaseWallPerimM, resolvePoissonBaseRect } from './poissonBase';
import { reconstructPoisson } from './poissonRecon';
import { noopProgress, STAGE_LABELS, type ProgressCallback } from './progress';
import { l93AxisToGeographicEnu, l93OffsetsToGeographicEnu, l93RectAxes, lngLatToL93 } from './proj';
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
    /** Post-Poisson unsharp masking of the mesh positions, 0..1 (0 = off).
     *  Recovers part of the high-frequency relief the solver smooths away.
     *  See `sharpenMeshPositions`. Default 0.5. */
    poissonSharpen?: number;
    /** Crease-preserving robust refit of the ground normals fed to the solver,
     *  0..1 (0 = plain k-NN PCA). See `refineNormalRobust`. Default 0.6. */
    poissonNormalRobust?: number;
    /** Poisson mode: synthesize a flat parallelepiped "brick" base (floor + walls)
     *  under the terrain so the underside is flat instead of a bulging cushion.
     *  Default true. */
    poissonFlatBase?: boolean;
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
 * LAS classes that make up the terrain surface: ground (2) + water (9). Used
 * both to split the cloud and to keep these classes at full density during the
 * Poisson extraction (their density is governed solely by the adaptive
 * "Densité sol/eau" decimation, independently of the non-ground stride).
 */
const GROUND_WATER_CLASSES = new Set([2, 9]);

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

/**
 * Run steps 1+2 (WFS query → COPC extract on every covering tile, in
 * parallel) and return the merged point set. Used by all three modes.
 *
 * When `opts.needScan` is set, per-point ScanAngle / PointSourceId / GpsTime are
 * also decoded (Poisson mode uses them for flight-line normal orientation).
 */
async function fetchCommon(params: BrowserFetchParams, opts?: { needScan?: boolean; fullDensityClasses?: Set<number> }): Promise<{
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
            fullDensityClasses: opts?.fullDensityClasses ?? null,
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
    // Points are decoded as Lambert-93 grid offsets; rotate them into a true
    // geographic east/north frame so the renderer (which treats them as ENU)
    // places them exactly — otherwise the L93 meridian convergence turns each
    // cloud ~γ about its centre and overlapping captures drift apart by a few
    // metres in their shared area.
    l93OffsetsToGeographicEnu(positions, totalPts, params.lng, params.lat);
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
 * Umbrella (Laplacian) smoothing passes applied to the mesh SHADING normals.
 *
 * Airborne LiDAR only grazes the steep alpine faces, so the Poisson surface
 * there is genuinely shredded: neighbouring vertices get normals pointing in
 * wildly different directions and the render breaks into per-vertex speckle,
 * by far the most visible artefact on a north face. Smoothing the normal field
 * (and only the normal field — positions, and therefore the silhouette and the
 * cast shadows, are untouched) removes the high-frequency shading noise while
 * keeping the real relief. Two passes is the point where the speckle is gone
 * but arêtes are still crisp.
 *
 * The passes are crease-aware (see `smoothVertexNormals`), so they no longer
 * erode the edges they used to round off. See
 * `docs/ROCK_AND_CLIFF_DETAIL.md` §2.B.3.
 */
const NORMAL_SMOOTHING_PASSES = 2;

/**
 * Beyond this angle between two vertex normals, the pair is considered to sit
 * across a crease and is not averaged. cos 35° ≈ 0.82: below that the two
 * facets still belong to the same slab, above it we are on an arête, a block
 * edge or a ledge — exactly the features the old isotropic pass melted.
 */
const NORMAL_EDGE_COS = 0.82;

/**
 * Mean neighbour agreement below which a vertex is treated as *shredded*
 * rather than *featured*. On a real arête roughly half the one-ring still
 * agrees, so agreement stays well above this; in a patch of pure
 * reconstruction noise almost nothing agrees, and there the crease-aware pass
 * would preserve the speckle it is supposed to remove. Such vertices fall back
 * to plain isotropic averaging.
 */
const NORMAL_SHRED_AGREE = 0.35;

/** smoothstep(0,1,x) sur un x déjà normalisé. */
function smoothstep01(x: number): number {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

/**
 * Poids d'un voisin en fonction du cosinus entre les deux normales : 1 quand
 * elles coïncident, 0 dès qu'on franchit `NORMAL_EDGE_COS` (l'arête).
 */
function creaseWeight(cosine: number, invEdge: number): number {
    return cosine <= NORMAL_EDGE_COS ? 0 : (cosine - NORMAL_EDGE_COS) * invEdge;
}

/** Une passe Jacobi : accumule les deux moyennes (isotrope et anisotrope). */
function accumulateNormalPass(
    indices: Uint32Array,
    normals: Float32Array,
    accAniso: Float32Array,
    accIso: Float32Array,
    agreeSum: Float32Array,
    agreeCount: Float32Array,
): void {
    const invEdge = 1 / (1 - NORMAL_EDGE_COS);
    for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
        const a = ia * 3, b = ib * 3, c = ic * 3;
        const ax = normals[a], ay = normals[a + 1], az = normals[a + 2];
        const bx = normals[b], by = normals[b + 1], bz = normals[b + 2];
        const cx = normals[c], cy = normals[c + 1], cz = normals[c + 2];

        const sx = ax + bx + cx, sy = ay + by + cy, sz = az + bz + cz;
        accIso[a] += sx; accIso[a + 1] += sy; accIso[a + 2] += sz;
        accIso[b] += sx; accIso[b + 1] += sy; accIso[b + 2] += sz;
        accIso[c] += sx; accIso[c + 1] += sy; accIso[c + 2] += sz;

        // Les normales sont unitaires ici : le produit scalaire EST le cosinus.
        const wab = creaseWeight(ax * bx + ay * by + az * bz, invEdge);
        const wac = creaseWeight(ax * cx + ay * cy + az * cz, invEdge);
        const wbc = creaseWeight(bx * cx + by * cy + bz * cz, invEdge);

        // Le sommet lui-même garde le poids 1 (une fois par triangle incident,
        // exactement comme dans l'accumulateur isotrope : les deux restent
        // ainsi comparables).
        accAniso[a] += ax + wab * bx + wac * cx;
        accAniso[a + 1] += ay + wab * by + wac * cy;
        accAniso[a + 2] += az + wab * bz + wac * cz;
        accAniso[b] += bx + wab * ax + wbc * cx;
        accAniso[b + 1] += by + wab * ay + wbc * cy;
        accAniso[b + 2] += bz + wab * az + wbc * cz;
        accAniso[c] += cx + wac * ax + wbc * bx;
        accAniso[c + 1] += cy + wac * ay + wbc * by;
        accAniso[c + 2] += cz + wac * az + wbc * bz;

        agreeSum[ia] += wab + wac; agreeCount[ia] += 2;
        agreeSum[ib] += wab + wbc; agreeCount[ib] += 2;
        agreeSum[ic] += wac + wbc; agreeCount[ic] += 2;
    }
}

/** Mélange les deux moyennes selon l'accord du voisinage, et réécrit `normals`. */
function resolveNormalPass(
    normals: Float32Array,
    accAniso: Float32Array,
    accIso: Float32Array,
    agreeSum: Float32Array,
    agreeCount: Float32Array,
): void {
    const n = normals.length / 3;
    for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const agree = agreeCount[i] > 0 ? agreeSum[i] / agreeCount[i] : 1;
        const toIso = 1 - smoothstep01(agree / NORMAL_SHRED_AGREE);
        // Les deux accumulateurs sont renormalisés avant mélange : leurs
        // magnitudes brutes diffèrent par construction (l'isotrope n'est jamais
        // amputé des voisins rejetés) et, sans ça, le mélange serait dominé par
        // le plus long des deux.
        const la = Math.hypot(accAniso[i3], accAniso[i3 + 1], accAniso[i3 + 2]);
        const li = Math.hypot(accIso[i3], accIso[i3 + 1], accIso[i3 + 2]);
        const ka = la > 0 ? (1 - toIso) / la : 0;
        const ki = li > 0 ? toIso / li : 0;
        const x = accAniso[i3] * ka + accIso[i3] * ki;
        const y = accAniso[i3 + 1] * ka + accIso[i3 + 1] * ki;
        const z = accAniso[i3 + 2] * ka + accIso[i3 + 2] * ki;
        const len = Math.hypot(x, y, z);
        // Un sommet sans triangle survivant garde ce qu'il avait.
        if (len === 0) continue;
        normals[i3] = x / len;
        normals[i3 + 1] = y / len;
        normals[i3 + 2] = z / len;
    }
}

/**
 * Average each vertex normal with its one-ring neighbours, `passes` times,
 * *without crossing creases*.
 *
 * Neighbours are enumerated straight from the index buffer — every triangle
 * contributes its three normals to each of its three vertices — which is a
 * valence-weighted umbrella operator. That is deliberately cheap: the meshes
 * here reach ten million vertices, so building an explicit adjacency structure
 * would cost more memory than the mesh itself. Scratch buffers are reused
 * across passes, and each pass is Jacobi (it reads the previous state only).
 *
 * Each neighbour is weighted by how well it agrees with the vertex being
 * smoothed, the weight falling to zero past `NORMAL_EDGE_COS`. A vertex whose
 * one-ring agrees with it almost nowhere is not on a feature but in a patch of
 * reconstruction noise, and blends back toward the isotropic mean so the
 * speckle is still removed.
 */
function smoothVertexNormals(indices: Uint32Array, normals: Float32Array, passes: number): void {
    if (passes <= 0) return;
    const n = normals.length / 3;
    const accAniso = new Float32Array(normals.length);
    const accIso = new Float32Array(normals.length);
    const agreeSum = new Float32Array(n);
    const agreeCount = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
        accAniso.fill(0);
        accIso.fill(0);
        agreeSum.fill(0);
        agreeCount.fill(0);
        accumulateNormalPass(indices, normals, accAniso, accIso, agreeSum, agreeCount);
        resolveNormalPass(normals, accAniso, accIso, agreeSum, agreeCount);
    }
}

/**
 * Déplacement maximal autorisé par la netteté, en fraction de la longueur
 * moyenne des arêtes incidentes. Le masque flou amplifie indistinctement le
 * relief réel et le bruit de tessellation ; ce plafond garantit qu'aucun
 * sommet ne peut se détacher en pointe de son voisinage, quel que soit le
 * réglage.
 */
const MESH_SHARPEN_MAX_RATIO = 0.30;

/**
 * Masque flou (unsharp masking) sur le champ de POSITIONS du maillage.
 *
 * Le solveur de Poisson résout un champ scalaire lisse : il restitue
 * fidèlement les basses fréquences du terrain mais atténue systématiquement
 * les hautes — exactement les vires, les fissures et les ressauts qui font
 * lire le rocher. On récupère une partie de cette atténuation comme un
 * photographe récupère la netteté d'un scan : en soustrayant la version floue
 * de l'original, c'est-à-dire en éloignant chaque sommet de la moyenne de son
 * anneau de voisins.
 *
 * Effet nul sur toute surface localement plane (le sommet EST déjà sa
 * moyenne) : le socle synthétique, son fond et ses murs verticaux ne bougent
 * donc pas, sans qu'on ait besoin de les masquer explicitement. Les positions
 * étant modifiées, silhouette et ombres portées suivent — c'est voulu, et
 * c'est aussi pourquoi le déplacement est plafonné.
 *
 * Voir docs/ROCK_AND_CLIFF_DETAIL.md §2.B.5.
 */
function sharpenMeshPositions(indices: Uint32Array, positions: Float32Array, amount: number): void {
    if (amount <= 0) return;
    const n = positions.length / 3;
    const ring = new Float32Array(positions.length);
    const ringCount = new Float32Array(n);
    const edgeSum = new Float32Array(n);
    for (let t = 0; t < indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const i3 = indices[t + k] * 3;
            const j3 = indices[t + ((k + 1) % 3)] * 3;
            const l3 = indices[t + ((k + 2) % 3)] * 3;
            const jx = positions[j3] - positions[i3];
            const jy = positions[j3 + 1] - positions[i3 + 1];
            const jz = positions[j3 + 2] - positions[i3 + 2];
            const lx = positions[l3] - positions[i3];
            const ly = positions[l3 + 1] - positions[i3 + 1];
            const lz = positions[l3 + 2] - positions[i3 + 2];
            ring[i3] += positions[j3] + positions[l3];
            ring[i3 + 1] += positions[j3 + 1] + positions[l3 + 1];
            ring[i3 + 2] += positions[j3 + 2] + positions[l3 + 2];
            // Chaque voisin est compté une fois par triangle incident : c'est
            // une pondération par valence, la même que pour les normales.
            ringCount[indices[t + k]] += 2;
            edgeSum[indices[t + k]] += Math.hypot(jx, jy, jz) + Math.hypot(lx, ly, lz);
        }
    }
    for (let i = 0; i < n; i++) {
        const cnt = ringCount[i];
        if (cnt === 0) continue;
        const i3 = i * 3;
        const dx = positions[i3] - ring[i3] / cnt;
        const dy = positions[i3 + 1] - ring[i3 + 1] / cnt;
        const dz = positions[i3 + 2] - ring[i3 + 2] / cnt;
        const d = Math.hypot(dx, dy, dz);
        if (d === 0) continue;
        const maxD = MESH_SHARPEN_MAX_RATIO * (edgeSum[i] / cnt);
        const scale = Math.min(amount * d, maxD) / d;
        positions[i3] += dx * scale;
        positions[i3 + 1] += dy * scale;
        positions[i3 + 2] += dz * scale;
    }
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
    }
    smoothVertexNormals(indices, normals, NORMAL_SMOOTHING_PASSES);
    for (let i = 0; i < n; i++) {
        // Rocky-outcrop detection: coherence = |Σ face_normals| / Σ|face_normals|.
        // Near 1 = smooth slab; near 0 = boulder / crevice / reconstruction noise.
        // The palette uses it as a weak albedo cue (see `montagneGround`).
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

    // Fetch every class. Ground+water are kept at FULL density (exempt from the
    // non-ground `stride`) so the terrain surface is governed solely by the
    // adaptive "Densité sol/eau" decimation below; the non-ground overlay is
    // decimated by `stride` ("Densité non-sol"). Scan dimensions feed
    // flight-line orientation.
    const c = await fetchCommon(
        { ...params, classes: undefined },
        { needScan: true, fullDensityClasses: GROUND_WATER_CLASSES },
    );

    // Split ground (class 2) from the rest (with the ground scan subset).
    const { groundPos, groundCount, ngPos, ngCls, groundScan } = splitGround(c);
    const nonGroundCount = ngCls.length;

    // Curvature-adaptive decimation of the (full-density) ground before the slow
    // reconstruction. `flatStride` is the absolute "Densité sol/eau" value — it
    // only thins locally-planar cells, so cliffs, ridges, faults and cave mouths
    // keep full density regardless of orientation. The full `groundPos` still
    // feeds the veg-height ground grid below so foliage heights stay accurate.
    const flatStride = Math.max(1, Math.floor(params.poissonGroundStride ?? 1));
    const tDecim = startTimer();
    const ps = adaptiveDecimateGround(groundPos, groundCount, groundScan, {
        cellM: DEFAULT_ADAPTIVE_CELL_M,
        flatStride,
        sigmaTol: DEFAULT_ADAPTIVE_SIGMA_TOL,
        residualTol: DEFAULT_ADAPTIVE_RESIDUAL_M,
    });
    const psCount = ps.count;
    logStage('decim (sol)', tDecim(), `${groundCount.toLocaleString()} → ${psCount.toLocaleString()} pts · stride ${flatStride} · -${groundCount ? Math.round((1 - psCount / groundCount) * 100) : 0}%`);

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
    // The fit is robust (crease-preserving): a plain k-NN fit averages across
    // ridges and ledges and hands the solver a smooth ramp where there is an
    // edge — see `refineNormalRobust`.
    const groundQuality = new Float32Array(psCount);
    const normalRobust = params.poissonNormalRobust ?? 0.6;
    const groundNormals = await computeNormalsKNNAsync(ps.pos, 12, 2, false, groundQuality, normalRobust);
    orientNormalsForPoisson(ps.pos, groundNormals, groundQuality, ps.scan);
    const robustNote = normalRobust > 0 ? ` · arêtes ${normalRobust}` : '';
    logStage('normals (sol)', tGroundNrm(), `${psCount.toLocaleString()} pts${ps.scan ? ' · scan' : ''}${robustNote}`);
    // Flat "brick" base: synthesize oriented floor + wall points below the
    // terrain so Poisson closes the underside into a flat parallelepiped instead
    // of a bulging cushion. Reused as the veg-height reference grid below.
    const groundGrid = buildVegGroundGrid(groundPos, groundCount);
    let rectOpt: { ux: number; uy: number; halfLengthM: number; halfWidthM: number } | undefined;
    if (params.rect) {
        // The base is built on ground points already rotated into the ENU frame
        // by l93OffsetsToGeographicEnu, so its walls must follow the capture
        // rectangle turned by that SAME meridian convergence — not the raw L93
        // grid axes, which would tilt the walls off the terrain.
        const l93 = l93RectAxes(params.lng, params.lat, params.rect.bearingDeg);
        const enu = l93AxisToGeographicEnu(l93.ux, l93.uy, params.lng, params.lat);
        rectOpt = {
            ux: enu.ux,
            uy: enu.uy,
            halfLengthM: params.rect.halfLengthM,
            halfWidthM: params.rect.halfWidthM,
        };
    }
    const flatBaseRect = (params.poissonFlatBase ?? true) && groundGrid
        ? resolvePoissonBaseRect(groundGrid, rectOpt)
        : null;
    const tFlatBase = startTimer();
    const flatBase = flatBaseRect && groundGrid
        ? buildPoissonBase(groundGrid, { depth, rect: flatBaseRect })
        : new Float32Array(0);
    // Interleave [x,y,z,nx,ny,nz] for PoissonRecon's PLY input, then append the
    // pre-oriented base points (their normals are hand-set, not KNN-estimated).
    const oriented = new Float32Array(psCount * 6 + flatBase.length);
    for (let i = 0; i < psCount; i++) {
        oriented[i * 6] = ps.pos[i * 3];
        oriented[i * 6 + 1] = ps.pos[i * 3 + 1];
        oriented[i * 6 + 2] = ps.pos[i * 3 + 2];
        oriented[i * 6 + 3] = groundNormals[i * 3];
        oriented[i * 6 + 4] = groundNormals[i * 3 + 1];
        oriented[i * 6 + 5] = groundNormals[i * 3 + 2];
    }
    if (flatBase.length) {
        oriented.set(flatBase, psCount * 6);
        logStage('socle plat', tFlatBase(), `+${(flatBase.length / 6).toLocaleString()} pts base`);
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
        // Ground normals are already scaled by PCA fit quality in
        // orientNormalsForPoisson (weightByQuality); `--confidence` makes the
        // solver honor that magnitude instead of normalizing it away, so crisp
        // points drive the isosurface and uncertain ones interpolate softly.
        confidence: true,
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
    const tSharpen = startTimer();
    const sharpen = params.poissonSharpen ?? 0.5;
    sharpenMeshPositions(mesh.indices, mesh.positions, sharpen);
    if (sharpen > 0) logStage('netteté', tSharpen(), `amount ${sharpen}`);
    onProgress({ stage: 'colors', message: STAGE_LABELS.colors, detail: 'mesh sol' });
    const tMeshCol = startTimer();
    const { normals: meshNrm, colors: meshCols, roughness: meshRoughness } = normalsAndColorsFromMesh(mesh.positions, mesh.indices, shader);
    logStage('colors (mesh sol)', tMeshCol());
    let baseMask: Uint8Array | undefined;
    if (flatBaseRect && groundGrid) {
        const perimM = poissonBaseWallPerimM(groundGrid, depth);
        baseMask = buildPoissonBaseMask(mesh.positions, meshNrm, flatBaseRect, perimM);
    }
    const meshData: LidarMeshData = {
        kind: 'mesh',
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        positions: mesh.positions,
        normals: meshNrm,
        colors: meshCols,
        roughness: meshRoughness,
        baseMask,
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
            grid: groundGrid,
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
