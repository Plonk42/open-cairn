/**
 * Type definitions and helpers for LiDAR HD point cloud data.
 * All fetching is done via the browser-only pipeline in `@/lib/lidarBrowser`.
 */

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
     * Height above the local terrain (metres), per point. Built from a coarse
     * min-Z ground field (class 2/9). Drives vegetation height coloring.
     * Undefined when no ground points were available to anchor the field.
     */
    heightAboveGround?: Float32Array;
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

/** ASPRS vegetation classes (low / medium / high). */
export function isVegetationClass(c: number): boolean {
    return c === 3 || c === 4 || c === 5;
}

/**
 * Height-driven foliage ramp (metres above ground → RGB). Anchors a brown
 * trunk/litter tone near the ground, ramps through deep shadowed green, a vivid
 * mid-canopy, and sunlit yellow-green at the tips. Linear-interpolated between
 * stops so the gradient reads continuously up a tree.
 */
const VEG_RAMP: ReadonlyArray<{ h: number; c: [number, number, number] }> = [
    { h: 0, c: [82, 64, 44] },     // trunk / litter — brown
    { h: 1.5, c: [60, 104, 50] },  // understorey — deep shaded green
    { h: 6, c: [96, 158, 66] },    // mid canopy — vivid foliage
    { h: 15, c: [170, 200, 116] }, // canopy tips — sunlit yellow-green
];

/** Reference height (m) the ramp was authored for — its last stop. */
const VEG_RAMP_TOP = VEG_RAMP.at(-1)!.h;

/**
 * Sample the foliage ramp at `h` metres above ground. `scale` stretches the
 * ramp's height axis so its top tone is reached at `scale` metres instead of
 * the authored {@link VEG_RAMP_TOP}: a larger scale spreads the gradient over
 * taller canopies (less uniform aplat), a smaller one compresses it.
 */
function vegRamp(h: number, scale: number): [number, number, number] {
    const hh = h * (VEG_RAMP_TOP / Math.max(1, scale));
    const first = VEG_RAMP[0];
    const last = VEG_RAMP.at(-1)!;
    if (hh <= first.h) return first.c;
    if (hh >= last.h) return last.c;
    for (let i = 1; i < VEG_RAMP.length; i++) {
        const a = VEG_RAMP[i - 1];
        const b = VEG_RAMP[i];
        if (hh <= b.h) {
            const t = (hh - a.h) / (b.h - a.h);
            return [
                a.c[0] + (b.c[0] - a.c[0]) * t,
                a.c[1] + (b.c[1] - a.c[1]) * t,
                a.c[2] + (b.c[2] - a.c[2]) * t,
            ];
        }
    }
    return last.c;
}

/** Vegetation colouring strategy: natural foliage tones, or a height colormap. */
export type VegColorMode = 'natural' | 'height';

/**
 * Viridis colormap (matplotlib / CloudCompare / QGIS), sampled at 11 stops.
 * Perceptually uniform purple → blue → teal → green → yellow ramp — the look
 * IGN uses on its LiDAR HD canopy visualisations.
 */
const VIRIDIS: ReadonlyArray<[number, number, number]> = [
    [68, 1, 84], [72, 33, 115], [64, 67, 135], [52, 94, 141], [41, 120, 142],
    [32, 144, 140], [34, 167, 132], [68, 190, 112], [121, 209, 81], [189, 222, 38], [253, 231, 37],
];

/** Sample the viridis colormap at the normalised position `t` ∈ [0, 1]. */
function viridis(t: number): [number, number, number] {
    const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
    const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
    const f = x - i;
    const a = VIRIDIS[i];
    const b = VIRIDIS[i + 1];
    return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
    ];
}

/** Pure palette colour for a height (m above ground), `scale` mapping to the top. */
function vegPalette(mode: VegColorMode, height: number, scale: number): [number, number, number] {
    const h = Number.isFinite(height) ? height : VEG_RAMP_TOP;
    if (mode === 'height') return viridis(h / Math.max(1, scale));
    return vegRamp(h, scale);
}

/**
 * Colour a vegetation point from its height above ground. The two modes share
 * the exact same controls — only the palette differs (natural trunk→canopy
 * green ramp, or the viridis height colormap). `scale` sets the height mapped to
 * the top of the palette; `strength` blends the palette toward the flat class
 * colour `base` (0 = flat class colour, 1 = full palette).
 */
export function vegetationColor(
    mode: VegColorMode,
    height: number,
    base: [number, number, number],
    strength: number,
    scale: number,
): [number, number, number] {
    const ramp = vegPalette(mode, height, scale);
    const s = Math.max(0, Math.min(1, strength));
    return [
        Math.round(base[0] + (ramp[0] - base[0]) * s),
        Math.round(base[1] + (ramp[1] - base[1]) * s),
        Math.round(base[2] + (ramp[2] - base[2]) * s),
    ];
}
