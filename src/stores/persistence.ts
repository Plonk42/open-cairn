import type { BlendMode } from '@/lib/compositeProtocol';
import type { ShaderPreset } from '@/lib/lidarBrowser/slope';
import type { BaseLayerId } from '@/lib/mapStyle';
import type { HillshadeSource, RenderQuality, TerrainDemSource, UiTheme } from './slices/settingsSlice';
import type { LidarMode } from './slices/lidarSlice';
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

