import type { BaseLayerId } from '@/lib/baseLayers';
import type { AppView } from '@/lib/useView';
import type * as maplibregl from 'maplibre-gl';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import {
    gateKeyedBaseLayer,
    initialActiveStyle,
    initialAppView,
    initialMapStyleByView,
    LIDAR_STYLE_DEFAULTS,
    MAP_STYLE_DEFAULTS,
    otherView,
    patchActiveStyle,
    pickFond,
    type MapStyleSettings,
} from '../mapStyleView';
import { persisted, type PersistedSettings } from '../persistence';

export interface MapView {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
}

// Default view: French Alps, around the Vercors / Belledonne area, with a
// bit of pitch to immediately showcase the 3D terrain.
export const DEFAULT_VIEW: MapView = {
    longitude: 5.7546,
    latitude: 45.2162,
    zoom: 11,
    pitch: 55,
    bearing: -20,
};

export interface ViewSlice {
    view: MapView;
    setView: (view: Partial<MapView>) => void;

    /**
    /**
     * Whether the docked route/elevation panel is reduced to its summary bar
     * (route stats only, no chart). The dock itself is always there: reduced,
     * it keeps the route context and the Lecture / Édition switch in ~40 px.
     */
    bottomCollapsed: boolean;
    setBottomCollapsed: (v: boolean) => void;

    /**
     * Top-level view mirrored from the URL `?view=` param. Used to know which
     * copy of the per-view map-style bundle the style setters should write to.
     */
    appView: AppView;
    /** Swap the active map-style fields to the given view's stored copy. */
    setAppView: (view: AppView) => void;
    /** Per-view map-style bundle (Itinéraire vs LiDAR Studio). */
    mapStyleByView: Record<AppView, MapStyleSettings>;
    /** Put the active view's map style (fond, terrain) back to its defaults — both views' Fond while pinned. */
    resetMapStyle: () => void;
    /**
     * Meta-setting: the « Fond » is shared by both views instead of one copy
     * each. Pinning copies the current view's Fond into the other one;
     * unpinning leaves both copies as they are.
     */
    mapStylePinned: boolean;
    setMapStylePinned: (v: boolean) => void;

    baseLayer: BaseLayerId;
    setBaseLayer: (id: BaseLayerId) => void;

    /**
     * IGN toponym overlay. Only has an effect on the basemaps flagged `textless`
     * in `BASE_LAYERS` (see `showToponyms` in `mapStyle`).
     */
    toponymsEnabled: boolean;
    setToponymsEnabled: (v: boolean) => void;

    /**
     * Set by the mobile long-press coordinate readout (`TouchCoordinates`) for
     * the span between the press firing and the finger lifting, so the click
     * synthesised by that touch doesn't also edit the route. Session-only.
     */
    coordPickActive: boolean;
    setCoordPickActive: (v: boolean) => void;

    /** Map instance reference for imperative operations. */
    mapInstance: maplibregl.Map | null;
    setMapInstance: (map: maplibregl.Map | null) => void;
    /** Fly the map to fit a bounding box [minLng, minLat, maxLng, maxLat]. */
    fitBounds: (bounds: [number, number, number, number], options?: { padding?: number }) => void;
}

export const createViewSlice: StateCreator<MapState, [], [], ViewSlice> = (set, get) => ({
    view: persisted.view ?? DEFAULT_VIEW,
    setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

    // Reduced until the first waypoint unfolds it (`RouteDock`).
    bottomCollapsed: true,
    setBottomCollapsed: (bottomCollapsed) => set({ bottomCollapsed }),

    appView: initialAppView,
    setAppView: (view) =>
        set((s) => (view === s.appView ? {} : { appView: view, ...s.mapStyleByView[view] })),
    mapStyleByView: initialMapStyleByView,
    resetMapStyle: () => {
        const defaults = get().appView === 'lidar' ? LIDAR_STYLE_DEFAULTS : MAP_STYLE_DEFAULTS;
        patchActiveStyle(set, {
            ...defaults,
            baseLayer: gateKeyedBaseLayer(defaults.baseLayer, get().ignApiKey),
        });
    },
    mapStylePinned: persisted.mapStylePinned ?? false,
    setMapStylePinned: (mapStylePinned) => {
        if (!mapStylePinned) {
            set({ mapStylePinned });
            return;
        }
        set((s) => {
            const other = otherView(s.appView);
            return {
                mapStylePinned,
                mapStyleByView: {
                    ...s.mapStyleByView,
                    [other]: { ...s.mapStyleByView[other], ...pickFond(s.mapStyleByView[s.appView]) },
                },
            };
        });
    },

    baseLayer: initialActiveStyle.baseLayer,
    setBaseLayer: (baseLayer) => patchActiveStyle(set, { baseLayer }),

    toponymsEnabled: initialActiveStyle.toponymsEnabled,
    setToponymsEnabled: (toponymsEnabled) => patchActiveStyle(set, { toponymsEnabled }),

    coordPickActive: false,
    setCoordPickActive: (coordPickActive) => set({ coordPickActive }),

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
});

/** Persisted keys owned by the view slice. */
export function selectViewPersisted(s: ViewSlice): Pick<PersistedSettings, 'view' | 'mapStyleByView' | 'mapStylePinned'> {
    return {
        view: s.view,
        mapStyleByView: s.mapStyleByView,
        mapStylePinned: s.mapStylePinned,
    };
}
