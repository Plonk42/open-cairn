import {
    fetchLidarDelaunay,
    fetchLidarPoisson,
    fetchLidarShaded,
    type LidarProgress,
} from '@/lib/lidarBrowser';
import type { ForestEdgeBlend, ForestGrouping } from '@/lib/lidarBrowser/bdforet';
import { colorsFromNormals, recolorMeshVertices, type ShaderPreset } from '@/lib/lidarBrowser/slope';
import type { LidarMeshData, LidarShadedCloudData, VegColorMode } from '@/lib/lidarCloud';
import { saveLoadedCloud } from '@/lib/savedClouds';
import { formatSunDate, todaySunDatePart } from '@/lib/sun';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import { persisted, type PersistedSettings } from '../persistence';

/** Maximum capture radius (metres) allowed in Poisson mode (WASM heap / octree limit). */
export const POISSON_MAX_RADIUS = 500;

/** Rendering mode: shaded point cloud, delaunay (2.5D ground mesh + points), or poisson (WASM ground mesh + points). */
export type LidarMode = 'shaded' | 'delaunay' | 'poisson';

export interface LidarSlice {
    /** Rendering mode: shaded point cloud, delaunay (Delaunay 2.5D ground mesh + points), or poisson (PoissonRecon WASM ground mesh + points). */
    lidarMode: LidarMode;
    setLidarMode: (v: LidarMode) => void;
    /** Colour shader preset for geometry colorization. */
    lidarShader: ShaderPreset;
    setLidarShader: (v: ShaderPreset) => void;
    /** Loaded shaded point cloud (positions + normals + slope colors). */
    lidarShaded: LidarShadedCloudData | null;
    /** Loaded ground mesh for delaunay / poisson modes. */
    lidarMesh: LidarMeshData | null;
    /** True while a LiDAR request is in flight. */
    lidarCloudLoading: boolean;
    /** Last error message (null if no error). */
    lidarCloudError: string | null;
    /** Current loading progress. */
    lidarCloudProgress: LidarProgress | null;
    /** Half-side of the bbox to load, in meters. */
    lidarCloudRadius: number;
    setLidarCloudRadius: (v: number) => void;
    /** Decimation factor (1 = full density, N = keep 1/N points). */
    lidarCloudStride: number;
    setLidarCloudStride: (v: number) => void;
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
    /** Load the point cloud centered on the current map view. */
    loadLidarCloud: () => Promise<void>;
    /** Instantly re-display a previously saved cloud/mesh snapshot. */
    showLidarCloudSnapshot: (data: { shaded: LidarShadedCloudData | null; mesh: LidarMeshData | null }) => void;
    /** Clear the currently displayed point cloud. */
    clearLidarCloud: () => void;
    /** Reset every LiDAR render setting (opacity, classes, shader, lighting, shadows, EDL, contours…) to its default. Does not unload the cloud. */
    resetLidarRenderSettings: () => void;
}

/** Default sun date: today at noon, local time, as "YYYY-MM-DDTHH:mm". */
function defaultSunDate(): string {
    return formatSunDate(todaySunDatePart(), 12 * 60);
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

export const createLidarSlice: StateCreator<MapState, [], [], LidarSlice> = (set, get) => ({
    lidarMode: (persisted.lidarMode === 'shaded' || persisted.lidarMode === 'delaunay' || persisted.lidarMode === 'poisson') ? persisted.lidarMode : LIDAR_RENDER_DEFAULTS.lidarMode,
    setLidarMode: (lidarMode) => set({ lidarMode }),
    lidarShader: (persisted.lidarShader === 'base' || persisted.lidarShader === 'cliff' || persisted.lidarShader === 'winter') ? persisted.lidarShader : LIDAR_RENDER_DEFAULTS.lidarShader,
    setLidarShader: (shader) => {
        set({ lidarShader: shader });
        const { lidarShaded, lidarMesh } = get();
        if (lidarShaded) {
            const colors = colorsFromNormals(lidarShaded.normals, shader, lidarShaded.positions);
            set({ lidarShaded: { ...lidarShaded, colors } });
        }
        if (lidarMesh) {
            const colors = recolorMeshVertices(lidarMesh.normals, lidarMesh.positions, lidarMesh.roughness, shader);
            set({ lidarMesh: { ...lidarMesh, colors } });
        }
    },
    lidarShaded: null,
    lidarMesh: null,
    lidarCloudLoading: false,
    lidarCloudError: null,
    lidarCloudProgress: null,
    lidarCloudRadius: persisted.lidarCloudRadius ?? 250,
    setLidarCloudRadius: (lidarCloudRadius) => set({ lidarCloudRadius }),
    lidarCloudStride: persisted.lidarCloudStride ?? 10,
    setLidarCloudStride: (lidarCloudStride) => set({ lidarCloudStride }),
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
        set({ lidarCloudLoading: true, lidarCloudError: null, lidarCloudProgress: null });
        try {
            const onProgress = (progress: LidarProgress) => set({ lidarCloudProgress: progress });
            if (state.lidarMode === 'delaunay') {
                const composite = await fetchLidarDelaunay({
                    lng: center.lng,
                    lat: center.lat,
                    radius: state.lidarCloudRadius,
                    stride: state.lidarCloudStride,
                    shader: state.lidarShader,
                    onProgress,
                });
                // Set both shaded and mesh layers for delaunay mode display
                set({
                    lidarShaded: composite.shaded,
                    lidarMesh: composite.mesh,
                    lidarCloudLoading: false,
                    lidarCloudProgress: null,
                });
            } else if (state.lidarMode === 'poisson') {
                // PoissonRecon WASM on ground + shaded cloud overlay for the
                // other classes. Cap radius so the WASM heap (2 GB) and the
                // depth-12 octree don't explode.
                const psRadius = Math.min(state.lidarCloudRadius, POISSON_MAX_RADIUS);
                const composite = await fetchLidarPoisson({
                    lng: center.lng,
                    lat: center.lat,
                    radius: psRadius,
                    stride: state.lidarCloudStride,
                    poissonDepth: state.lidarCloudPoissonDepth,
                    poissonSamplesPerNode: state.lidarCloudPoissonSamplesPerNode,
                    poissonPointWeight: state.lidarCloudPoissonPointWeight,
                    shader: state.lidarShader,
                    onProgress,
                });
                set({
                    lidarShaded: composite.shaded,
                    lidarMesh: composite.mesh,
                    lidarCloudLoading: false,
                    lidarCloudProgress: null,
                });
            } else {
                // Shaded mode: always fetches every class and filters on the GPU
                // via LidarWebGLLayer.setClassMask(), so toggling classes is instant.
                const shaded = await fetchLidarShaded({
                    lng: center.lng,
                    lat: center.lat,
                    radius: state.lidarCloudRadius,
                    stride: state.lidarCloudStride,
                    shader: state.lidarShader,
                    onProgress,
                });
                set({ lidarShaded: shaded, lidarMesh: null, lidarCloudLoading: false, lidarCloudProgress: null });
            }
            // Persist a "recently loaded" entry so it can be re-opened instantly.
            const after = get();
            const psRadius = state.lidarMode === 'poisson'
                ? Math.min(state.lidarCloudRadius, POISSON_MAX_RADIUS)
                : state.lidarCloudRadius;
            void saveLoadedCloud(
                {
                    mode: state.lidarMode,
                    centerLng: center.lng,
                    centerLat: center.lat,
                    radius: psRadius,
                    stride: state.lidarCloudStride,
                    classes: state.lidarCloudClasses,
                    shader: state.lidarShader,
                },
                { shaded: after.lidarShaded, mesh: after.lidarMesh },
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            set({ lidarCloudLoading: false, lidarCloudError: message, lidarCloudProgress: null });
        }
    },
    clearLidarCloud: () => set({ lidarShaded: null, lidarMesh: null, lidarCloudError: null, lidarCloudProgress: null }),

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

    showLidarCloudSnapshot: (data) => set({
        lidarShaded: data.shaded,
        lidarMesh: data.mesh,
        lidarCloudLoading: false,
        lidarCloudError: null,
        lidarCloudProgress: null,
    }),
});

/** Persisted keys owned by the lidar slice. */
export function selectLidarPersisted(
    s: LidarSlice,
): Pick<
    PersistedSettings,
    | 'lidarMode'
    | 'lidarShader'
    | 'lidarCloudRadius'
    | 'lidarCloudStride'
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
        lidarCloudRadius: s.lidarCloudRadius,
        lidarCloudStride: s.lidarCloudStride,
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
