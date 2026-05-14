import type { BaseLayerId } from '@/lib/mapStyle';
import { create } from 'zustand';

/** IGN LiDAR HD shadow product used as hillshade source. */
export type HillshadeSource = 'mns' | 'mnt' | 'mnh';

export const HILLSHADE_SOURCE_LABELS: Record<HillshadeSource, string> = {
    mns: 'MNS',
    mnt: 'MNT',
    mnh: 'MNH',
};

export interface MapView {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
}

interface MapState {
    view: MapView;
    setView: (view: Partial<MapView>) => void;

    baseLayer: BaseLayerId;
    setBaseLayer: (id: BaseLayerId) => void;

    /** Multiply-blended LiDAR HD hillshade overlay enabled. */
    hillshadeEnabled: boolean;
    setHillshadeEnabled: (v: boolean) => void;

    /** Which IGN LiDAR HD product is used as the shadow source. */
    hillshadeSource: HillshadeSource;
    setHillshadeSource: (v: HillshadeSource) => void;

    /** Strength of the multiply blend (0 = no effect, 1 = full multiply). */
    hillshadeIntensity: number;
    setHillshadeIntensity: (v: number) => void;

    /** 3D terrain on the base layer. */
    terrainEnabled: boolean;
    setTerrainEnabled: (v: boolean) => void;

    /** Vertical exaggeration of the 3D terrain. */
    terrainExaggeration: number;
    setTerrainExaggeration: (v: number) => void;
}

// Default view: French Alps, around the Vercors / Belledonne area, with a
// bit of pitch to immediately showcase the 3D terrain.
const DEFAULT_VIEW: MapView = {
    longitude: 5.7546,
    latitude: 45.2162,
    zoom: 11,
    pitch: 55,
    bearing: -20,
};

export const useMapStore = create<MapState>((set) => ({
    view: DEFAULT_VIEW,
    setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

    baseLayer: 'scan25',
    setBaseLayer: (baseLayer) => set({ baseLayer }),

    hillshadeEnabled: true,
    setHillshadeEnabled: (hillshadeEnabled) => set({ hillshadeEnabled }),

    hillshadeSource: 'mns',
    setHillshadeSource: (hillshadeSource) => set({ hillshadeSource }),

    hillshadeIntensity: 0.85,
    setHillshadeIntensity: (hillshadeIntensity) => set({ hillshadeIntensity }),

    terrainEnabled: true,
    setTerrainEnabled: (terrainEnabled) => set({ terrainEnabled }),

    terrainExaggeration: 1.2,
    setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),
}));
