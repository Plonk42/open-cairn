/**
 * Type definitions and helpers for LiDAR HD point cloud data.
 * All fetching is done via the browser-only pipeline in `@/lib/lidarBrowser`.
 */

import type { ForestRaster } from './lidarBrowser/bdforet';
import type { VegGroundGrid } from './lidarBrowser/groundHeight';

export interface LidarCloudData {
    /** WGS84 longitude of the request center (origin for `positions`). */
    centerLng: number;
    /** WGS84 latitude of the request center. */
    centerLat: number;
    /**
     * Interleaved (dx_east_m, dy_north_m, alt_m) Float32, length = 3 * pointCount.
     * Compatible with deck.gl `COORDINATE_SYSTEM.METER_OFFSETS`.
     */
    positions: Float32Array;
    /** ASPRS LAS classification per point. */
    classifications: Uint8Array;
    pointCount: number;
    /** Radius used for the request, meters. */
    radius: number;
}

export interface LidarMeshData {
    kind: 'mesh';
    centerLng: number;
    centerLat: number;
    /** Interleaved (dx_east_m, dy_north_m, alt_m) Float32, length = 3 * vertexCount. */
    positions: Float32Array;
    /** Interleaved (nx, ny, nz) Float32, length = 3 * vertexCount. */
    normals: Float32Array;
    /** RGBA Uint8, length = 4 * vertexCount. */
    colors: Uint8Array;
    /** Triangle vertex indices, length = 3 * triangleCount. */
    indices: Uint32Array;
    /**
     * Per-vertex roughness in [0,1] derived from face-normal coherence.
     * Only present for Poisson meshes; undefined for Delaunay (Mixed mode).
     */
    roughness?: Float32Array;
    /**
     * Per-vertex flag (`1` = synthetic base wall) marking the plinth sides so
     * the renderer can hatch them. Only present for Poisson meshes built with a
     * flat base; undefined for Delaunay (Mixed mode) and legacy scenes.
     */
    baseMask?: Uint8Array;
    vertexCount: number;
    triangleCount: number;
    radius: number;
}

export interface LidarShadedCloudData {
    kind: 'shaded';
    centerLng: number;
    centerLat: number;
    /** Interleaved (dx_east_m, dy_north_m, alt_m) Float32. */
    positions: Float32Array;
    /** Interleaved (nx, ny, nz) Float32 per point. */
    normals: Float32Array;
    /** RGBA Uint8 per point (slope-based palette). */
    colors: Uint8Array;
    /** ASPRS LAS classification per point. */
    classifications: Uint8Array;
    /**
     * Height above the local terrain (metres), per point. In mesh modes
     * (Delaunay/Poisson) it is sampled from the reconstructed ground surface
     * directly beneath each point (cliff-correct); in pure-shaded mode from a
     * coarse min-Z ground field (class 2/9). Drives vegetation height coloring.
     * Undefined when no ground was available to anchor the height.
     */
    heightAboveGround?: Float32Array;
    /**
     * Robust tallest-tree height (m) — the 99th percentile of the vegetation
     * heights, with cliff-edge artefacts already clamped out. Drives the
     * automatic foliage colour scale. Undefined when no vegetation was measured.
     */
    vegHeightAuto?: number;
    /**
     * Per-point vegetation height-decision diagnostics (4 bytes / point, see
     * VEG_DIAG_STRIDE in groundHeight.ts): blend weight (pente↔falaise), stacked
     * cluster id, decision flags and local ground relief. Drives the
     * « Analyse hauteur » false-colour render modes. Undefined for restored
     * scenes captured before the diagnostics existed (the GPU uploads zeros).
     */
    vegDiag?: Uint8Array;
    /**
     * IGN BD Forêt® v2 category per point (index into FOREST_CATEGORIES), or
     * 255 for non-vegetation / outside any forest stand. Drives species-accurate
     * vegetation coloring. Undefined when the BD Forêt query failed.
     */
    forestTfv?: Uint8Array;
    /**
     * Coarse BD Forêt category raster covering the capture (one category id per
     * cell). Kept so the per-point `forestTfv` labelling — and its boundary
     * edge-blend (sharp / feather / scatter) — can be recomputed live without a
     * re-fetch. Undefined when the BD Forêt query failed or returned no stands.
     */
    forestRaster?: ForestRaster;
    /**
     * Coarse bare-earth reference (min-Z ground field + local relief) used by
     * the hybrid vegetation-height metric to recover spreading broadleaf crowns
     * over flat ground while staying cliff-correct. Cached so the height can be
     * re-blended live when the gap/relief sliders move without a re-fetch.
     * Undefined when no ground was available (e.g. restored saved scenes).
     */
    vegGroundGrid?: VegGroundGrid;
    /**
     * Per-tree seed (0–254, 255 = none) from CHM treetop detection. Lets the GPU
     * pick one species per tree inside a mixed stand. Undefined when no
     * height-above-ground field was available to detect treetops.
     */
    treeSeed?: Uint8Array;
    pointCount: number;
    radius: number;
}

/**
 * Combined output for the "mixed" mode: ground (class 2) is reconstructed
 * as a Delaunay mesh, every other point is kept as a shaded cloud so the
 * user can toggle vegetation/buildings on/off via the existing class mask.
 */
export interface LidarMixedData {
    kind: 'mixed';
    centerLng: number;
    centerLat: number;
    radius: number;
    /** Ground-only triangulated surface. */
    mesh: LidarMeshData;
    /** All non-ground points with normals + colors, GPU-class-filterable. */
    shaded: LidarShadedCloudData;
}

/**
 * ASPRS LAS classification → RGB color lookup used to paint the point cloud.
 * Matches the conventions of the IGN LiDAR HD viewer.
 */
export const LAS_CLASS_COLORS: Record<number, [number, number, number]> = {
    0: [200, 200, 200],   // Created, never classified
    1: [200, 200, 200],   // Unclassified
    2: [120, 86, 56],     // Ground (sol) — brown
    3: [188, 220, 140],   // Low vegetation
    4: [128, 188, 100],   // Medium vegetation
    5: [60, 128, 60],     // High vegetation
    6: [200, 120, 110],   // Building
    7: [255, 80, 80],     // Low point (noise)
    9: [70, 140, 220],    // Water
    11: [120, 120, 120],  // Road surface
    17: [220, 160, 80],   // Bridge deck
    64: [180, 160, 200],  // Permanent above-ground (sursol pérenne)
    65: [255, 220, 120],  // Virtual point
    66: [220, 100, 200],  // Misc building (divers bâti)
};

export const LAS_CLASS_LABELS: Record<number, string> = {
    1: 'Non classé',
    2: 'Sol',
    3: 'Végét. basse',
    4: 'Végét. moyenne',
    5: 'Végét. haute',
    6: 'Bâtiment',
    9: 'Eau',
    17: 'Tablier de pont',
    64: 'Sursol pérenne',
    66: 'Divers bâti',
};

const DEFAULT_COLOR: [number, number, number] = [220, 220, 220];

export function colorForClass(c: number): [number, number, number] {
    return LAS_CLASS_COLORS[c] ?? DEFAULT_COLOR;
}

/**
 * Vegetation colouring strategy: natural foliage tones, a height colormap, or
 * real species from IGN BD Forêt® v2. The actual ramp/colormap and palette
 * blending now run on the GPU (vertex shader in lidar-gl/shaders.ts) so the
 * foliage sliders are instantaneous — this type is the only thing the rest of
 * the app still needs from here.
 */
export type VegColorMode = 'natural' | 'height' | 'species';
