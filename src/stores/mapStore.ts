import { create } from 'zustand';
import { savePersistedSettings } from './persistence';
import { createViewSlice, selectViewPersisted, type ViewSlice } from './slices/viewSlice';
import { createTerrainSlice, selectTerrainPersisted, type TerrainSlice } from './slices/terrainSlice';
import { createSettingsSlice, selectSettingsPersisted, type SettingsSlice } from './slices/settingsSlice';
import { createLidarSlice, selectLidarPersisted, type LidarSlice } from './slices/lidarSlice';
import { createCliffSliceSlice, selectCliffSlicePersisted, type CliffSliceSlice } from './slices/cliffSliceSlice';

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
// Each slice owns the selection of its persisted keys (select*Persisted), so
// adding a setting only requires touching the slice that introduces it.
let _mapSaveTimer: ReturnType<typeof setTimeout> | null = null;
useMapStore.subscribe((state) => {
    if (_mapSaveTimer) clearTimeout(_mapSaveTimer);
    _mapSaveTimer = setTimeout(() => {
        savePersistedSettings({
            ...selectViewPersisted(state),
            ...selectTerrainPersisted(state),
            ...selectSettingsPersisted(state),
            ...selectLidarPersisted(state),
            ...selectCliffSlicePersisted(state),
        });
    }, 500);
});
