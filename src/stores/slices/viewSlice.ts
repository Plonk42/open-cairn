import type { BaseLayerId } from '@/lib/mapStyle';
import type { AppView } from '@/lib/useView';
import type maplibregl from 'maplibre-gl';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import {
    initialActiveStyle,
    initialAppView,
    initialMapStyleByView,
    patchActiveStyle,
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
     * Top-level view mirrored from the URL `?view=` param. Used to know which
     * copy of the per-view map-style bundle the style setters should write to.
     */
    appView: AppView;
    /** Swap the active map-style fields to the given view's stored copy. */
    setAppView: (view: AppView) => void;
    /** Per-view map-style bundle (Itinéraire vs LiDAR Studio). */
    mapStyleByView: Record<AppView, MapStyleSettings>;

    baseLayer: BaseLayerId;
    setBaseLayer: (id: BaseLayerId) => void;

    /** Map instance reference for imperative operations. */
    mapInstance: maplibregl.Map | null;
    setMapInstance: (map: maplibregl.Map | null) => void;
    /** Fly the map to fit a bounding box [minLng, minLat, maxLng, maxLat]. */
    fitBounds: (bounds: [number, number, number, number], options?: { padding?: number }) => void;
}

export const createViewSlice: StateCreator<MapState, [], [], ViewSlice> = (set, get) => ({
    view: persisted.view ?? DEFAULT_VIEW,
    setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

    appView: initialAppView,
    setAppView: (view) =>
        set((s) => (view === s.appView ? {} : { appView: view, ...s.mapStyleByView[view] })),
    mapStyleByView: initialMapStyleByView,

    baseLayer: initialActiveStyle.baseLayer,
    setBaseLayer: (baseLayer) => patchActiveStyle(set, { baseLayer }),

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
export function selectViewPersisted(s: ViewSlice): Pick<PersistedSettings, 'view' | 'mapStyleByView'> {
    return {
        view: s.view,
        mapStyleByView: s.mapStyleByView,
    };
}
