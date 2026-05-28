import { setTileCacheMaxSize, type BlendMode } from '@/lib/compositeProtocol';
import {
    fetchLidarMixed,
    fetchLidarShaded,
    type LidarProgress,
} from '@/lib/lidarBrowser';
import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';
import type { BaseLayerId } from '@/lib/mapStyle';
import type maplibregl from 'maplibre-gl';
import { create } from 'zustand';

const STORAGE_KEY = 'open-cairn-settings';

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
    /** Rendering mode: shaded point cloud or mixed (ground mesh + vegetation/buildings points). */
    lidarMode: 'shaded' | 'mixed';
    setLidarMode: (v: 'shaded' | 'mixed') => void;
    /** Loaded shaded point cloud (positions + normals + slope colors). */
    lidarShaded: LidarShadedCloudData | null;
    /** Loaded ground mesh for mixed mode. */
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
    /** Whether to dim the underlying basemap when the cloud is visible. */
    lidarCloudHideBasemap: boolean;
    setLidarCloudHideBasemap: (v: boolean) => void;
    /** LAS classification filter (empty = all classes). */
    lidarCloudClasses: number[];
    setLidarCloudClasses: (v: number[]) => void;
    /** Show a preview rectangle on the map indicating the zone that will be loaded. */
    lidarPreviewVisible: boolean;
    setLidarPreviewVisible: (v: boolean) => void;
    /** Load the point cloud centered on the current map view. */
    loadLidarCloud: () => Promise<void>;
    /** Clear the currently displayed point cloud. */
    clearLidarCloud: () => void;
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
    terrainEnabled?: boolean;
    terrainExaggeration?: number;
    contourLinesEnabled?: boolean;
    contourLinesOpacity?: number;
    uiTheme?: UiTheme;
    renderQuality?: RenderQuality;
    tileCacheSize?: number;
    ignScanApiKey?: string;
    ignDemApiKey?: string;
    lidarMode?: 'shaded' | 'mixed';
    lidarCloudRadius?: number;
    lidarCloudStride?: number;
    lidarCloudPointSize?: number;
    lidarCloudSizeCompensation?: boolean;
    lidarCloudEdl?: boolean;
    lidarCloudEdlStrength?: number;
    lidarCloudEdlRadius?: number;
    lidarCloudEdlFarPlane?: number;
    lidarCloudOpacity?: number;
    lidarCloudHideBasemap?: boolean;
    lidarCloudClasses?: number[];
};

function loadPersistedSettings(): PersistedSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as PersistedSettings;
    } catch { /* ignore */ }
    return {};
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

    hillshadeIntensity: persisted.hillshadeIntensity ?? 0.85,
    setHillshadeIntensity: (hillshadeIntensity) => set({ hillshadeIntensity }),

    terrainEnabled: persisted.terrainEnabled ?? true,
    setTerrainEnabled: (terrainEnabled) => set({ terrainEnabled }),

    contourLinesEnabled: persisted.contourLinesEnabled ?? false,
    setContourLinesEnabled: (contourLinesEnabled) => set({ contourLinesEnabled }),

    contourLinesOpacity: persisted.contourLinesOpacity ?? 0.4,
    setContourLinesOpacity: (contourLinesOpacity) => set({ contourLinesOpacity }),

    terrainExaggeration: persisted.terrainExaggeration ?? 1.2,
    setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),

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
    lidarMode: (persisted.lidarMode === 'shaded' || persisted.lidarMode === 'mixed') ? persisted.lidarMode : 'shaded',
    setLidarMode: (lidarMode) => set({ lidarMode }),
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
    lidarCloudHideBasemap: persisted.lidarCloudHideBasemap ?? false,
    setLidarCloudHideBasemap: (lidarCloudHideBasemap) => set({ lidarCloudHideBasemap }),
    lidarCloudClasses: persisted.lidarCloudClasses ?? [2],
    setLidarCloudClasses: (lidarCloudClasses) => set({ lidarCloudClasses }),
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
            if (state.lidarMode === 'mixed') {
                const mixed = await fetchLidarMixed({
                    lng: center.lng,
                    lat: center.lat,
                    radius: state.lidarCloudRadius,
                    stride: state.lidarCloudStride,
                    onProgress,
                });
                // Set both shaded and mesh layers for mixed mode display
                set({
                    lidarShaded: mixed.shaded,
                    lidarMesh: mixed.mesh,
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
                    onProgress,
                });
                set({ lidarShaded: shaded, lidarMesh: null, lidarCloudLoading: false, lidarCloudProgress: null });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            set({ lidarCloudLoading: false, lidarCloudError: message, lidarCloudProgress: null });
        }
    },
    clearLidarCloud: () => set({ lidarShaded: null, lidarMesh: null, lidarCloudError: null, lidarCloudProgress: null }),

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
            terrainEnabled: state.terrainEnabled,
            terrainExaggeration: state.terrainExaggeration,
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
            lidarCloudHideBasemap: state.lidarCloudHideBasemap,
            lidarCloudClasses: state.lidarCloudClasses,
        });
    }, 500);
});
