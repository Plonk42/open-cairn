/**
 * Capture resolution: the ground sampling (metres between two points) asked of
 * the IGN COPC tiles, and the cost model derived from it.
 *
 * A COPC file is a level-of-detail pyramid: each level halves the point spacing
 * and carries ~4× the points of the previous one. Stopping the octree walk at a
 * level therefore divides the *download*, unlike the stride decimations which
 * thin a cloud already fetched and decoded in full.
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

/** Nominal LiDAR HD density (pt/m²) once every octree level is kept. */
const NATIVE_DENSITY_PT_M2 = 18;

/** points/m² × spacing², measured across the pyramid above (levels 1–3). A dense
 *  area reaches ~8.8 (3 km Belledonne capture), so the estimate is indicative. */
const LEVEL_DENSITY_COEF = 7;

/** Compressed LAZ bytes per point, measured on the same pyramid. */
const BYTES_PER_POINT = 6;

/** Downloaded-point budget a capture aims to stay under (auto resolution). */
export const CAPTURE_POINT_BUDGET = 6_000_000;

/** Point density (pt/m²) delivered by a given ground sampling. */
export function densityAt(resolutionM: number): number {
    if (resolutionM <= 0) return NATIVE_DENSITY_PT_M2;
    return Math.min(NATIVE_DENSITY_PT_M2, LEVEL_DENSITY_COEF / (resolutionM * resolutionM));
}

/** Points and compressed bytes a capture downloads, before any stride. */
export function estimateCapture(
    widthM: number, lengthM: number, resolutionM: number,
): { points: number; bytes: number } {
    const points = widthM * lengthM * densityAt(resolutionM);
    return { points, bytes: points * BYTES_PER_POINT };
}

/** Finest stop whose download stays within {@link CAPTURE_POINT_BUDGET}. */
export function autoResolutionM(widthM: number, lengthM: number): number {
    for (let i = RESOLUTION_STOPS_M.length - 1; i >= 0; i--) {
        const r = RESOLUTION_STOPS_M[i];
        if (estimateCapture(widthM, lengthM, r).points <= CAPTURE_POINT_BUDGET) return r;
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
