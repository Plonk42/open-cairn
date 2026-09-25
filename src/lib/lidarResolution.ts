/**
 * Capture resolution: the ground sampling (metres between two points) asked of
 * the IGN COPC tiles, and the cost model derived from it.
 *
 * A COPC file is a level-of-detail pyramid. The spec only guarantees that each
 * level halves the point spacing; how many points a level holds is decided by
 * the tiler, not by the format, and IGN documents neither. Measured, the first
 * level multiplies the points by ~10, the next ones by ~4, then less and less
 * as the pyramid saturates towards the native density. Stopping the octree walk
 * at a level divides the *download*, unlike the stride decimations which thin a
 * cloud already fetched and decoded in full.
 *
 * Measured on LHD_FXX_1007_6545 (1 km², 18.2 M pts, root spacing 6.8 m):
 *
 *   level ≤ | spacing | points cumulés | Mo cumulés
 *   0       | 6.8 m   |  61 k          |  0.7
 *   1       | 3.4 m   | 610 k          |  5.4
 *   2       | 1.7 m   | 2.3 M          | 17.6
 *   3       | 0.85 m  | 8.7 M          | 51.6
 *   4       | 0.43 m  | 18.2 M         | 97.0
 */

/**
 * Resolution stops (m between points), coarse → fine. 0 = native density.
 * These are the spacings the IGN pyramid actually delivers, one per level:
 * offering round numbers instead would promise a sampling no level provides,
 * and the estimate below would then be costing a capture that never happens.
 */
export const RESOLUTION_STOPS_M = [6.8, 3.4, 1.7, 0.85, 0.43, 0] as const;

/**
 * Nominal LiDAR HD density (pt/m²) once every octree level is kept: the level 4
 * of the table below times the median native/level-4 ratio of the six probes
 * documented there. A cumulative count cannot decrease, so this stop has to be
 * the densest one — it used to read 18 against 18.2 at the 0.43 m stop, making
 * `max` cost *more* than the stop under it.
 */
const NATIVE_DENSITY_PT_M2 = 20.4;

/**
 * Density (pt/m²) delivered by each stop, read off the pyramid above.
 *
 * A 1/spacing² law cannot describe this pyramid: it assumes a level quadruples
 * the points, where the measured levels *decuple* them near the root (61 k →
 * 610 k) before saturating towards the native density. Fitted on the fine
 * levels, such a law overestimates the root level by 2.5× — and a large zone is
 * forced onto exactly that level, so the quality dial was promising a spacing
 * the data does not carry.
 *
 * Densities vary a lot by tile — the same probe run on six tiles (cumulative
 * pt/m² for levels 0..4, then native):
 *
 *   Vercors  0903_6438 | 0.054 0.64 2.57  8.22 24.4 | 27.5
 *   Chartreuse 0921_6471 | 0.085 1.26 5.20 14.7  29.8 | 33.6
 *   Chamonix 0999_6543 | 0.057 0.76 3.25 10.7  26.6 | 46.5
 *   Camargue 0817_6268 | 0.017 0.15 0.56  2.20  8.89 |  9.6
 *   La Meije 0960_6439 | 0.037 0.37 1.46  5.40 22.4 | 25.0
 *   Paris    0652_6862 | 0.062 0.63 2.24  6.15 15.3 | 15.5
 *
 * Level 3 alone spans 2.2 → 14.7 pt/m², and two adjacent Vercors tiles differ
 * by 1.8×. IGN only specifies a floor (≥10 pulses/m², ≥5 above 3200 m), and a
 * pulse yields several points, so no constant can be right everywhere. This
 * table is a median, not a guarantee — the exact counts are readable per tile
 * in the COPC hierarchy (`pointCount` per node), which extract.ts already walks.
 */
const DENSITY_AT_STOP_PT_M2 = [0.061, 0.61, 2.3, 8.7, 18.2, NATIVE_DENSITY_PT_M2] as const;

/**
 * Cumulative density (pt/m²) at each {@link RESOLUTION_STOPS_M} entry — what a
 * capture at that stop actually downloads per m². `measureCapturePyramid`
 * returns the real one for a given zone; the table above stands in until it
 * lands.
 */
export type PyramidProfile = readonly number[];

/** The table above: used for a zone whose tiles have not been probed yet. */
export const ESTIMATED_PYRAMID: PyramidProfile = DENSITY_AT_STOP_PT_M2;

/** LiDAR HD tiles are 1 km squares, each its own COPC cube: level ℓ nodes are 1000/2^ℓ m wide. */
const TILE_SIDE_M = 1000;

/**
 * Compressed LAZ bytes per point of the level each stop adds (the native stop:
 * every level past 4), medians of `tools/lidar-density/capture-bytes.mjs` on
 * six zones (Chartreuse, Vercors, Mont-Blanc, Camargue, La Meije). Sparse levels
 * compress worse; level 4 alone spans 3.7 → 6.0.
 */
const BYTES_PER_POINT_AT_STOP = [11, 8.6, 7.5, 6.4, 4.8, 5.2] as const;

/**
 * `|cos θ| + |sin θ|` averaged over every bearing: how much wider than its own
 * sides a rotated rectangle reads on the tile grid. Averaged so that turning
 * the zone does not move the quality steps.
 */
const MEAN_BEARING_SPREAD = 4 / Math.PI;

/**
 * Compressed bytes the pipeline fetches: a node is downloaded whole as soon as
 * it meets the zone, so each level costs the expected area of the grid cells
 * the rectangle touches, `A + s·(wₓ + wᵧ) + s²` for cells of side `s`. On a
 * 250 m zone that is 1.7 km² at level 0 — twenty-seven times its own area.
 */
function downloadedBytes(
    widthM: number, lengthM: number, stopIdx: number, pyramid: PyramidProfile,
): number {
    const spread = (widthM + lengthM) * MEAN_BEARING_SPREAD;
    let bytes = 0;
    for (let i = 0; i <= stopIdx; i++) {
        const levelDensity = pyramid[i] - (i > 0 ? pyramid[i - 1] : 0);
        const side = TILE_SIDE_M / 2 ** i;
        const touchedM2 = widthM * lengthM + side * spread + side * side;
        bytes += levelDensity * touchedM2 * BYTES_PER_POINT_AT_STOP[i];
    }
    return bytes;
}

/** Budget of points kept inside the zone a capture aims to stay under (auto resolution). */
export const CAPTURE_POINT_BUDGET = 6_000_000;

/**
 * Hard ceiling the quality dial will not offer past, even though the user is
 * shown the cost and could accept it: beyond this the decode + normals + solve
 * chain stops being interactive.
 */
export const CAPTURE_POINT_CEILING = 20_000_000;

/** Point density (pt/m²) delivered by a given ground sampling. */
export function densityAt(resolutionM: number, pyramid: PyramidProfile = ESTIMATED_PYRAMID): number {
    return pyramid[resolutionToIndex(resolutionM)];
}

/**
 * Points a capture keeps inside the zone, before any stride, and the
 * compressed bytes it downloads to get them.
 */
export function estimateCapture(
    widthM: number, lengthM: number, resolutionM: number,
    pyramid: PyramidProfile = ESTIMATED_PYRAMID,
): { points: number; bytes: number } {
    const points = widthM * lengthM * densityAt(resolutionM, pyramid);
    const bytes = downloadedBytes(widthM, lengthM, resolutionToIndex(resolutionM), pyramid);
    return { points, bytes };
}

/** Finest stop whose download stays within {@link CAPTURE_POINT_BUDGET}. */
export function autoResolutionM(
    widthM: number, lengthM: number, pyramid: PyramidProfile = ESTIMATED_PYRAMID,
): number {
    return finestStopUnder(widthM, lengthM, CAPTURE_POINT_BUDGET, pyramid);
}

/** Finest stop the quality dial may offer; see {@link CAPTURE_POINT_CEILING}. */
export function maxResolutionM(
    widthM: number, lengthM: number, pyramid: PyramidProfile = ESTIMATED_PYRAMID,
): number {
    return finestStopUnder(widthM, lengthM, CAPTURE_POINT_CEILING, pyramid);
}

function finestStopUnder(
    widthM: number, lengthM: number, budget: number, pyramid: PyramidProfile,
): number {
    for (let i = RESOLUTION_STOPS_M.length - 1; i >= 0; i--) {
        const r = RESOLUTION_STOPS_M[i];
        if (estimateCapture(widthM, lengthM, r, pyramid).points <= budget) return r;
    }
    return RESOLUTION_STOPS_M[0];
}

/**
 * Deepest COPC level to keep for a target spacing, given the file's root-level
 * spacing. Levels halve the spacing, so this is how many halvings separate the
 * root from the request — rounded up, so the data is never coarser than asked.
 * The tolerance absorbs the rounding of a stop against the tile's exact
 * spacing, which would otherwise cost a whole extra level. `Infinity` for the
 * native density (keep every level).
 */
export function copcMaxLevel(rootSpacingM: number, resolutionM: number): number {
    if (resolutionM <= 0 || rootSpacingM <= 0) return Infinity;
    return Math.max(0, Math.ceil(Math.log2(rootSpacingM / resolutionM) - 0.05));
}

/** Slider read-out: `1,7 m`, or `max` for the native density. */
export function formatResolution(resolutionM: number): string {
    if (resolutionM <= 0) return 'max';
    return `${resolutionM.toLocaleString('fr-FR')} m`;
}

/** Snap a resolution to the index of the nearest allowed stop. */
export function resolutionToIndex(resolutionM: number): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < RESOLUTION_STOPS_M.length; i++) {
        const d = Math.abs(RESOLUTION_STOPS_M[i] - resolutionM);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
}
