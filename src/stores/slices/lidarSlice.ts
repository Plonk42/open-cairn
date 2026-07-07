import {
    fetchLidarDelaunay,
    fetchLidarPoisson,
    fetchLidarShaded,
    type LidarProgress,
} from '@/lib/lidarBrowser';
import type { ForestEdgeBlend, ForestGrouping } from '@/lib/lidarBrowser/bdforet';
import { buildVegGroundGrid, computeVegHeights, DEFAULT_VEG_COLUMN_CELL_M, DEFAULT_VEG_GROUND_CELL_M, DEFAULT_VEG_GROUND_GAP, DEFAULT_VEG_GROUND_ROUGH, DEFAULT_VEG_OVERHANG_REACH_M, DEFAULT_VEG_ROUGH_LOW_FRAC, DEFAULT_VEG_SLOPE_SAMPLE_M, sanitizeVegHeights, type VegCliffDistMode, type VegGroundGrid } from '@/lib/lidarBrowser/groundHeight';
import { colorsFromNormals, recolorMeshVertices, type ShaderPreset } from '@/lib/lidarBrowser/slope';
import { cancelLidarWorkerRequests } from '@/lib/lidarBrowser/workerClient';
import {
    clampRectToArea, LIDAR_RECT_MAX_AREA_M2, rectEnclosingRadiusM,
    screenUpAzimuthDeg, type CaptureRectDims,
} from '@/lib/lidarCaptureRect';
import type { LidarMeshData, LidarShadedCloudData, VegColorMode } from '@/lib/lidarCloud';
import { makeCloudKey, saveLoadedCloud } from '@/lib/savedClouds';
import { formatSunDate, todaySunDatePart } from '@/lib/sun';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import { persisted, type PersistedSettings } from '../persistence';

/** Maximum capture area (m²) allowed in Poisson mode (WASM heap / octree limit).
 *  1 000 000 m² = 1 km² = a 1000 × 1000 m zone. */
export const POISSON_MAX_AREA_M2 = 1_000_000;

/**
 * Debug-only live snapshot of the WebGL layer's current LOD levels (see
 * `isLodDebugEnabled`), returned by `LidarWebGLLayer.getLodDebugInfo()` and
 * polled by `LidarCloudOverlay`. Declared locally (rather than imported from
 * the WebGL layer) so this store slice doesn't pull the GLSL shader module
 * graph into contexts — e.g. the vitest tsconfig — that lack the `*.frag`/
 * `*.vert` ambient module declarations.
 */
export interface LidarLodDebugInfo {
    zoom: number;
    pointLevel: number;
    pointRatio: number;
    pointReady: boolean;
    meshLevel: number;
    meshRatio: number;
    meshReady: boolean;
    meshTriangleCount: number;
    meshDisplayedTriangleCount: number;
}

/**
 * Resolve the area to fetch for the next capture: the centred capture rectangle
 * (clamped to `maxArea`), oriented north when `northFixed` is set, otherwise
 * along the live camera bearing. `radius` is the enclosing-circle radius so
 * tile/node selection covers the whole footprint.
 */
function captureGeometry(
    rect: CaptureRectDims,
    map: MapState['mapInstance'],
    maxArea: number,
    northFixed: boolean,
): { radius: number; rect: { halfWidthM: number; halfLengthM: number; bearingDeg: number } } {
    const { widthM, lengthM } = clampRectToArea(rect.widthM, rect.lengthM, maxArea);
    return {
        radius: rectEnclosingRadiusM(widthM, lengthM),
        rect: {
            halfWidthM: widthM / 2,
            halfLengthM: lengthM / 2,
            bearingDeg: northFixed || !map ? 0 : screenUpAzimuthDeg(map),
        },
    };
}

/** Rendering mode: shaded point cloud, delaunay (2.5D ground mesh + points), or poisson (WASM ground mesh + points). */
export type LidarMode = 'shaded' | 'delaunay' | 'poisson';

/** Vegetation height-decision diagnostic render mode. 'off' uses the normal
 *  foliage colouring; the others paint a false-colour map driven by the
 *  per-point `vegDiag` buffer (see « Analyse hauteur »). */
export type LidarVegDiagMode = 'off' | 'decision' | 'clusters' | 'roughness' | 'flags';

/**
 * One simultaneously-displayed cloud/mesh entry. Multiple can be loaded at
 * once (see `addLidarCloudSnapshot`); `lidarClouds[0]` is the "primary"
 * cloud — the one every single-target tool (cliff-slice, postcard export,
 * veg-height diagnostics/recompute) operates on, mirrored into the flat
 * `lidarShaded`/`lidarMesh` fields below so those tools need no changes.
 */
export interface LoadedLidarCloud {
    id: string;
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    /** Whether this cloud/mesh is currently drawn (hidden clouds stay loaded). */
    visible: boolean;
    createdAt: number;
    mode: LidarMode;
    /** Dedupe key matching `SavedCloud.key` — used to badge/skip already-loaded "Nuages récents" entries in the Gallery. */
    sourceKey?: string;
    /** Matches a showcase `GalleryEntry.id` / `SavedScene.id` — used to badge/skip already-loaded Gallery scenes. */
    sourceSceneId?: string;
}

export interface LidarSlice {
    /** Rendering mode: shaded point cloud, delaunay (Delaunay 2.5D ground mesh + points), or poisson (PoissonRecon WASM ground mesh + points). */
    lidarMode: LidarMode;
    setLidarMode: (v: LidarMode) => void;
    /** Colour shader preset for geometry colorization. */
    lidarShader: ShaderPreset;
    setLidarShader: (v: ShaderPreset) => void;
    /** Loaded shaded point cloud (positions + normals + slope colors) — mirrors `lidarClouds[0]`. */
    lidarShaded: LidarShadedCloudData | null;
    /** Loaded ground mesh for delaunay / poisson modes — mirrors `lidarClouds[0]`. */
    lidarMesh: LidarMeshData | null;
    /** Every simultaneously-displayed cloud/mesh, oldest ("primary") first. */
    lidarClouds: LoadedLidarCloud[];
    /**
     * Distance-based level-of-detail: decimate the point cloud/mesh as the
     * camera zooms out. Debug-only toggle (see `isLodDebugEnabled`), always on
     * otherwise, so deliberately not persisted.
     */
    lidarLodEnabled: boolean;
    setLidarLodEnabled: (v: boolean) => void;
    /**
     * Debug-only override: pins the point/mesh LOD to a specific level (0/1/2)
     * regardless of zoom, so a level's visual effect can be inspected without
     * having to zoom out to reach it. `null` = normal zoom-driven behaviour.
     * Not persisted (debug-only, like `lidarLodEnabled`).
     */
    lidarLodForceLevel: number | null;
    setLidarLodForceLevel: (v: number | null) => void;
    /**
     * Debug-only: draw the reconstructed ground mesh as a plain wireframe (no
     * lighting, no texture) so the triangle density is directly visible. The
     * toggle is only surfaced when `isMeshWireframeDebugEnabled()`; defaults
     * off (the `?debug` flag reveals the control, it never activates it). Not
     * persisted.
     */
    lidarMeshWireframe: boolean;
    setLidarMeshWireframe: (v: boolean) => void;
    /** Debug-only live snapshot of the WebGL layer's current LOD levels (see
     *  `isLodDebugEnabled`), polled by `LidarCloudOverlay`. Not persisted. */
    lidarLodDebugInfo: LidarLodDebugInfo | null;
    setLidarLodDebugInfo: (v: LidarLodDebugInfo | null) => void;
    /** True while a LiDAR request is in flight. */
    lidarCloudLoading: boolean;
    /** Last error message (null if no error). */
    lidarCloudError: string | null;
    /** Current loading progress. */
    lidarCloudProgress: LidarProgress | null;
    /** Decimation factor (1 = full density, N = keep 1/N points). */
    lidarCloudStride: number;
    setLidarCloudStride: (v: number) => void;
    /** Poisson mode only: separate (coarser) decimation for the ground/water
     *  points fed to the reconstruction, so the slow mesh build can be sped up
     *  without thinning the vegetation overlay. Absolute, like lidarCloudStride. */
    lidarCloudGroundStride: number;
    setLidarCloudGroundStride: (v: number) => void;
    /** Delaunay sub-mode: smooth ground via grid heightfield (true) or raw Delaunay (false). */
    lidarMeshSmooth: boolean;
    setLidarMeshSmooth: (v: boolean) => void;
    /** Grid resolution (m) for the smooth Delaunay surface. */
    lidarGridCell: number;
    setLidarGridCell: (v: number) => void;
    /** Vertical gap (m) above which stacked vegetation masses (trees on different
     *  cliff ledges, or a tree leaning on the face) are counted separately when
     *  measuring height above ground. Drives the foliage colour ramp. */
    lidarVegGroundGap: number;
    setLidarVegGroundGap: (v: number) => void;
    /** Local ground relief (m) above which the hybrid height keeps the
     *  cliff-correct stacked metric; below it trusts the vertical-to-ground
     *  height so spreading broadleaf crowns recover their full height. 0 = pure
     *  stacked. Drives the foliage colour ramp. */
    lidarVegGroundRough: number;
    setLidarVegGroundRough: (v: number) => void;
    /** XY column footprint (m) for the stacked clustering metric. Smaller
     *  separates neighbouring trunks more eagerly; larger merges them. */
    lidarVegColumnCell: number;
    setLidarVegColumnCell: (v: number) => void;
    /** Lower edge of the relief blend transition as a fraction of the rough
     *  threshold (below it the height fully trusts vertical-to-ground). */
    lidarVegRoughLowFrac: number;
    setLidarVegRoughLowFrac: (v: number) => void;
    /** Crown overhang reach (m): how far a floating crown point may be anchored
     *  to nearby higher cliff-top ground. */
    lidarVegOverhangReach: number;
    setLidarVegOverhangReach: (v: number) => void;
    /** Cliff vegetation height mode (experimental): on points classified falaise,
     *  replace the per-column stacked height with a distance metric — `column`
     *  (default, unchanged), `rimDepth`, `surface3d` or `wallHoriz`. Only cliff
     *  points are affected; pente/surplomb keep their normal height. */
    lidarVegCliffDistMode: VegCliffDistMode;
    setLidarVegCliffDistMode: (v: VegCliffDistMode) => void;
    /** Final colour-smoothing strength (0..1): spatially low-passes the rendered
     *  height so adjacent columns blend into a continuous gradient, hiding the
     *  sharp "camouflage" patchwork of sparse cliff LiDAR. 0 = off. */
    lidarVegColorSmooth: number;
    setLidarVegColorSmooth: (v: number) => void;
    /** Sparse-cluster fallback (points): falaise points alone in a vertical
     *  cluster of at most this many returns fall back to the horizontal wall
     *  distance instead of the stacked height that pins a lone return to 0 (a
     *  dark brown speck). 0 = off. Only acts in `column` cliff mode. */
    lidarVegCliffSparseFallback: number;
    setLidarVegCliffSparseFallback: (v: number) => void;
    /** "Falaise simple" mode (degrees): when > 0 the falaise⇄pente verdict is
     *  taken purely from the local ground slope, bypassing the crest / span / rim
     *  classifier. 0 = off (detailed classifier, unchanged). */
    lidarVegCliffSlopeDeg: number;
    setLidarVegCliffSlopeDeg: (v: number) => void;
    /** "Falaise simple" slope sampling baseline (m): larger reads the slope at a
     *  coarser scale so short steep banks stay pente. Only used when
     *  `lidarVegCliffSlopeDeg > 0`. */
    lidarVegCliffSlopeSample: number;
    setLidarVegCliffSlopeSample: (v: number) => void;
    /** Slope floor for the DETAILED classifier (degrees): a cell steeper than
     *  this is forced toward falaise even when the crest / rim machinery would
     *  green it, catching steep open faces and battered cliffs. ORs with the
     *  existing logic; surplomb stays surplomb. 0 = off (byte-identical). */
    lidarVegCliffSlopeMin: number;
    setLidarVegCliffSlopeMin: (v: number) => void;
    /** Height-decision diagnostic render mode (false-colour over the canopy). */
    lidarVegDiagMode: LidarVegDiagMode;
    setLidarVegDiagMode: (v: LidarVegDiagMode) => void;
    /** Recompute the loaded cloud's vegetation heights from the current gap
     *  without re-capturing (instant slider feedback). */
    recomputeVegHeights: () => void;
    /** Point size in screen pixels. */
    lidarCloudPointSize: number;
    setLidarCloudPointSize: (v: number) => void;
    /** Automatically scale point size based on stride to fill gaps. */
    lidarCloudSizeCompensation: boolean;
    setLidarCloudSizeCompensation: (v: boolean) => void;
    /** Enable Eye-Dome Lighting for better depth perception. */
    lidarCloudEdl: boolean;
    setLidarCloudEdl: (v: boolean) => void;
    /** EDL strength (QGIS-equivalent; expects ~hundreds to low thousands). */
    lidarCloudEdlStrength: number;
    setLidarCloudEdlStrength: (v: number) => void;
    /** EDL neighbor sampling distance in 2-pixel units (QGIS-equivalent). */
    lidarCloudEdlRadius: number;
    setLidarCloudEdlRadius: (v: number) => void;
    /** EDL depth normalization (farPlane in v_depth units). */
    lidarCloudEdlFarPlane: number;
    setLidarCloudEdlFarPlane: (v: number) => void;
    /** Overall layer opacity 0..1 (default 1 = fully opaque). */
    lidarCloudOpacity: number;
    setLidarCloudOpacity: (v: number) => void;
    /** Drapage orthophoto IGN sur le SOL (points classes 2 sol + 9 eau + mesh) 0..1 (0 = palette, 1 = photo). */
    lidarCloudPhotoOpacity: number;
    setLidarCloudPhotoOpacity: (v: number) => void;
    /** Drapage orthophoto IGN sur le HORS-SOL (végétation, bâti, …) 0..1 (0 = palette, 1 = photo). */
    lidarCloudPhotoOpacityNonGround: number;
    setLidarCloudPhotoOpacityNonGround: (v: number) => void;
    /** Underlying basemap opacity 0..1 when the cloud is visible (1 = full, lower = "estompé"). */
    lidarCloudBasemapOpacity: number;
    setLidarCloudBasemapOpacity: (v: number) => void;
    /** LAS classification filter (empty = all classes). */
    lidarCloudClasses: number[];
    setLidarCloudClasses: (v: number[]) => void;
    /** Octree depth for the 'poisson' mode (8 = fast, 12 = fine). */
    lidarCloudPoissonDepth: number;
    setLidarCloudPoissonDepth: (v: number) => void;
    /** Min samples per octree node for PoissonRecon. Default 1.5. */
    lidarCloudPoissonSamplesPerNode: number;
    setLidarCloudPoissonSamplesPerNode: (v: number) => void;
    /** Interpolation weight for PoissonRecon. Default 4. */
    lidarCloudPoissonPointWeight: number;
    setLidarCloudPoissonPointWeight: (v: number) => void;
    /** Synthesize a flat parallelepiped "brick" base under the Poisson mesh so
     *  the underside is flat instead of a bulging cushion. Default true. */
    lidarCloudPoissonFlatBase: boolean;
    setLidarCloudPoissonFlatBase: (v: boolean) => void;
    /**
     * Sun position date/time as a naive local-datetime string
     * ("YYYY-MM-DDTHH:mm"). Drives the per-vertex Lambert lighting term in
     * the LiDAR shaders. Lat/lng for the solar calc are taken from the
     * currently-loaded cloud center (or the map center as fallback).
     */
    lidarSunDate: string;
    setLidarSunDate: (v: string) => void;
    /**
     * Opt-in directional sun lighting on the LiDAR cloud. When false, a
     * neutral omnidirectional light is applied (no harsh directional bias,
     * no cast shadows). Defaults to off.
     */
    lidarSunEnabled: boolean;
    setLidarSunEnabled: (v: boolean) => void;
    /** Cast hard/soft shadows from the LiDAR mesh based on the sun direction. */
    lidarShadows: boolean;
    setLidarShadows: (v: boolean) => void;
    /** Strength of cast shadows on the LiDAR cloud (0..1). */
    lidarShadowStrength: number;
    setLidarShadowStrength: (v: number) => void;
    /**
     * Enhanced vegetation rendering: height-ramped foliage colours (trunk →
     * canopy), per-leaf colour jitter and a small
     * point-size boost. On by default; toggling off restores flat per-class
     * colours for vegetation.
     */
    lidarVegEnhance: boolean;
    setLidarVegEnhance: (v: boolean) => void;
    /**
     * Vegetation colouring strategy: 'natural' = trunk→canopy green ramp,
     * 'height' = viridis height colormap (IGN LiDAR HD canopy look, flat-shaded
     * so the EDL alone carves the relief).
     */
    lidarVegColorMode: VegColorMode;
    setLidarVegColorMode: (v: VegColorMode) => void;
    /** Height (m above ground) mapped to the top of the viridis ramp in 'height' mode. */
    lidarVegHeightScale: number;
    setLidarVegHeightScale: (v: number) => void;
    /** When true, the foliage colour scale follows the tallest tree of the loaded cloud (slider disabled). */
    lidarVegHeightAuto: boolean;
    setLidarVegHeightAuto: (v: boolean) => void;
    /** Strength of the height-ramp foliage colouring (0 = flat class colour, 1 = full ramp). */
    lidarVegIntensity: number;
    setLidarVegIntensity: (v: number) => void;
    /** Strength of normal-driven relief shading on vegetation (0 = flat/EDL-only, 1 = full). */
    lidarVegNormalShade: number;
    setLidarVegNormalShade: (v: number) => void;
    /** Point-size multiplier applied to vegetation points (fills canopy gaps). */
    lidarVegSizeBoost: number;
    setLidarVegSizeBoost: (v: number) => void;
    /**
     * IGN BD Forêt® species rendering — legend grouping. 'group' colours by the
     * 6 broad formations (feuillus / conifères / mixte / …), 'species' by the
     * dominant essence (chêne, hêtre, pin sylvestre, douglas, …) with a
     * procedural mosaic inside mixed stands. Toggling is instant (GPU uniform).
     */
    lidarForestGrouping: ForestGrouping;
    setLidarForestGrouping: (v: ForestGrouping) => void;
    /** GPU mix-cell size (m) for the procedural species mosaic inside mixed stands. */
    lidarForestMixCellSize: number;
    setLidarForestMixCellSize: (v: number) => void;
    /**
     * How stand boundaries are blended when labelling points by essence:
     * 'sharp' (raw polygon edges), 'feather' (smooth coherent ecotone) or
     * 'scatter' (species intermingle point-by-point across the band).
     */
    lidarForestEdgeBlend: ForestEdgeBlend;
    setLidarForestEdgeBlend: (v: ForestEdgeBlend) => void;
    /** Width (m) of the essence-boundary transition band (feather/scatter). */
    lidarForestEdgeBandM: number;
    setLidarForestEdgeBandM: (v: number) => void;
    /** CHM treetop detection sensitivity 0..1 (higher = more, smaller crowns). */
    lidarForestTreetopSensitivity: number;
    setLidarForestTreetopSensitivity: (v: number) => void;
    /** Legend-as-filter: hidden legend ids for the active grouping (empty = all). */
    lidarForestHiddenLegend: number[];
    setLidarForestHiddenLegend: (v: number[]) => void;
    /** Whether the species legend filter is active. */
    lidarForestSpeciesFilterOn: boolean;
    setLidarForestSpeciesFilterOn: (v: boolean) => void;
    /** Show a preview rectangle on the map indicating the zone that will be loaded. */
    lidarPreviewVisible: boolean;
    setLidarPreviewVisible: (v: boolean) => void;
    /**
     * Centred capture rectangle (width × length in metres). A square is just the
     * special case width === length. Orientation follows the live camera bearing
     * unless `lidarRectNorthFixed` is set.
     */
    lidarCaptureRect: CaptureRectDims;
    setLidarCaptureRect: (r: CaptureRectDims) => void;
    /** Lock the capture rectangle to a north-up orientation (ignore the camera bearing). */
    lidarRectNorthFixed: boolean;
    setLidarRectNorthFixed: (v: boolean) => void;
    /** Load the point cloud centered on the current map view. */
    loadLidarCloud: () => Promise<void>;
    /**
     * Cancel an in-progress load (e.g. a Poisson reconstruction taking too
     * long). The WASM reconstruction can't be paused, so this terminates the
     * worker running it — the next `loadLidarCloud` call spins up a fresh one.
     */
    cancelLidarCloudLoad: () => void;
    /**
     * Append a freshly loaded (or re-opened) cloud/mesh snapshot to the
     * display without removing existing ones. Becomes the new last entry;
     * the first-ever loaded cloud stays the "primary" one.
     */
    addLidarCloudSnapshot: (
        data: { shaded: LidarShadedCloudData | null; mesh: LidarMeshData | null },
        meta: { mode: LidarMode; sourceKey?: string; sourceSceneId?: string },
    ) => void;
    /** Remove a single loaded cloud/mesh from the display. */
    removeLidarCloud: (id: string) => void;
    /** Toggle whether a loaded cloud/mesh is currently drawn. */
    toggleLidarCloudVisible: (id: string) => void;
    /** Remove every loaded cloud/mesh. */
    clearAllLidarClouds: () => void;
    /** Reset every LiDAR render setting (opacity, classes, shader, lighting, shadows, EDL, contours…) to its default. Does not unload the cloud. */
    resetLidarRenderSettings: () => void;
}

/** Default sun date: today at noon, local time, as "YYYY-MM-DDTHH:mm". */
function defaultSunDate(): string {
    return formatSunDate(todaySunDatePart(), 12 * 60);
}

/**
 * Rebuild the bare-earth reference grid for a live veg-height recompute when the
 * requested cell size differs from the cached grid's, but only when the shaded
 * cloud still carries ground/water returns (class 2/9) to anchor it — i.e. in
 * Points mode. In mesh modes the ground is consumed into the surface, so there
 * is nothing to rebuild from and we keep the cached grid (a re-capture is needed
 * to apply a new cell there). Returns the cached grid otherwise.
 */
function rebuildVegGrid(cloud: LidarShadedCloudData): VegGroundGrid | null {
    const cached = cloud.vegGroundGrid ?? null;
    if (cached && Math.abs(cached.cell - DEFAULT_VEG_GROUND_CELL_M) < 1e-3) return cached;
    const cls = cloud.classifications;
    let hasGround = false;
    for (let i = 0; i < cloud.pointCount; i++) {
        if (cls[i] === 2 || cls[i] === 9) { hasGround = true; break; }
    }
    if (!hasGround) return cached;
    return buildVegGroundGrid(cloud.positions, cloud.pointCount, cloud.classifications, DEFAULT_VEG_GROUND_CELL_M);
}

/**
 * Single source of truth for the LiDAR render-setting defaults.
 *
 * Consumed both by `createLidarSlice` (as the `?? fallback` when nothing is
 * persisted) and by `resetLidarRenderSettings`, so "reset" always restores
 * exactly the values a fresh user gets — no copy-paste drift between the two.
 * Only render settings live here; capture parameters (radius, stride, poisson
 * depth…) are deliberately excluded since reset does not touch them.
 */
export const LIDAR_RENDER_DEFAULTS = {
    lidarMode: 'shaded' as LidarMode,
    lidarShader: 'cliff' as ShaderPreset,
    lidarCloudPointSize: 2,
    lidarCloudSizeCompensation: true,
    lidarCloudEdl: true,
    lidarCloudEdlStrength: 40,
    lidarCloudEdlRadius: 0.7,
    lidarCloudEdlFarPlane: 350,
    lidarCloudOpacity: 1,
    lidarCloudPhotoOpacity: 0,
    lidarCloudPhotoOpacityNonGround: 0,
    lidarCloudBasemapOpacity: 1,
    lidarCloudClasses: [2, 9] as number[],
    lidarSunEnabled: false,
    lidarShadows: true,
    lidarShadowStrength: 0.7,
    lidarVegEnhance: true,
    lidarVegColorMode: 'natural' as VegColorMode,
    lidarVegHeightScale: 25,
    lidarVegHeightAuto: true,
    lidarVegIntensity: 0.85,
    lidarVegNormalShade: 1,
    lidarVegSizeBoost: 1.3,
    lidarForestGrouping: 'group' as ForestGrouping,
    lidarForestMixCellSize: 6,
    lidarForestEdgeBlend: 'scatter' as ForestEdgeBlend,
    lidarForestEdgeBandM: 8,
    lidarForestTreetopSensitivity: 0.5,
    lidarForestHiddenLegend: [] as number[],
    lidarForestSpeciesFilterOn: false,
};

export const createLidarSlice: StateCreator<MapState, [], [], LidarSlice> = (set, get) => {
    /**
     * Apply a patch to the "primary" cloud (`lidarClouds[0]`) and keep the
     * flat `lidarShaded`/`lidarMesh` mirror fields in sync. Used by writers
     * that recompute the primary cloud's geometry in place (shader recolor,
     * veg-height recompute) — a no-op when nothing is loaded.
     */
    const patchPrimaryCloud = (patch: { shaded?: LidarShadedCloudData; mesh?: LidarMeshData }) => {
        const { lidarClouds } = get();
        if (lidarClouds.length === 0) return;
        const updated: LoadedLidarCloud = { ...lidarClouds[0], ...patch };
        set({
            lidarClouds: [updated, ...lidarClouds.slice(1)],
            lidarShaded: updated.shaded,
            lidarMesh: updated.mesh,
        });
    };

    return {
        lidarMode: (persisted.lidarMode === 'shaded' || persisted.lidarMode === 'delaunay' || persisted.lidarMode === 'poisson') ? persisted.lidarMode : LIDAR_RENDER_DEFAULTS.lidarMode,
        setLidarMode: (lidarMode) => set({ lidarMode }),
        lidarShader: (persisted.lidarShader === 'base' || persisted.lidarShader === 'cliff' || persisted.lidarShader === 'winter') ? persisted.lidarShader : LIDAR_RENDER_DEFAULTS.lidarShader,
        setLidarShader: (shader) => {
            // Recolor EVERY loaded cloud/mesh (not just the "primary" one) —
            // the shader is a global render setting shown for all simultaneously
            // displayed clouds, so all of them must recolor together.
            const { lidarClouds } = get();
            const recoloredClouds = lidarClouds.map((cloud) => ({
                ...cloud,
                shaded: cloud.shaded
                    ? { ...cloud.shaded, colors: colorsFromNormals(cloud.shaded.normals, shader, cloud.shaded.positions) }
                    : cloud.shaded,
                mesh: cloud.mesh
                    ? { ...cloud.mesh, colors: recolorMeshVertices(cloud.mesh.normals, cloud.mesh.positions, cloud.mesh.roughness, shader) }
                    : cloud.mesh,
            }));
            set({
                lidarShader: shader,
                lidarClouds: recoloredClouds,
                lidarShaded: recoloredClouds[0]?.shaded ?? null,
                lidarMesh: recoloredClouds[0]?.mesh ?? null,
            });
        },
        lidarShaded: null,
        lidarMesh: null,
        lidarClouds: [],
        lidarLodEnabled: true,
        setLidarLodEnabled: (lidarLodEnabled) => set({ lidarLodEnabled }),
        lidarLodForceLevel: null,
        setLidarLodForceLevel: (lidarLodForceLevel) => set({ lidarLodForceLevel }),
        lidarMeshWireframe: false,
        setLidarMeshWireframe: (lidarMeshWireframe) => set({ lidarMeshWireframe }),
        lidarLodDebugInfo: null,
        setLidarLodDebugInfo: (lidarLodDebugInfo) => set({ lidarLodDebugInfo }),
        lidarCloudLoading: false,
        lidarCloudError: null,
        lidarCloudProgress: null,
        lidarCloudStride: persisted.lidarCloudStride ?? 10,
        setLidarCloudStride: (lidarCloudStride) => set({ lidarCloudStride }),
        lidarCloudGroundStride: persisted.lidarCloudGroundStride ?? 16,
        setLidarCloudGroundStride: (lidarCloudGroundStride) => set({ lidarCloudGroundStride }),
        lidarMeshSmooth: persisted.lidarMeshSmooth ?? true,
        setLidarMeshSmooth: (lidarMeshSmooth) => set({ lidarMeshSmooth }),
        lidarGridCell: persisted.lidarGridCell ?? 1,
        setLidarGridCell: (lidarGridCell) => set({ lidarGridCell }),
        lidarVegGroundGap: persisted.lidarVegGroundGap ?? DEFAULT_VEG_GROUND_GAP,
        setLidarVegGroundGap: (lidarVegGroundGap) => set({ lidarVegGroundGap }),
        lidarVegGroundRough: persisted.lidarVegGroundRough ?? DEFAULT_VEG_GROUND_ROUGH,
        setLidarVegGroundRough: (lidarVegGroundRough) => set({ lidarVegGroundRough }),
        lidarVegColumnCell: persisted.lidarVegColumnCell ?? DEFAULT_VEG_COLUMN_CELL_M,
        setLidarVegColumnCell: (lidarVegColumnCell) => set({ lidarVegColumnCell }),
        lidarVegRoughLowFrac: persisted.lidarVegRoughLowFrac ?? DEFAULT_VEG_ROUGH_LOW_FRAC,
        setLidarVegRoughLowFrac: (lidarVegRoughLowFrac) => set({ lidarVegRoughLowFrac }),
        lidarVegOverhangReach: persisted.lidarVegOverhangReach ?? DEFAULT_VEG_OVERHANG_REACH_M,
        setLidarVegOverhangReach: (lidarVegOverhangReach) => set({ lidarVegOverhangReach }),
        lidarVegCliffDistMode: persisted.lidarVegCliffDistMode ?? 'column',
        setLidarVegCliffDistMode: (lidarVegCliffDistMode) => set({ lidarVegCliffDistMode }),
        lidarVegColorSmooth: persisted.lidarVegColorSmooth ?? 0,
        setLidarVegColorSmooth: (lidarVegColorSmooth) => set({ lidarVegColorSmooth }),
        lidarVegCliffSparseFallback: persisted.lidarVegCliffSparseFallback ?? 0,
        setLidarVegCliffSparseFallback: (lidarVegCliffSparseFallback) => set({ lidarVegCliffSparseFallback }),
        lidarVegCliffSlopeDeg: persisted.lidarVegCliffSlopeDeg ?? 0,
        setLidarVegCliffSlopeDeg: (lidarVegCliffSlopeDeg) => set({ lidarVegCliffSlopeDeg }),
        lidarVegCliffSlopeSample: persisted.lidarVegCliffSlopeSample ?? DEFAULT_VEG_SLOPE_SAMPLE_M,
        setLidarVegCliffSlopeSample: (lidarVegCliffSlopeSample) => set({ lidarVegCliffSlopeSample }),
        lidarVegCliffSlopeMin: persisted.lidarVegCliffSlopeMin ?? 0,
        setLidarVegCliffSlopeMin: (lidarVegCliffSlopeMin) => set({ lidarVegCliffSlopeMin }),
        lidarVegDiagMode: persisted.lidarVegDiagMode ?? 'off',
        setLidarVegDiagMode: (lidarVegDiagMode) => set({ lidarVegDiagMode }),
        recomputeVegHeights: () => {
            const {
                lidarShaded, lidarVegGroundGap, lidarVegGroundRough, lidarVegColumnCell,
                lidarVegRoughLowFrac, lidarVegOverhangReach,
                lidarVegCliffDistMode, lidarVegColorSmooth, lidarVegCliffSparseFallback,
                lidarVegCliffSlopeDeg,
                lidarVegCliffSlopeSample,
                lidarVegCliffSlopeMin,
            } = get();
            if (!lidarShaded) return;
            // Rebuild the bare-earth grid only when ground refs (class 2/9) survive in
            // the shaded cloud (Points mode). Mesh modes strip the ground into the
            // surface, so we reuse the cached grid there.
            const grid = rebuildVegGrid(lidarShaded);
            const vegDiag = new Uint8Array(lidarShaded.pointCount * 4);
            const heightAboveGround = computeVegHeights(
                lidarShaded.positions, lidarShaded.classifications, lidarShaded.pointCount,
                lidarVegGroundGap, grid, lidarVegGroundRough,
                {
                    columnCellM: lidarVegColumnCell,
                    roughLowFrac: lidarVegRoughLowFrac,
                    overhangReachM: lidarVegOverhangReach,
                    cliffDistMode: lidarVegCliffDistMode,
                    vegColorSmooth: lidarVegColorSmooth,
                    cliffSparseMaxPts: lidarVegCliffSparseFallback,
                    cliffSlopeDeg: lidarVegCliffSlopeDeg,
                    cliffSlopeSampleM: lidarVegCliffSlopeSample,
                    cliffSlopeMinDeg: lidarVegCliffSlopeMin,
                    diag: vegDiag,
                },
            );
            const vegHeightAuto = sanitizeVegHeights(
                heightAboveGround, lidarShaded.classifications, lidarShaded.pointCount, vegDiag,
            ) ?? undefined;
            patchPrimaryCloud({
                shaded: {
                    ...lidarShaded, heightAboveGround, vegHeightAuto, vegDiag,
                    vegGroundGrid: grid ?? lidarShaded.vegGroundGrid,
                },
            });
        },
        lidarCloudPointSize: persisted.lidarCloudPointSize ?? LIDAR_RENDER_DEFAULTS.lidarCloudPointSize,
        setLidarCloudPointSize: (lidarCloudPointSize) => set({ lidarCloudPointSize }),
        lidarCloudSizeCompensation: persisted.lidarCloudSizeCompensation ?? LIDAR_RENDER_DEFAULTS.lidarCloudSizeCompensation,
        setLidarCloudSizeCompensation: (lidarCloudSizeCompensation) => set({ lidarCloudSizeCompensation }),
        lidarCloudEdl: persisted.lidarCloudEdl ?? LIDAR_RENDER_DEFAULTS.lidarCloudEdl,
        setLidarCloudEdl: (lidarCloudEdl) => set({ lidarCloudEdl }),
        lidarCloudEdlStrength: persisted.lidarCloudEdlStrength ?? LIDAR_RENDER_DEFAULTS.lidarCloudEdlStrength,
        setLidarCloudEdlStrength: (lidarCloudEdlStrength) => set({ lidarCloudEdlStrength }),
        lidarCloudEdlRadius: persisted.lidarCloudEdlRadius ?? LIDAR_RENDER_DEFAULTS.lidarCloudEdlRadius,
        setLidarCloudEdlRadius: (lidarCloudEdlRadius) => set({ lidarCloudEdlRadius }),
        lidarCloudEdlFarPlane: persisted.lidarCloudEdlFarPlane ?? LIDAR_RENDER_DEFAULTS.lidarCloudEdlFarPlane,
        setLidarCloudEdlFarPlane: (lidarCloudEdlFarPlane) => set({ lidarCloudEdlFarPlane }),
        lidarCloudOpacity: persisted.lidarCloudOpacity ?? LIDAR_RENDER_DEFAULTS.lidarCloudOpacity,
        setLidarCloudOpacity: (lidarCloudOpacity) => set({ lidarCloudOpacity }),
        lidarCloudPhotoOpacity: persisted.lidarCloudPhotoOpacity ?? LIDAR_RENDER_DEFAULTS.lidarCloudPhotoOpacity,
        setLidarCloudPhotoOpacity: (lidarCloudPhotoOpacity) => set({ lidarCloudPhotoOpacity }),
        lidarCloudPhotoOpacityNonGround: persisted.lidarCloudPhotoOpacityNonGround ?? LIDAR_RENDER_DEFAULTS.lidarCloudPhotoOpacityNonGround,
        setLidarCloudPhotoOpacityNonGround: (lidarCloudPhotoOpacityNonGround) => set({ lidarCloudPhotoOpacityNonGround }),
        lidarCloudBasemapOpacity: persisted.lidarCloudBasemapOpacity ?? LIDAR_RENDER_DEFAULTS.lidarCloudBasemapOpacity,
        setLidarCloudBasemapOpacity: (lidarCloudBasemapOpacity) => set({ lidarCloudBasemapOpacity }),
        lidarCloudClasses: persisted.lidarCloudClasses ?? LIDAR_RENDER_DEFAULTS.lidarCloudClasses,
        setLidarCloudClasses: (lidarCloudClasses) => set({ lidarCloudClasses }),
        lidarCloudPoissonDepth: persisted.lidarCloudPoissonDepth ?? 9,
        setLidarCloudPoissonDepth: (lidarCloudPoissonDepth) => set({ lidarCloudPoissonDepth }),
        lidarCloudPoissonSamplesPerNode: persisted.lidarCloudPoissonSamplesPerNode ?? 1.5,
        setLidarCloudPoissonSamplesPerNode: (lidarCloudPoissonSamplesPerNode) => set({ lidarCloudPoissonSamplesPerNode }),
        lidarCloudPoissonPointWeight: persisted.lidarCloudPoissonPointWeight ?? 4,
        setLidarCloudPoissonPointWeight: (lidarCloudPoissonPointWeight) => set({ lidarCloudPoissonPointWeight }),
        lidarCloudPoissonFlatBase: persisted.lidarCloudPoissonFlatBase ?? true,
        setLidarCloudPoissonFlatBase: (lidarCloudPoissonFlatBase) => set({ lidarCloudPoissonFlatBase }),
        lidarSunDate: persisted.lidarSunDate ?? defaultSunDate(),
        setLidarSunDate: (lidarSunDate) => set({ lidarSunDate }),
        lidarSunEnabled: persisted.lidarSunEnabled ?? LIDAR_RENDER_DEFAULTS.lidarSunEnabled,
        setLidarSunEnabled: (lidarSunEnabled) => set({ lidarSunEnabled }),
        lidarShadows: persisted.lidarShadows ?? LIDAR_RENDER_DEFAULTS.lidarShadows,
        setLidarShadows: (lidarShadows) => set({ lidarShadows }),
        lidarShadowStrength: persisted.lidarShadowStrength ?? LIDAR_RENDER_DEFAULTS.lidarShadowStrength,
        setLidarShadowStrength: (lidarShadowStrength) => set({ lidarShadowStrength }),
        lidarVegEnhance: persisted.lidarVegEnhance ?? LIDAR_RENDER_DEFAULTS.lidarVegEnhance,
        setLidarVegEnhance: (lidarVegEnhance) => set({ lidarVegEnhance }),
        lidarVegColorMode: ((): VegColorMode => {
            const m = persisted.lidarVegColorMode;
            return m === 'height' || m === 'species' ? m : LIDAR_RENDER_DEFAULTS.lidarVegColorMode;
        })(),
        setLidarVegColorMode: (lidarVegColorMode) => set({ lidarVegColorMode }),
        lidarVegHeightScale: persisted.lidarVegHeightScale ?? LIDAR_RENDER_DEFAULTS.lidarVegHeightScale,
        setLidarVegHeightScale: (lidarVegHeightScale) => set({ lidarVegHeightScale }),
        lidarVegHeightAuto: persisted.lidarVegHeightAuto ?? LIDAR_RENDER_DEFAULTS.lidarVegHeightAuto,
        setLidarVegHeightAuto: (lidarVegHeightAuto) => set({ lidarVegHeightAuto }),
        lidarVegIntensity: persisted.lidarVegIntensity ?? LIDAR_RENDER_DEFAULTS.lidarVegIntensity,
        setLidarVegIntensity: (lidarVegIntensity) => set({ lidarVegIntensity }),
        lidarVegNormalShade: persisted.lidarVegNormalShade ?? LIDAR_RENDER_DEFAULTS.lidarVegNormalShade,
        setLidarVegNormalShade: (lidarVegNormalShade) => set({ lidarVegNormalShade }),
        lidarVegSizeBoost: persisted.lidarVegSizeBoost ?? LIDAR_RENDER_DEFAULTS.lidarVegSizeBoost,
        setLidarVegSizeBoost: (lidarVegSizeBoost) => set({ lidarVegSizeBoost }),
        lidarForestGrouping: (persisted.lidarForestGrouping === 'species' ? 'species' : LIDAR_RENDER_DEFAULTS.lidarForestGrouping),
        setLidarForestGrouping: (lidarForestGrouping) => set({ lidarForestGrouping }),
        lidarForestMixCellSize: persisted.lidarForestMixCellSize ?? LIDAR_RENDER_DEFAULTS.lidarForestMixCellSize,
        setLidarForestMixCellSize: (lidarForestMixCellSize) => set({ lidarForestMixCellSize }),
        lidarForestEdgeBlend: ((): ForestEdgeBlend => {
            const b = persisted.lidarForestEdgeBlend;
            return b === 'sharp' || b === 'feather' || b === 'scatter' ? b : LIDAR_RENDER_DEFAULTS.lidarForestEdgeBlend;
        })(),
        setLidarForestEdgeBlend: (lidarForestEdgeBlend) => set({ lidarForestEdgeBlend }),
        lidarForestEdgeBandM: persisted.lidarForestEdgeBandM ?? LIDAR_RENDER_DEFAULTS.lidarForestEdgeBandM,
        setLidarForestEdgeBandM: (lidarForestEdgeBandM) => set({ lidarForestEdgeBandM }),
        lidarForestTreetopSensitivity: persisted.lidarForestTreetopSensitivity ?? LIDAR_RENDER_DEFAULTS.lidarForestTreetopSensitivity,
        setLidarForestTreetopSensitivity: (lidarForestTreetopSensitivity) => set({ lidarForestTreetopSensitivity }),
        lidarForestHiddenLegend: persisted.lidarForestHiddenLegend ?? LIDAR_RENDER_DEFAULTS.lidarForestHiddenLegend,
        setLidarForestHiddenLegend: (lidarForestHiddenLegend) => set({ lidarForestHiddenLegend }),
        lidarForestSpeciesFilterOn: persisted.lidarForestSpeciesFilterOn ?? LIDAR_RENDER_DEFAULTS.lidarForestSpeciesFilterOn,
        setLidarForestSpeciesFilterOn: (lidarForestSpeciesFilterOn) => set({ lidarForestSpeciesFilterOn }),
        lidarPreviewVisible: false,
        setLidarPreviewVisible: (lidarPreviewVisible) => set({ lidarPreviewVisible }),
        lidarCaptureRect: persisted.lidarCaptureRect ?? { widthM: 500, lengthM: 500 },
        setLidarCaptureRect: (lidarCaptureRect) => set({ lidarCaptureRect }),
        lidarRectNorthFixed: persisted.lidarRectNorthFixed ?? false,
        setLidarRectNorthFixed: (lidarRectNorthFixed) => set({ lidarRectNorthFixed }),
        loadLidarCloud: async () => {
            const state = get();
            const map = state.mapInstance;
            // Use screen center (not map.getCenter) so the loaded area matches the
            // preview rectangle when the camera is pitched.
            let center: { lng: number; lat: number };
            if (map) {
                const canvas = map.getCanvas();
                const screenCenter = map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
                center = { lng: screenCenter.lng, lat: screenCenter.lat };
            } else {
                center = { lng: state.view.longitude, lat: state.view.latitude };
            }
            const maxArea = state.lidarMode === 'poisson' ? POISSON_MAX_AREA_M2 : LIDAR_RECT_MAX_AREA_M2;
            const capture = captureGeometry(
                state.lidarCaptureRect, map, maxArea, state.lidarRectNorthFixed,
            );
            set({ lidarCloudLoading: true, lidarCloudError: null, lidarCloudProgress: null });
            try {
                const onProgress = (progress: LidarProgress) => set({ lidarCloudProgress: progress });
                const cloudParams = {
                    mode: state.lidarMode,
                    centerLng: center.lng,
                    centerLat: center.lat,
                    radius: capture.radius,
                    stride: state.lidarCloudStride,
                    classes: state.lidarCloudClasses,
                    shader: state.lidarShader,
                };
                let shadedResult: LidarShadedCloudData | null;
                let meshResult: LidarMeshData | null;
                if (state.lidarMode === 'delaunay') {
                    const composite = await fetchLidarDelaunay({
                        lng: center.lng,
                        lat: center.lat,
                        radius: capture.radius,
                        rect: capture.rect,
                        stride: state.lidarCloudStride,
                        groundGapM: state.lidarVegGroundGap,
                        groundRoughM: state.lidarVegGroundRough,
                        shader: state.lidarShader,
                        gridMesh: state.lidarMeshSmooth,
                        gridCell: state.lidarGridCell,
                        onProgress,
                    });
                    shadedResult = composite.shaded;
                    meshResult = composite.mesh;
                } else if (state.lidarMode === 'poisson') {
                    // PoissonRecon WASM on ground + shaded cloud overlay for the
                    // other classes. Cap radius so the WASM heap (2 GB) and the
                    // depth-12 octree don't explode.
                    const composite = await fetchLidarPoisson({
                        lng: center.lng,
                        lat: center.lat,
                        radius: capture.radius,
                        rect: capture.rect,
                        stride: state.lidarCloudStride,
                        poissonGroundStride: state.lidarCloudGroundStride,
                        poissonDepth: state.lidarCloudPoissonDepth,
                        poissonSamplesPerNode: state.lidarCloudPoissonSamplesPerNode,
                        poissonPointWeight: state.lidarCloudPoissonPointWeight,
                        poissonFlatBase: state.lidarCloudPoissonFlatBase,
                        groundGapM: state.lidarVegGroundGap,
                        groundRoughM: state.lidarVegGroundRough,
                        shader: state.lidarShader,
                        onProgress,
                    });
                    shadedResult = composite.shaded;
                    meshResult = composite.mesh;
                } else {
                    // Shaded mode: always fetches every class and filters on the GPU
                    // via LidarWebGLLayer.setClassMask(), so toggling classes is instant.
                    shadedResult = await fetchLidarShaded({
                        lng: center.lng,
                        lat: center.lat,
                        radius: capture.radius,
                        rect: capture.rect,
                        stride: state.lidarCloudStride,
                        groundGapM: state.lidarVegGroundGap,
                        groundRoughM: state.lidarVegGroundRough,
                        shader: state.lidarShader,
                        onProgress,
                    });
                    meshResult = null;
                }
                // Append rather than replace, so a new capture never removes an
                // already-displayed cloud/mesh.
                get().addLidarCloudSnapshot(
                    { shaded: shadedResult, mesh: meshResult },
                    { mode: state.lidarMode, sourceKey: makeCloudKey(cloudParams) },
                );
                // Persist a "recently loaded" entry so it can be re-opened instantly.
                void saveLoadedCloud(cloudParams, { shaded: shadedResult, mesh: meshResult });
            } catch (err) {
                // A user-requested cancellation rejects the in-flight worker request
                // (see cancelLidarWorkerRequests) — show a neutral idle state instead
                // of a red error banner for that specific case.
                const cancelled = err instanceof Error && (err as Error & { code?: string }).code === 'cancelled';
                let message: string | null = 'Erreur inconnue';
                if (cancelled) message = null;
                else if (err instanceof Error) message = err.message;
                set({ lidarCloudLoading: false, lidarCloudError: message, lidarCloudProgress: null });
            }
        },
        cancelLidarCloudLoad: () => {
            cancelLidarWorkerRequests();
            set({ lidarCloudLoading: false, lidarCloudError: null, lidarCloudProgress: null });
        },
        addLidarCloudSnapshot: (data, meta) => {
            if (!data.shaded && !data.mesh) return;
            const entry: LoadedLidarCloud = {
                id: `lidar-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                shaded: data.shaded,
                mesh: data.mesh,
                visible: true,
                createdAt: Date.now(),
                mode: meta.mode,
                sourceKey: meta.sourceKey,
                sourceSceneId: meta.sourceSceneId,
            };
            const lidarClouds = [...get().lidarClouds, entry];
            set({
                lidarClouds,
                lidarShaded: lidarClouds[0].shaded,
                lidarMesh: lidarClouds[0].mesh,
                lidarCloudLoading: false,
                lidarCloudError: null,
                lidarCloudProgress: null,
            });
        },
        removeLidarCloud: (id) => {
            const lidarClouds = get().lidarClouds.filter((c) => c.id !== id);
            set({
                lidarClouds,
                lidarShaded: lidarClouds[0]?.shaded ?? null,
                lidarMesh: lidarClouds[0]?.mesh ?? null,
            });
        },
        toggleLidarCloudVisible: (id) => set({
            lidarClouds: get().lidarClouds.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
        }),
        clearAllLidarClouds: () => set({
            lidarClouds: [], lidarShaded: null, lidarMesh: null, lidarCloudError: null, lidarCloudProgress: null,
        }),

        resetLidarRenderSettings: () => {
            set({
                ...LIDAR_RENDER_DEFAULTS,
                // Contour lines belong to terrainSlice but are part of the render reset.
                contourLinesEnabled: false,
                contourLinesOpacity: 0.4,
            });
            // Go through the shader setter so the loaded geometry is recolored.
            get().setLidarShader(LIDAR_RENDER_DEFAULTS.lidarShader);
        },
    };
};

/** Persisted keys owned by the lidar slice. */
export function selectLidarPersisted(
    s: LidarSlice,
): Pick<
    PersistedSettings,
    | 'lidarMode'
    | 'lidarShader'
    | 'lidarCloudStride'
    | 'lidarCaptureRect'
    | 'lidarRectNorthFixed'
    | 'lidarCloudGroundStride'
    | 'lidarMeshSmooth'
    | 'lidarGridCell'
    | 'lidarVegGroundGap'
    | 'lidarVegGroundRough'
    | 'lidarVegColumnCell'
    | 'lidarVegRoughLowFrac'
    | 'lidarVegOverhangReach'
    | 'lidarVegCliffDistMode'
    | 'lidarVegColorSmooth'
    | 'lidarVegCliffSparseFallback'
    | 'lidarVegCliffSlopeDeg'
    | 'lidarVegCliffSlopeSample'
    | 'lidarVegCliffSlopeMin'
    | 'lidarVegDiagMode'
    | 'lidarCloudPointSize'
    | 'lidarCloudSizeCompensation'
    | 'lidarCloudEdl'
    | 'lidarCloudEdlStrength'
    | 'lidarCloudEdlRadius'
    | 'lidarCloudEdlFarPlane'
    | 'lidarCloudOpacity'
    | 'lidarCloudPhotoOpacity'
    | 'lidarCloudPhotoOpacityNonGround'
    | 'lidarCloudBasemapOpacity'
    | 'lidarCloudClasses'
    | 'lidarCloudPoissonDepth'
    | 'lidarCloudPoissonSamplesPerNode'
    | 'lidarCloudPoissonPointWeight'
    | 'lidarCloudPoissonFlatBase'
    | 'lidarSunDate'
    | 'lidarSunEnabled'
    | 'lidarShadows'
    | 'lidarShadowStrength'
    | 'lidarVegEnhance'
    | 'lidarVegColorMode'
    | 'lidarVegHeightScale'
    | 'lidarVegHeightAuto'
    | 'lidarVegIntensity'
    | 'lidarVegNormalShade'
    | 'lidarVegSizeBoost'
    | 'lidarForestGrouping'
    | 'lidarForestMixCellSize'
    | 'lidarForestEdgeBlend'
    | 'lidarForestEdgeBandM'
    | 'lidarForestTreetopSensitivity'
    | 'lidarForestHiddenLegend'
    | 'lidarForestSpeciesFilterOn'
> {
    return {
        lidarMode: s.lidarMode,
        lidarShader: s.lidarShader,
        lidarCloudStride: s.lidarCloudStride,
        lidarCaptureRect: s.lidarCaptureRect,
        lidarRectNorthFixed: s.lidarRectNorthFixed,
        lidarCloudGroundStride: s.lidarCloudGroundStride,
        lidarMeshSmooth: s.lidarMeshSmooth,
        lidarGridCell: s.lidarGridCell,
        lidarVegGroundGap: s.lidarVegGroundGap,
        lidarVegGroundRough: s.lidarVegGroundRough,
        lidarVegColumnCell: s.lidarVegColumnCell,
        lidarVegRoughLowFrac: s.lidarVegRoughLowFrac,
        lidarVegOverhangReach: s.lidarVegOverhangReach,
        lidarVegCliffDistMode: s.lidarVegCliffDistMode,
        lidarVegColorSmooth: s.lidarVegColorSmooth,
        lidarVegCliffSparseFallback: s.lidarVegCliffSparseFallback,
        lidarVegCliffSlopeDeg: s.lidarVegCliffSlopeDeg,
        lidarVegCliffSlopeSample: s.lidarVegCliffSlopeSample,
        lidarVegCliffSlopeMin: s.lidarVegCliffSlopeMin,
        lidarVegDiagMode: s.lidarVegDiagMode,
        lidarCloudPointSize: s.lidarCloudPointSize,
        lidarCloudSizeCompensation: s.lidarCloudSizeCompensation,
        lidarCloudEdl: s.lidarCloudEdl,
        lidarCloudEdlStrength: s.lidarCloudEdlStrength,
        lidarCloudEdlRadius: s.lidarCloudEdlRadius,
        lidarCloudEdlFarPlane: s.lidarCloudEdlFarPlane,
        lidarCloudOpacity: s.lidarCloudOpacity,
        lidarCloudPhotoOpacity: s.lidarCloudPhotoOpacity,
        lidarCloudPhotoOpacityNonGround: s.lidarCloudPhotoOpacityNonGround,
        lidarCloudBasemapOpacity: s.lidarCloudBasemapOpacity,
        lidarCloudClasses: s.lidarCloudClasses,
        lidarCloudPoissonDepth: s.lidarCloudPoissonDepth,
        lidarCloudPoissonSamplesPerNode: s.lidarCloudPoissonSamplesPerNode,
        lidarCloudPoissonPointWeight: s.lidarCloudPoissonPointWeight,
        lidarCloudPoissonFlatBase: s.lidarCloudPoissonFlatBase,
        lidarSunDate: s.lidarSunDate,
        lidarSunEnabled: s.lidarSunEnabled,
        lidarShadows: s.lidarShadows,
        lidarShadowStrength: s.lidarShadowStrength,
        lidarVegEnhance: s.lidarVegEnhance,
        lidarVegColorMode: s.lidarVegColorMode,
        lidarVegHeightScale: s.lidarVegHeightScale,
        lidarVegHeightAuto: s.lidarVegHeightAuto,
        lidarVegIntensity: s.lidarVegIntensity,
        lidarVegNormalShade: s.lidarVegNormalShade,
        lidarVegSizeBoost: s.lidarVegSizeBoost,
        lidarForestGrouping: s.lidarForestGrouping,
        lidarForestMixCellSize: s.lidarForestMixCellSize,
        lidarForestEdgeBlend: s.lidarForestEdgeBlend,
        lidarForestEdgeBandM: s.lidarForestEdgeBandM,
        lidarForestTreetopSensitivity: s.lidarForestTreetopSensitivity,
        lidarForestHiddenLegend: s.lidarForestHiddenLegend,
        lidarForestSpeciesFilterOn: s.lidarForestSpeciesFilterOn,
    };
}
