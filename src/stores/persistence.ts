import type { DrapeSource } from '@/lib/baseLayers';
import type { RockType, ShaderPreset } from '@/lib/lidarBrowser/slope';
import type { CaptureRect } from '@/lib/lidarCaptureRect';
import type { AppView } from '@/lib/useView';
import type { MapStyleSettings } from './mapStyleView';
import type { LidarMode } from './slices/lidarSlice';
import type { RenderQuality, UiTheme } from './slices/settingsSlice';
import type { MapView } from './slices/viewSlice';

export const STORAGE_KEY = 'open-cairn-settings';

/** Keys persisted in localStorage. */
export type PersistedSettings = {
    view?: MapView;
    /** Per-view map-style bundle (Itinéraire vs LiDAR Studio). */
    mapStyleByView?: Record<AppView, MapStyleSettings>;
    /** « Fond » shared by both views (`mapStyleByView` copies kept in sync). */
    mapStylePinned?: boolean;
    uiTheme?: UiTheme;
    studioTutorialSeen?: boolean;
    /** Desktop side panel folded to its title bar, shared by both views. */
    sidePanelCollapsed?: boolean;
    /** Open sections of the desktop side panel, per view. */
    studioPanelSections?: string[];
    routePanelSections?: string[];
    /** Desktop top-bar groups folded to a single button. */
    topBarCameraCollapsed?: boolean;
    topBarSceneCollapsed?: boolean;
    /**
     * Sky tracks of the sun and of the moon. A planning overlay, not part of a
     * scene's ambiance: an exported showcase render must not carry a
     * measurement line across it.
     */
    skySunPath?: boolean;
    skyMoonPath?: boolean;
    skyHiddenPath?: boolean;
    /** Name the visible summits along the ridge, in « Point de vue ». */
    peakLabels?: boolean;
    /** Map view: sun-driven sky instead of the style's neutral one. */
    atmosphericSky?: boolean;
    renderQuality?: RenderQuality;
    tileCacheSize?: number;
    ignApiKey?: string;
    ignDemApiKey?: string;
    lidarMode?: LidarMode;
    lidarShader?: ShaderPreset;
    lidarSnowLine?: number;
    lidarSnowAmount?: number;
    lidarRockType?: RockType;
    lidarCoverEnabled?: boolean;
    lidarCloudStride?: number;
    lidarCaptureRect?: CaptureRect;
    lidarCaptureResolution?: number;
    lidarCloudGroundStride?: number;
    lidarMeshSmooth?: boolean;
    lidarGridCell?: number;
    lidarVegGroundGap?: number;
    lidarVegGroundRough?: number;
    lidarVegColumnCell?: number;
    lidarVegRoughLowFrac?: number;
    lidarVegOverhangReach?: number;
    lidarVegCliffDistMode?: 'column' | 'surface3d' | 'rimDepth' | 'wallHoriz';
    lidarVegColorSmooth?: number;
    lidarVegCliffSparseFallback?: number;
    lidarVegCliffSlopeDeg?: number;
    lidarVegCliffSlopeSample?: number;
    lidarVegCliffSlopeMin?: number;
    lidarVegDiagMode?: 'off' | 'decision' | 'clusters' | 'roughness' | 'flags';
    lidarCloudPointSize?: number;
    lidarCloudSizeCompensation?: boolean;
    lidarCloudEdl?: boolean;
    lidarCloudEdlStrength?: number;
    lidarCloudEdlRadius?: number;
    lidarCloudEdlFarPlane?: number;
    lidarCloudOpacity?: number;
    lidarCloudPhotoOpacity?: number;
    lidarCloudPhotoOpacityNonGround?: number;
    lidarCloudPhotoSource?: DrapeSource;
    lidarCloudPhotoDetail?: boolean;
    lidarCloudBasemapOpacity?: number;
    lidarCloudClasses?: number[];
    lidarCloudPoissonDepth?: number;
    lidarCloudPoissonSamplesPerNode?: number;
    lidarCloudPoissonPointWeight?: number;
    lidarCloudPoissonSharpen?: number;
    lidarCloudPoissonNormalRobust?: number;
    lidarCloudPoissonFlatBase?: boolean;
    lidarSunDate?: string;
    lidarSunAzimuth?: number;
    lidarSunElevation?: number;
    lidarSunWarmth?: number;
    lidarSunIntensity?: number;
    lidarSunEnabled?: boolean;
    lidarShadows?: boolean;
    lidarShadowStrength?: number;
    lidarShadowMapSize?: number;
    lidarPhotoreal?: boolean;
    lidarExposure?: number;
    lidarAmbient?: number;
    lidarSunStrength?: number;
    lidarHaze?: number;
    lidarRockFacet?: number;
    lidarRockMicro?: number;
    lidarRockBreak?: number;
    lidarRockSpecular?: number;
    lidarAo?: number;
    lidarVegEnhance?: boolean;
    lidarVegColorMode?: 'natural' | 'height' | 'species';
    lidarVegHeightScale?: number;
    lidarVegHeightAuto?: boolean;
    lidarVegIntensity?: number;
    lidarVegNormalShade?: number;
    lidarVegSizeBoost?: number;
    /** IGN BD Forêt® species rendering: legend grouping ('group' families / 'species'). */
    lidarForestGrouping?: 'group' | 'species';
    /** GPU mix-cell size (m) for the procedural species mosaic inside mixed stands. */
    lidarForestMixCellSize?: number;
    /** Essence-boundary blend mode: 'sharp' | 'feather' | 'scatter'. */
    lidarForestEdgeBlend?: 'sharp' | 'feather' | 'scatter';
    /** Width (m) of the essence-boundary transition band (feather/scatter). */
    lidarForestEdgeBandM?: number;
    /** CHM treetop detection sensitivity 0..1 (higher = more, smaller crowns). */
    lidarForestTreetopSensitivity?: number;
    /** Legend-as-filter: hidden legend ids (empty = all visible). */
    lidarForestHiddenLegend?: number[];
    /** Whether the species legend filter is active. */
    lidarForestSpeciesFilterOn?: boolean;
};

export function loadPersistedSettings(): PersistedSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as PersistedSettings;
    } catch { /* ignore */ }
    return {};
}

export function savePersistedSettings(settings: PersistedSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
}

/** Persisted settings loaded once at module init; consumed by the store slices to seed defaults. */
export const persisted: PersistedSettings = loadPersistedSettings();

