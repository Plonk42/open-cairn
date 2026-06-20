import type maplibregl from 'maplibre-gl';
import type { StateCreator } from 'zustand';
import type { BaseLayerId } from '@/lib/mapStyle';
import { persisted } from '../persistence';
import type { MapState } from '../mapStore';

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

    baseLayer: persisted.baseLayer ?? 'scan25',
    setBaseLayer: (baseLayer) => set({ baseLayer }),

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
