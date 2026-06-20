import { type BlendMode } from '@/lib/compositeProtocol';
import type { StateCreator } from 'zustand';
import { persisted } from '../persistence';
import type { MapState } from '../mapStore';

/** IGN LiDAR HD shadow product used as hillshade source. */
export type HillshadeSource = 'mns' | 'mnt' | 'mnh';

export const HILLSHADE_SOURCE_LABELS: Record<HillshadeSource, string> = {
    mns: 'MNS',
    mnt: 'MNT',
    mnh: 'MNH',
};

/**
 * DEM provider used for the 3D terrain mesh and dynamic sun hillshade.
 * `auto` uses IGN when a DEM API key is set, otherwise falls back to Mapterhorn.
 */
export type TerrainDemSource = 'auto' | 'ign' | 'mapterhorn';

export const TERRAIN_DEM_SOURCE_LABELS: Record<TerrainDemSource, string> = {
    auto: 'Auto',
    ign: 'IGN',
    mapterhorn: 'Mapterhorn',
};

export interface TerrainSlice {
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

    /**
     * Dynamic, sun-driven hillshade on the terrain DEM. Unlike the pre-baked
     * LiDAR HD shadow raster, this MapLibre hillshade layer follows the sun
     * date/time selected in the LiDAR panel (azimuth + altitude + warm tint).
     */
    sunHillshadeEnabled: boolean;
    setSunHillshadeEnabled: (v: boolean) => void;

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

    /** DEM provider for the 3D terrain mesh (auto = IGN with key, else Mapterhorn). */
    terrainDemSource: TerrainDemSource;
    setTerrainDemSource: (v: TerrainDemSource) => void;
}

export const createTerrainSlice: StateCreator<MapState, [], [], TerrainSlice> = (set) => ({
    hillshadeEnabled: persisted.hillshadeEnabled ?? true,
    setHillshadeEnabled: (hillshadeEnabled) => set({ hillshadeEnabled }),

    hillshadeSource: persisted.hillshadeSource ?? 'mns',
    setHillshadeSource: (hillshadeSource) => set({ hillshadeSource }),

    hillshadeBlend: persisted.hillshadeBlend ?? 'lidar-neutral',
    setHillshadeBlend: (hillshadeBlend) => set({ hillshadeBlend }),

    sunHillshadeEnabled: persisted.sunHillshadeEnabled ?? false,
    setSunHillshadeEnabled: (sunHillshadeEnabled) => set({ sunHillshadeEnabled }),

    hillshadeIntensity: persisted.hillshadeIntensity ?? 0.85,
    setHillshadeIntensity: (hillshadeIntensity) => set({ hillshadeIntensity }),

    terrainEnabled: persisted.terrainEnabled ?? true,
    setTerrainEnabled: (terrainEnabled) => set({ terrainEnabled }),

    contourLinesEnabled: persisted.contourLinesEnabled ?? false,
    setContourLinesEnabled: (contourLinesEnabled) => set({ contourLinesEnabled }),

    contourLinesOpacity: persisted.contourLinesOpacity ?? 0.4,
    setContourLinesOpacity: (contourLinesOpacity) => set({ contourLinesOpacity }),

    terrainExaggeration: persisted.terrainExaggeration ?? 1,
    setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),

    terrainDemSource: persisted.terrainDemSource ?? 'auto',
    setTerrainDemSource: (terrainDemSource) => set({ terrainDemSource }),
});
