import type { BlendMode } from '@/lib/compositeProtocol';
import type { BaseLayerId } from '@/lib/mapStyle';
import { readView, type AppView } from '@/lib/useView';
import type { MapState } from './mapStore';
import { persisted, type PersistedSettings } from './persistence';
import type { HillshadeSource, TerrainDemSource } from './slices/terrainSlice';

/**
 * The bundle of map-style settings that is duplicated per top-level view.
 *
 * Both the classic Itinéraire view (`?view=map`) and the LiDAR Studio
 * (`?view=lidar`) keep their OWN copy of these values, swapped automatically
 * when the URL `?view=` changes. LiDAR render settings and
 * `lidarCloudBasemapOpacity` stay global (single cloud, single appearance).
 *
 * NOTE: In the LiDAR Studio the map still FORCES 3D terrain on and vertical
 * exaggeration to 1x at the MapLibre layer (see MapContainer), regardless of
 * the lidar copy's stored `terrainEnabled` / `terrainExaggeration`, so the
 * point cloud stays correctly mapped onto the terrain.
 */
export interface MapStyleSettings {
    baseLayer: BaseLayerId;
    hillshadeEnabled: boolean;
    hillshadeSource: HillshadeSource;
    hillshadeBlend: BlendMode;
    hillshadeIntensity: number;
    sunHillshadeEnabled: boolean;
    terrainEnabled: boolean;
    terrainExaggeration: number;
    terrainDemSource: TerrainDemSource;
    contourLinesEnabled: boolean;
    contourLinesOpacity: number;
}

/** Defaults for the classic Itinéraire view. */
export const MAP_STYLE_DEFAULTS: MapStyleSettings = {
    baseLayer: 'scan25',
    hillshadeEnabled: true,
    hillshadeSource: 'mns',
    hillshadeBlend: 'lidar-neutral',
    hillshadeIntensity: 0.85,
    sunHillshadeEnabled: false,
    terrainEnabled: true,
    terrainExaggeration: 1,
    terrainDemSource: 'auto',
    contourLinesEnabled: false,
    contourLinesOpacity: 0.4,
};

/** Defaults for the LiDAR Studio: same look, but photo (ortho) basemap. */
export const LIDAR_STYLE_DEFAULTS: MapStyleSettings = {
    ...MAP_STYLE_DEFAULTS,
    baseLayer: 'ortho',
};

/**
 * Seed the per-view bundle from persisted state. Prefers the new
 * `mapStyleByView` shape; otherwise migrates from the legacy flat keys so
 * existing users keep their settings (the lidar copy defaults to the photo
 * basemap, matching the previous Studio behaviour).
 */
function seedByView(p: PersistedSettings): Record<AppView, MapStyleSettings> {
    if (p.mapStyleByView) return p.mapStyleByView;
    const base: MapStyleSettings = {
        baseLayer: p.baseLayer ?? MAP_STYLE_DEFAULTS.baseLayer,
        hillshadeEnabled: p.hillshadeEnabled ?? MAP_STYLE_DEFAULTS.hillshadeEnabled,
        hillshadeSource: p.hillshadeSource ?? MAP_STYLE_DEFAULTS.hillshadeSource,
        hillshadeBlend: p.hillshadeBlend ?? MAP_STYLE_DEFAULTS.hillshadeBlend,
        hillshadeIntensity: p.hillshadeIntensity ?? MAP_STYLE_DEFAULTS.hillshadeIntensity,
        sunHillshadeEnabled: p.sunHillshadeEnabled ?? MAP_STYLE_DEFAULTS.sunHillshadeEnabled,
        terrainEnabled: p.terrainEnabled ?? MAP_STYLE_DEFAULTS.terrainEnabled,
        terrainExaggeration: p.terrainExaggeration ?? MAP_STYLE_DEFAULTS.terrainExaggeration,
        terrainDemSource: p.terrainDemSource ?? MAP_STYLE_DEFAULTS.terrainDemSource,
        contourLinesEnabled: p.contourLinesEnabled ?? MAP_STYLE_DEFAULTS.contourLinesEnabled,
        contourLinesOpacity: p.contourLinesOpacity ?? MAP_STYLE_DEFAULTS.contourLinesOpacity,
    };
    return { map: base, lidar: { ...base, baseLayer: LIDAR_STYLE_DEFAULTS.baseLayer } };
}

/** Top-level view at store-init time (URL is the source of truth). */
export const initialAppView: AppView = readView();

/** Per-view bundle seeded once at module init. */
export const initialMapStyleByView: Record<AppView, MapStyleSettings> = seedByView(persisted);

/** The active view's style copy used to seed the flat store fields. */
export const initialActiveStyle: MapStyleSettings = initialMapStyleByView[initialAppView];

type StyleSet = (partial: (state: MapState) => Partial<MapState>) => void;

/**
 * Write a style patch to BOTH the active flat store fields (which every map
 * consumer reads) AND the current view's copy in `mapStyleByView`, so the
 * change is remembered when the user switches back to that view.
 */
export function patchActiveStyle(set: StyleSet, patch: Partial<MapStyleSettings>): void {
    set((s) => ({
        ...patch,
        mapStyleByView: {
            ...s.mapStyleByView,
            [s.appView]: { ...s.mapStyleByView[s.appView], ...patch },
        },
    }));
}
