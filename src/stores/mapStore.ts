import { create } from 'zustand';
import { savePersistedSettings } from './persistence';
import { createLidarSlice, selectLidarPersisted, type LidarSlice } from './slices/lidarSlice';
import { createSettingsSlice, selectSettingsPersisted, type SettingsSlice } from './slices/settingsSlice';
import { createTerrainSlice, type TerrainSlice } from './slices/terrainSlice';
import { createViewSlice, selectViewPersisted, type ViewSlice } from './slices/viewSlice';

// Re-export the public store API (types + label maps + constants) so existing
// imports from '@/stores/mapStore' keep working after the slice split.
export { POISSON_MAX_AREA_M2, type LidarMode } from './slices/lidarSlice';
export {
    RENDER_QUALITY_LABELS,
    type RenderQuality,
    type UiTheme
} from './slices/settingsSlice';
export {
    HILLSHADE_SOURCE_LABELS,
    TERRAIN_DEM_SOURCE_LABELS,
    type HillshadeSource,
    type TerrainDemSource
} from './slices/terrainSlice';
export type { MapView } from './slices/viewSlice';

/** Full store shape — the union of every feature slice. */
export type MapState = ViewSlice & TerrainSlice & SettingsSlice & LidarSlice;

export const useMapStore = create<MapState>()((...a) => ({
    ...createViewSlice(...a),
    ...createTerrainSlice(...a),
    ...createSettingsSlice(...a),
    ...createLidarSlice(...a),
}));

// Auto-save all persistent settings to localStorage whenever they change.
// Debounced to avoid excessive writes during continuous interactions (panning, etc.).
// Each slice owns the selection of its persisted keys (select*Persisted), so
// adding a setting only requires touching the slice that introduces it.
let _mapSaveTimer: ReturnType<typeof setTimeout> | null = null;
useMapStore.subscribe((state) => {
    if (_mapSaveTimer) clearTimeout(_mapSaveTimer);
    _mapSaveTimer = setTimeout(() => {
        savePersistedSettings({
            ...selectViewPersisted(state),
            ...selectSettingsPersisted(state),
            ...selectLidarPersisted(state),
        });
    }, 500);
});
