import type { BlendMode } from '@/lib/compositeProtocol';
import type { ShaderPreset } from '@/lib/lidarBrowser/slope';
import type { BaseLayerId } from '@/lib/mapStyle';
import type { LidarMode } from './slices/lidarSlice';
import type { RenderQuality, UiTheme } from './slices/settingsSlice';
import type { HillshadeSource, TerrainDemSource } from './slices/terrainSlice';
import type { MapView } from './slices/viewSlice';

export const STORAGE_KEY = 'open-cairn-settings';

/** Keys persisted in localStorage. */
export type PersistedSettings = {
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
    studioTutorialSeen?: boolean;
    renderQuality?: RenderQuality;
    tileCacheSize?: number;
    ignScanApiKey?: string;
    ignDemApiKey?: string;
    lidarMode?: LidarMode;
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
    lidarCloudPhotoOpacityNonGround?: number;
    lidarCloudBasemapOpacity?: number;
    lidarCloudClasses?: number[];
    lidarCloudPoissonDepth?: number;
    lidarCloudPoissonSamplesPerNode?: number;
    lidarCloudPoissonPointWeight?: number;
    lidarSunDate?: string;
    lidarSunEnabled?: boolean;
    lidarShadows?: boolean;
    lidarShadowStrength?: number;
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
    cliffSliceCorridor?: number;
    cliffSliceColorClass?: boolean;
    cliffSliceColorDepth?: boolean;
    cliffSliceClasses?: number[];
    cliffSliceRopeSafety?: number;
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

