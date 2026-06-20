import { create } from 'zustand';
import { savePersistedSettings } from './persistence';
import { createViewSlice, type ViewSlice } from './slices/viewSlice';
import { createTerrainSlice, type TerrainSlice } from './slices/terrainSlice';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createLidarSlice, type LidarSlice } from './slices/lidarSlice';
import { createCliffSliceSlice, type CliffSliceSlice } from './slices/cliffSliceSlice';

// Re-export the public store API (types + label maps + constants) so existing
// imports from '@/stores/mapStore' keep working after the slice split.
export type { MapView } from './slices/viewSlice';
export {
    HILLSHADE_SOURCE_LABELS,
    TERRAIN_DEM_SOURCE_LABELS,
    type HillshadeSource,
    type TerrainDemSource,
} from './slices/terrainSlice';
export {
    RENDER_QUALITY_LABELS,
    type RenderQuality,
    type UiTheme,
} from './slices/settingsSlice';
export { POISSON_MAX_RADIUS, type LidarMode } from './slices/lidarSlice';

/** Full store shape — the union of every feature slice. */
export type MapState = ViewSlice & TerrainSlice & SettingsSlice & LidarSlice & CliffSliceSlice;

export const useMapStore = create<MapState>()((...a) => ({
    ...createViewSlice(...a),
    ...createTerrainSlice(...a),
    ...createSettingsSlice(...a),
    ...createLidarSlice(...a),
    ...createCliffSliceSlice(...a),
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
            studioTutorialSeen: state.studioTutorialSeen,
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
