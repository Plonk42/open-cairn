import type { BlendMode } from '@/lib/compositeProtocol';
import type { BaseLayerId } from '@/lib/mapStyle';
import type maplibregl from 'maplibre-gl';
import { create } from 'zustand';

/** IGN LiDAR HD shadow product used as hillshade source. */
export type HillshadeSource = 'mns' | 'mnt' | 'mnh';

export const HILLSHADE_SOURCE_LABELS: Record<HillshadeSource, string> = {
    mns: 'MNS',
    mnt: 'MNT',
    mnh: 'MNH',
};

export type RenderQuality = 'balanced' | 'sharp';

export const RENDER_QUALITY_LABELS: Record<RenderQuality, string> = {
    balanced: 'Fluide',
    sharp: 'Net',
};

export type UiTheme = 'light' | 'dark';

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

    /** Blend mode used when compositing the shadow onto the base. */
    hillshadeBlend: BlendMode;
    setHillshadeBlend: (v: BlendMode) => void;

    /** Strength of the multiply blend (0 = no effect, 1 = full multiply). */
    hillshadeIntensity: number;
    setHillshadeIntensity: (v: number) => void;

    /** 3D terrain on the base layer. */
    terrainEnabled: boolean;
    setTerrainEnabled: (v: boolean) => void;

    /** Contour lines overlay. */
    contourLinesEnabled: boolean;
    setContourLinesEnabled: (v: boolean) => void;

    /** Opacity of the contour lines overlay (0..1). */
    contourLinesOpacity: number;
    setContourLinesOpacity: (v: number) => void;

    /** Vertical exaggeration of the 3D terrain. */
    terrainExaggeration: number;
    setTerrainExaggeration: (v: number) => void;

    /** Raster and canvas quality used for pitched 3D views. */
    renderQuality: RenderQuality;
    setRenderQuality: (v: RenderQuality) => void;

    /** Light or dark UI theme. */
    uiTheme: UiTheme;
    setUiTheme: (v: UiTheme) => void;

    /** Map instance reference for imperative operations. */
    mapInstance: maplibregl.Map | null;
    setMapInstance: (map: maplibregl.Map | null) => void;
    /** Fly the map to fit a bounding box [minLng, minLat, maxLng, maxLat]. */
    fitBounds: (bounds: [number, number, number, number], options?: { padding?: number }) => void;
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

export const useMapStore = create<MapState>((set, get) => ({
    view: DEFAULT_VIEW,
    setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

    baseLayer: 'scan25',
    setBaseLayer: (baseLayer) => set({ baseLayer }),

    hillshadeEnabled: true,
    setHillshadeEnabled: (hillshadeEnabled) => set({ hillshadeEnabled }),

    hillshadeSource: 'mns',
    setHillshadeSource: (hillshadeSource) => set({ hillshadeSource }),

    hillshadeBlend: 'lidar-neutral',
    setHillshadeBlend: (hillshadeBlend) => set({ hillshadeBlend }),

    hillshadeIntensity: 0.85,
    setHillshadeIntensity: (hillshadeIntensity) => set({ hillshadeIntensity }),

    terrainEnabled: true,
    setTerrainEnabled: (terrainEnabled) => set({ terrainEnabled }),

    contourLinesEnabled: false,
    setContourLinesEnabled: (contourLinesEnabled) => set({ contourLinesEnabled }),

    contourLinesOpacity: 0.4,
    setContourLinesOpacity: (contourLinesOpacity) => set({ contourLinesOpacity }),

    terrainExaggeration: 1.2,
    setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),

    renderQuality: 'balanced',
    setRenderQuality: (renderQuality) => set({ renderQuality }),

    uiTheme: 'light',
    setUiTheme: (uiTheme) => set({ uiTheme }),

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

}));
