import { type BlendMode } from '@/lib/compositeProtocol';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import { initialActiveStyle, patchActiveStyle } from '../mapStyleView';

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
    hillshadeEnabled: initialActiveStyle.hillshadeEnabled,
    setHillshadeEnabled: (hillshadeEnabled) => patchActiveStyle(set, { hillshadeEnabled }),

    hillshadeSource: initialActiveStyle.hillshadeSource,
    setHillshadeSource: (hillshadeSource) => patchActiveStyle(set, { hillshadeSource }),

    hillshadeBlend: initialActiveStyle.hillshadeBlend,
    setHillshadeBlend: (hillshadeBlend) => patchActiveStyle(set, { hillshadeBlend }),

    hillshadeIntensity: initialActiveStyle.hillshadeIntensity,
    setHillshadeIntensity: (hillshadeIntensity) => patchActiveStyle(set, { hillshadeIntensity }),

    terrainEnabled: initialActiveStyle.terrainEnabled,
    setTerrainEnabled: (terrainEnabled) => patchActiveStyle(set, { terrainEnabled }),

    contourLinesEnabled: initialActiveStyle.contourLinesEnabled,
    setContourLinesEnabled: (contourLinesEnabled) => patchActiveStyle(set, { contourLinesEnabled }),

    contourLinesOpacity: initialActiveStyle.contourLinesOpacity,
    setContourLinesOpacity: (contourLinesOpacity) => patchActiveStyle(set, { contourLinesOpacity }),

    terrainExaggeration: initialActiveStyle.terrainExaggeration,
    setTerrainExaggeration: (terrainExaggeration) => patchActiveStyle(set, { terrainExaggeration }),

    terrainDemSource: initialActiveStyle.terrainDemSource,
    setTerrainDemSource: (terrainDemSource) => patchActiveStyle(set, { terrainDemSource }),
});
