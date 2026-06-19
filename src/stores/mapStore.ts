import type { CliffStation } from '@/lib/cliffSlice';
import { setTileCacheMaxSize, type BlendMode } from '@/lib/compositeProtocol';
import type { LngLatTuple } from '@/lib/geo';
import {
    fetchLidarDelaunay,
    fetchLidarPoisson,
    fetchLidarShaded,
    type LidarProgress,
} from '@/lib/lidarBrowser';
import type { ShaderPreset } from '@/lib/lidarBrowser/slope';
import { colorsFromNormals, recolorMeshVertices } from '@/lib/lidarBrowser/slope';
import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';
import type { BaseLayerId } from '@/lib/mapStyle';
import { saveLoadedCloud } from '@/lib/savedClouds';
import { formatSunDate, todaySunDatePart } from '@/lib/sun';
import type maplibregl from 'maplibre-gl';
import { create } from 'zustand';

const STORAGE_KEY = 'open-cairn-settings';

/** Maximum capture radius (metres) allowed in Poisson mode (WASM heap / octree limit). */
export const POISSON_MAX_RADIUS = 500;

/** IGN LiDAR HD shadow product used as hillshade source. */
export type HillshadeSource = 'mns' | 'mnt' | 'mnh';

export const HILLSHADE_SOURCE_LABELS: Record<HillshadeSource, string> = {
    mns: 'MNS',
    mnt: 'MNT',
    mnh: 'MNH',
};

export type RenderQuality = 'balanced' | 'sharp';

export const RENDER_QUALITY_LABELS: Record<RenderQuality, string> = {
    balanced: 'Fluide',
    sharp: 'Net',
};

/**
 * DEM provider used for the 3D terrain mesh and dynamic sun hillshade.
 * `auto` uses IGN when a DEM API key is set, otherwise falls back to Mapterhorn.
 */
export type TerrainDemSource = 'auto' | 'ign' | 'mapterhorn';

export const TERRAIN_DEM_SOURCE_LABELS: Record<TerrainDemSource, string> = {
    auto: 'Auto',
    ign: 'IGN',
    mapterhorn: 'Mapterhorn',
};

export type UiTheme = 'light' | 'dark';

export interface MapView {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
}

interface MapState {
    view: MapView;
    setView: (view: Partial<MapView>) => void;

    baseLayer: BaseLayerId;
    setBaseLayer: (id: BaseLayerId) => void;

    /** Multiply-blended LiDAR HD hillshade overlay enabled. */
    hillshadeEnabled: boolean;
    setHillshadeEnabled: (v: boolean) => void;

    /** Which IGN LiDAR HD product is used as the shadow source. */
    hillshadeSource: HillshadeSource;
    setHillshadeSource: (v: HillshadeSource) => void;

    /** Blend mode used when compositing the shadow onto the base. */
    hillshadeBlend: BlendMode;
    setHillshadeBlend: (v: BlendMode) => void;

    /** Strength of the multiply blend (0 = no effect, 1 = full multiply). */
    hillshadeIntensity: number;
    setHillshadeIntensity: (v: number) => void;

    /**
     * Dynamic, sun-driven hillshade on the terrain DEM. Unlike the pre-baked
     * LiDAR HD shadow raster, this MapLibre hillshade layer follows the sun
     * date/time selected in the LiDAR panel (azimuth + altitude + warm tint).
     */
    sunHillshadeEnabled: boolean;
    setSunHillshadeEnabled: (v: boolean) => void;

    /** 3D terrain on the base layer. */
    terrainEnabled: boolean;
    setTerrainEnabled: (v: boolean) => void;

    /** Contour lines overlay. */
    contourLinesEnabled: boolean;
    setContourLinesEnabled: (v: boolean) => void;

    /** Opacity of the contour lines overlay (0..1). */
    contourLinesOpacity: number;
    setContourLinesOpacity: (v: number) => void;

    /** Vertical exaggeration of the 3D terrain. */
    terrainExaggeration: number;
    setTerrainExaggeration: (v: number) => void;

    /** DEM provider for the 3D terrain mesh (auto = IGN with key, else Mapterhorn). */
    terrainDemSource: TerrainDemSource;
    setTerrainDemSource: (v: TerrainDemSource) => void;

    /** Raster and canvas quality used for pitched 3D views. */
    renderQuality: RenderQuality;
    setRenderQuality: (v: RenderQuality) => void;

    /** Maximum number of composite tiles kept in memory cache. */
    tileCacheSize: number;
    setTileCacheSize: (v: number) => void;

    /** Light or dark UI theme. */
    uiTheme: UiTheme;
    setUiTheme: (v: UiTheme) => void;

    /** IGN API key for SCAN 25 (private WMTS). */
    ignScanApiKey: string;
    setIgnScanApiKey: (v: string) => void;

    /** IGN API key for terrain DEM (private WMS-r, HIGHRES.LINEAR). */
    ignDemApiKey: string;
    setIgnDemApiKey: (v: string) => void;

    /** Map instance reference for imperative operations. */
    mapInstance: maplibregl.Map | null;
    setMapInstance: (map: maplibregl.Map | null) => void;
    /** Fly the map to fit a bounding box [minLng, minLat, maxLng, maxLat]. */
    fitBounds: (bounds: [number, number, number, number], options?: { padding?: number }) => void;

    // ---- LiDAR HD point cloud ----
    /** Rendering mode: shaded point cloud, delaunay (Delaunay 2.5D ground mesh + points), or poisson (PoissonRecon WASM ground mesh + points). */
    lidarMode: 'shaded' | 'delaunay' | 'poisson';
    setLidarMode: (v: 'shaded' | 'delaunay' | 'poisson') => void;
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
    /** Point size in screen pixels (deck.gl PointCloudLayer). */
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
    /** Drapage orthophoto IGN sur le mesh 0..1 (0 = palette, 1 = photo). */
    lidarCloudPhotoOpacity: number;
    setLidarCloudPhotoOpacity: (v: number) => void;
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

    // ---- Cliff slice / cross-section tool ----
    /** True while the user is picking points of the slice polyline on the map. */
    cliffSliceActive: boolean;
    setCliffSliceActive: (v: boolean) => void;
    /** Which bottom panel is currently shown: route or cliff. Drives map click routing. */
    bottomMode: 'route' | 'cliff';
    setBottomMode: (m: 'route' | 'cliff') => void;
    /** Polyline vertices in WGS84 (≥2 → slice is drawn). */
    cliffSlicePoints: LngLatTuple[];
    setCliffSlicePoints: (pts: LngLatTuple[]) => void;
    addCliffSlicePoint: (p: LngLatTuple) => void;
    removeLastCliffSlicePoint: () => void;
    /** Half-width of the corridor sampled either side of the slice plane, meters. */
    cliffSliceCorridor: number;
    setCliffSliceCorridor: (v: number) => void;
    /** Apply ASPRS class colors to slice points. */
    cliffSliceColorClass: boolean;
    setCliffSliceColorClass: (v: boolean) => void;
    /** Modulate slice point color by depth (front → bright, back → dim). */
    cliffSliceColorDepth: boolean;
    setCliffSliceColorDepth: (v: boolean) => void;
    /** ASPRS LAS classes kept when extracting the slice profile (empty = all). Default = [2] (Sol). */
    cliffSliceClasses: number[];
    setCliffSliceClasses: (v: number[]) => void;
    toggleCliffSliceClass: (cls: number) => void;
    /** Climber-defined belay stations on the cliff profile. */
    cliffSliceStations: CliffStation[];
    addCliffSliceStation: (d: number, e: number) => void;
    removeCliffSliceStation: (id: string) => void;
    clearCliffSliceStations: () => void;
    /** Replace the whole stations list (used for restoring from share URL). */
    setCliffSliceStations: (stations: CliffStation[]) => void;
    setCliffSliceStationLabel: (id: string, label: string) => void;
    /** Safety margin added to the direct rope length (0.15 = +15 %). */
    cliffSliceRopeSafety: number;
    setCliffSliceRopeSafety: (v: number) => void;
    /** Reset everything (line + stations). */
    clearCliffSlice: () => void;
}

// Default view: French Alps, around the Vercors / Belledonne area, with a
// bit of pitch to immediately showcase the 3D terrain.
const DEFAULT_VIEW: MapView = {
    longitude: 5.7546,
    latitude: 45.2162,
    zoom: 11,
    pitch: 55,
    bearing: -20,
};

/** Keys persisted in localStorage. */
type PersistedSettings = {
    view?: MapView;
    baseLayer?: BaseLayerId;
    hillshadeEnabled?: boolean;
    hillshadeSource?: HillshadeSource;
    hillshadeBlend?: BlendMode;
    hillshadeIntensity?: number;
    sunHillshadeEnabled?: boolean;
    terrainEnabled?: boolean;
    terrainExaggeration?: number;
    terrainDemSource?: TerrainDemSource;
    contourLinesEnabled?: boolean;
    contourLinesOpacity?: number;
    uiTheme?: UiTheme;
    renderQuality?: RenderQuality;
    tileCacheSize?: number;
    ignScanApiKey?: string;
    ignDemApiKey?: string;
    lidarMode?: 'shaded' | 'delaunay' | 'poisson';
    lidarShader?: ShaderPreset;
    lidarCloudRadius?: number;
    lidarCloudStride?: number;
    lidarCloudPointSize?: number;
    lidarCloudSizeCompensation?: boolean;
    lidarCloudEdl?: boolean;
    lidarCloudEdlStrength?: number;
    lidarCloudEdlRadius?: number;
    lidarCloudEdlFarPlane?: number;
    lidarCloudOpacity?: number;
    lidarCloudPhotoOpacity?: number;
    lidarCloudBasemapOpacity?: number;
    lidarCloudClasses?: number[];
    lidarCloudPoissonDepth?: number;
    lidarCloudPoissonSamplesPerNode?: number;
    lidarCloudPoissonPointWeight?: number;
    lidarSunDate?: string;
    lidarSunEnabled?: boolean;
    lidarShadows?: boolean;
    lidarShadowStrength?: number;
    cliffSliceCorridor?: number;
    cliffSliceColorClass?: boolean;
    cliffSliceColorDepth?: boolean;
    cliffSliceClasses?: number[];
    cliffSliceRopeSafety?: number;
};

function loadPersistedSettings(): PersistedSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as PersistedSettings;
    } catch { /* ignore */ }
    return {};
}

/** Default sun date: today at noon, local time, as "YYYY-MM-DDTHH:mm". */
function defaultSunDate(): string {
    return formatSunDate(todaySunDatePart(), 12 * 60);
}

function savePersistedSettings(settings: PersistedSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
}

const persisted = loadPersistedSettings();

export const useMapStore = create<MapState>((set, get) => ({
    view: persisted.view ?? DEFAULT_VIEW,
    setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

    baseLayer: persisted.baseLayer ?? 'scan25',
    setBaseLayer: (baseLayer) => set({ baseLayer }),

    hillshadeEnabled: persisted.hillshadeEnabled ?? true,
    setHillshadeEnabled: (hillshadeEnabled) => set({ hillshadeEnabled }),

    hillshadeSource: persisted.hillshadeSource ?? 'mns',
    setHillshadeSource: (hillshadeSource) => set({ hillshadeSource }),

    hillshadeBlend: persisted.hillshadeBlend ?? 'lidar-neutral',
    setHillshadeBlend: (hillshadeBlend) => set({ hillshadeBlend }),

    sunHillshadeEnabled: persisted.sunHillshadeEnabled ?? false,
    setSunHillshadeEnabled: (sunHillshadeEnabled) => set({ sunHillshadeEnabled }),

    hillshadeIntensity: persisted.hillshadeIntensity ?? 0.85,
    setHillshadeIntensity: (hillshadeIntensity) => set({ hillshadeIntensity }),

    terrainEnabled: persisted.terrainEnabled ?? true,
    setTerrainEnabled: (terrainEnabled) => set({ terrainEnabled }),

    contourLinesEnabled: persisted.contourLinesEnabled ?? false,
    setContourLinesEnabled: (contourLinesEnabled) => set({ contourLinesEnabled }),

    contourLinesOpacity: persisted.contourLinesOpacity ?? 0.4,
    setContourLinesOpacity: (contourLinesOpacity) => set({ contourLinesOpacity }),

    terrainExaggeration: persisted.terrainExaggeration ?? 1,
    setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),

    terrainDemSource: persisted.terrainDemSource ?? 'auto',
    setTerrainDemSource: (terrainDemSource) => set({ terrainDemSource }),

    renderQuality: persisted.renderQuality ?? 'balanced',
    setRenderQuality: (renderQuality) => set({ renderQuality }),

    tileCacheSize: persisted.tileCacheSize ?? 256,
    setTileCacheSize: (tileCacheSize) => {
        setTileCacheMaxSize(tileCacheSize);
        set({ tileCacheSize });
    },

    uiTheme: persisted.uiTheme ?? 'light',
    setUiTheme: (uiTheme) => set({ uiTheme }),

    ignScanApiKey: persisted.ignScanApiKey ?? '',
    setIgnScanApiKey: (ignScanApiKey) => set({ ignScanApiKey }),

    ignDemApiKey: persisted.ignDemApiKey ?? '',
    setIgnDemApiKey: (ignDemApiKey) => set({ ignDemApiKey }),

    mapInstance: null,
    setMapInstance: (mapInstance) => set({ mapInstance }),
    fitBounds: (bounds, options) => {
        const map = get().mapInstance;
        if (!map) return;
        map.fitBounds(
            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            { padding: options?.padding ?? 50, duration: 1000 },
        );
    },

    // LiDAR HD point cloud state
    lidarMode: (persisted.lidarMode === 'shaded' || persisted.lidarMode === 'delaunay' || persisted.lidarMode === 'poisson') ? persisted.lidarMode : 'shaded',
    setLidarMode: (lidarMode) => set({ lidarMode }),
    lidarShader: (persisted.lidarShader === 'base' || persisted.lidarShader === 'cliff' || persisted.lidarShader === 'winter') ? persisted.lidarShader : 'cliff',
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
    lidarCloudPointSize: persisted.lidarCloudPointSize ?? 2,
    setLidarCloudPointSize: (lidarCloudPointSize) => set({ lidarCloudPointSize }),
    lidarCloudSizeCompensation: persisted.lidarCloudSizeCompensation ?? true,
    setLidarCloudSizeCompensation: (lidarCloudSizeCompensation) => set({ lidarCloudSizeCompensation }),
    lidarCloudEdl: persisted.lidarCloudEdl ?? true,
    setLidarCloudEdl: (lidarCloudEdl) => set({ lidarCloudEdl }),
    lidarCloudEdlStrength: persisted.lidarCloudEdlStrength ?? 8,
    setLidarCloudEdlStrength: (lidarCloudEdlStrength) => set({ lidarCloudEdlStrength }),
    lidarCloudEdlRadius: persisted.lidarCloudEdlRadius ?? 1,
    setLidarCloudEdlRadius: (lidarCloudEdlRadius) => set({ lidarCloudEdlRadius }),
    lidarCloudEdlFarPlane: persisted.lidarCloudEdlFarPlane ?? 1500,
    setLidarCloudEdlFarPlane: (lidarCloudEdlFarPlane) => set({ lidarCloudEdlFarPlane }),
    lidarCloudOpacity: persisted.lidarCloudOpacity ?? 1,
    setLidarCloudOpacity: (lidarCloudOpacity) => set({ lidarCloudOpacity }),
    lidarCloudPhotoOpacity: persisted.lidarCloudPhotoOpacity ?? 0,
    setLidarCloudPhotoOpacity: (lidarCloudPhotoOpacity) => set({ lidarCloudPhotoOpacity }),
    lidarCloudBasemapOpacity: persisted.lidarCloudBasemapOpacity ?? 1,
    setLidarCloudBasemapOpacity: (lidarCloudBasemapOpacity) => set({ lidarCloudBasemapOpacity }),
    lidarCloudClasses: persisted.lidarCloudClasses ?? [2],
    setLidarCloudClasses: (lidarCloudClasses) => set({ lidarCloudClasses }),
    lidarCloudPoissonDepth: persisted.lidarCloudPoissonDepth ?? 9,
    setLidarCloudPoissonDepth: (lidarCloudPoissonDepth) => set({ lidarCloudPoissonDepth }),
    lidarCloudPoissonSamplesPerNode: persisted.lidarCloudPoissonSamplesPerNode ?? 1.5,
    setLidarCloudPoissonSamplesPerNode: (lidarCloudPoissonSamplesPerNode) => set({ lidarCloudPoissonSamplesPerNode }),
    lidarCloudPoissonPointWeight: persisted.lidarCloudPoissonPointWeight ?? 4,
    setLidarCloudPoissonPointWeight: (lidarCloudPoissonPointWeight) => set({ lidarCloudPoissonPointWeight }),
    lidarSunDate: persisted.lidarSunDate ?? defaultSunDate(),
    setLidarSunDate: (lidarSunDate) => set({ lidarSunDate }),
    lidarSunEnabled: persisted.lidarSunEnabled ?? false,
    setLidarSunEnabled: (lidarSunEnabled) => set({ lidarSunEnabled }),
    lidarShadows: persisted.lidarShadows ?? true,
    setLidarShadows: (lidarShadows) => set({ lidarShadows }),
    lidarShadowStrength: persisted.lidarShadowStrength ?? 0.7,
    setLidarShadowStrength: (lidarShadowStrength) => set({ lidarShadowStrength }),
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
            lidarMode: 'shaded',
            lidarCloudPointSize: 2,
            lidarCloudSizeCompensation: true,
            lidarCloudEdl: true,
            lidarCloudEdlStrength: 8,
            lidarCloudEdlRadius: 1,
            lidarCloudEdlFarPlane: 1500,
            lidarCloudOpacity: 1,
            lidarCloudPhotoOpacity: 0,
            lidarCloudBasemapOpacity: 1,
            lidarCloudClasses: [2],
            lidarSunEnabled: false,
            lidarShadows: true,
            lidarShadowStrength: 0.7,
            contourLinesEnabled: false,
            contourLinesOpacity: 0.4,
        });
        // Go through the shader setter so the loaded geometry is recolored.
        get().setLidarShader('cliff');
    },

    showLidarCloudSnapshot: (data) => set({
        lidarShaded: data.shaded,
        lidarMesh: data.mesh,
        lidarCloudLoading: false,
        lidarCloudError: null,
        lidarCloudProgress: null,
    }),

    // Cliff slice state
    cliffSliceActive: false,
    setCliffSliceActive: (cliffSliceActive) => set({ cliffSliceActive }),
    bottomMode: 'route',
    setBottomMode: (bottomMode) => set({ bottomMode }),
    cliffSlicePoints: [],
    setCliffSlicePoints: (cliffSlicePoints) => set({ cliffSlicePoints }),
    addCliffSlicePoint: (p) => set((s) => ({ cliffSlicePoints: [...s.cliffSlicePoints, p] })),
    removeLastCliffSlicePoint: () => set((s) => ({ cliffSlicePoints: s.cliffSlicePoints.slice(0, -1) })),
    cliffSliceCorridor: persisted.cliffSliceCorridor ?? 2,
    setCliffSliceCorridor: (cliffSliceCorridor) => set({ cliffSliceCorridor }),
    cliffSliceColorClass: persisted.cliffSliceColorClass ?? true,
    setCliffSliceColorClass: (cliffSliceColorClass) => set({ cliffSliceColorClass }),
    cliffSliceColorDepth: persisted.cliffSliceColorDepth ?? false,
    setCliffSliceColorDepth: (cliffSliceColorDepth) => set({ cliffSliceColorDepth }),
    cliffSliceClasses: persisted.cliffSliceClasses ?? [2],
    setCliffSliceClasses: (cliffSliceClasses) => set({ cliffSliceClasses }),
    toggleCliffSliceClass: (cls) => set((s) => {
        const has = s.cliffSliceClasses.includes(cls);
        return {
            cliffSliceClasses: has
                ? s.cliffSliceClasses.filter((c) => c !== cls)
                : [...s.cliffSliceClasses, cls].sort((a, b) => a - b),
        };
    }),
    cliffSliceStations: [],
    addCliffSliceStation: (d, e) => set((s) => {
        const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        // Preserve click order — climbers chain rappels in the order they
        // place stations, not in left-to-right d order (a route can U-turn).
        return { cliffSliceStations: [...s.cliffSliceStations, { id, d, e }] };
    }),
    removeCliffSliceStation: (id) => set((s) => ({
        cliffSliceStations: s.cliffSliceStations.filter((x) => x.id !== id),
    })),
    clearCliffSliceStations: () => set({ cliffSliceStations: [] }),
    setCliffSliceStations: (cliffSliceStations) => set({ cliffSliceStations }),
    setCliffSliceStationLabel: (id, label) => set((s) => ({
        cliffSliceStations: s.cliffSliceStations.map((st) => st.id === id ? { ...st, label } : st),
    })),
    cliffSliceRopeSafety: persisted.cliffSliceRopeSafety ?? 0.15,
    setCliffSliceRopeSafety: (cliffSliceRopeSafety) => set({ cliffSliceRopeSafety }),
    clearCliffSlice: () => set({
        cliffSlicePoints: [],
        cliffSliceStations: [],
        cliffSliceActive: true,
    }),

}));

// Auto-save all persistent settings to localStorage whenever they change.
// Debounced to avoid excessive writes during continuous interactions (panning, etc.).
let _mapSaveTimer: ReturnType<typeof setTimeout> | null = null;
useMapStore.subscribe((state) => {
    if (_mapSaveTimer) clearTimeout(_mapSaveTimer);
    _mapSaveTimer = setTimeout(() => {
        savePersistedSettings({
            view: state.view,
            baseLayer: state.baseLayer,
            hillshadeEnabled: state.hillshadeEnabled,
            hillshadeSource: state.hillshadeSource,
            hillshadeBlend: state.hillshadeBlend,
            hillshadeIntensity: state.hillshadeIntensity,
            sunHillshadeEnabled: state.sunHillshadeEnabled,
            terrainEnabled: state.terrainEnabled,
            terrainExaggeration: state.terrainExaggeration,
            terrainDemSource: state.terrainDemSource,
            contourLinesEnabled: state.contourLinesEnabled,
            contourLinesOpacity: state.contourLinesOpacity,
            uiTheme: state.uiTheme,
            renderQuality: state.renderQuality,
            tileCacheSize: state.tileCacheSize,
            ignScanApiKey: state.ignScanApiKey,
            ignDemApiKey: state.ignDemApiKey,
            lidarMode: state.lidarMode,
            lidarCloudRadius: state.lidarCloudRadius,
            lidarCloudStride: state.lidarCloudStride,
            lidarCloudPointSize: state.lidarCloudPointSize,
            lidarCloudSizeCompensation: state.lidarCloudSizeCompensation,
            lidarCloudEdl: state.lidarCloudEdl,
            lidarCloudEdlStrength: state.lidarCloudEdlStrength,
            lidarCloudEdlRadius: state.lidarCloudEdlRadius,
            lidarCloudEdlFarPlane: state.lidarCloudEdlFarPlane,
            lidarCloudOpacity: state.lidarCloudOpacity,
            lidarCloudPhotoOpacity: state.lidarCloudPhotoOpacity,
            lidarCloudBasemapOpacity: state.lidarCloudBasemapOpacity,
            lidarCloudClasses: state.lidarCloudClasses,
            lidarCloudPoissonDepth: state.lidarCloudPoissonDepth,
            lidarCloudPoissonSamplesPerNode: state.lidarCloudPoissonSamplesPerNode,
            lidarCloudPoissonPointWeight: state.lidarCloudPoissonPointWeight,
            lidarShader: state.lidarShader,
            lidarSunDate: state.lidarSunDate,
            lidarSunEnabled: state.lidarSunEnabled,
            lidarShadows: state.lidarShadows,
            lidarShadowStrength: state.lidarShadowStrength,
            cliffSliceCorridor: state.cliffSliceCorridor,
            cliffSliceColorClass: state.cliffSliceColorClass,
            cliffSliceColorDepth: state.cliffSliceColorDepth,
            cliffSliceClasses: state.cliffSliceClasses,
            cliffSliceRopeSafety: state.cliffSliceRopeSafety,
        });
    }, 500);
});
