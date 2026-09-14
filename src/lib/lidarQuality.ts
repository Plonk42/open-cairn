/**
 * Capture quality: the single dial that stands in for the resolution / octree
 * depth / ground-density triplet.
 *
 * Those three settings are not independent, they are the same log2 axis.
 * PoissonRecon can only carry a feature larger than one octree cell
 * (`extent / 2^depth`), and a cloud can only describe a feature larger than its
 * point spacing (`1/sqrt(density)`). A capture is coherent when the two match;
 * from there, one resolution stop = one depth step = two ground-density steps.
 *
 * So the only quantity worth exposing is the octree cell itself, in metres: the
 * smallest relief the mesh can hold. Everything else derives from it.
 *
 * Measured against a 25-capture sweep (250 × 250 m, depth 8→12 × ground density
 * max→1/16): below the coherent depth the vertex count is independent of the
 * ground density (the octree is the limit, 212 103 vs 212 338 vertices at
 * depth 8 between max and 1/16), above it the count follows the points instead
 * (−61 % at depth 11) for no measurable detail gain.
 */

import {
    densityAt, estimateCapture, maxResolutionM, RESOLUTION_STOPS_M, resolutionToIndex,
} from './lidarResolution';

/** Allowed density stops, coarse → max. Shared by both density sliders. */
export const STRIDE_STOPS = [64, 32, 16, 8, 4, 2, 1] as const;

/** PoissonRecon octree depth range, as clamped by the capture pipeline. */
export const POISSON_DEPTH_MIN = 6;
export const POISSON_DEPTH_MAX = 12;

/** Quality steps offered at most; fewer when the zone runs out of depth range. */
export const QUALITY_TIER_COUNT = 4;

/** Above this estimate a tier stops being a reasonable default. */
export const COMFORT_SECONDS = 180;

/**
 * Cost coefficients fitted on the sweep above (one machine, one connection):
 * `t = points/30400 + vertices/23600` reproduces its 25 durations to ±4 %.
 * They are indicative — a capture record carrying its measured duration could
 * refit them per machine.
 */
const VERTICES_PER_POINT = 1.75;
const FETCH_POINTS_PER_S = 30_400;
const SOLVE_VERTICES_PER_S = 23_600;

/** Mean distance (m) between two points at a given ground sampling. */
export function spacingM(resolutionM: number): number {
    return 1 / Math.sqrt(densityAt(resolutionM));
}

/**
 * Side (m) of the solver's finest octree cell — the smallest relief the mesh
 * can hold. Mirrors `octreeCellM` in poissonBase, minus the Z extent, which is
 * only known once the cloud is decoded.
 */
export function octreeCellM(widthM: number, lengthM: number, depth: number): number {
    return Math.max(widthM, lengthM) / 2 ** depth;
}

function clampDepth(depth: number): number {
    return Math.min(POISSON_DEPTH_MAX, Math.max(POISSON_DEPTH_MIN, depth));
}

/** Snap a ratio to the nearest allowed stride stop, geometrically. */
function snapStride(ratio: number): number {
    if (ratio <= 1) return 1;
    const exp = Math.round(Math.log2(ratio));
    return Math.min(STRIDE_STOPS[0], 2 ** Math.max(0, exp));
}

/** Unrounded depth at which the octree cell matches the effective spacing. */
function coherentDepthExact(
    widthM: number, lengthM: number, resolutionM: number, groundStride: number,
): number {
    const effective = spacingM(resolutionM) * Math.sqrt(Math.max(1, groundStride));
    return Math.log2(Math.max(widthM, lengthM) / effective);
}

/** Octree depth whose cell matches the cloud's effective ground spacing. */
export function coherentDepth(
    widthM: number, lengthM: number, resolutionM: number, groundStride = 1,
): number {
    return clampDepth(Math.round(coherentDepthExact(widthM, lengthM, resolutionM, groundStride)));
}

/**
 * Ground thinning the octree cannot see at this depth: on a flat cell, points
 * closer together than one cell are redundant.
 */
export function coherentGroundStride(
    widthM: number, lengthM: number, resolutionM: number, depth: number,
): number {
    const cell = octreeCellM(widthM, lengthM, depth);
    return snapStride((cell / spacingM(resolutionM)) ** 2);
}

/** One step of the quality dial, with the settings and the cost it implies. */
export interface QualityTier {
    /** Octree cell (m): the headline figure, "relief of this size is visible". */
    detailM: number;
    resolutionM: number;
    depth: number;
    groundStride: number;
    points: number;
    bytes: number;
    vertices: number;
    seconds: number;
}

function tierAt(widthM: number, lengthM: number, depth: number, ceilingIdx: number): QualityTier {
    const detailM = octreeCellM(widthM, lengthM, depth);
    // Coarsest stop still sampling at least as finely as the cell: fetching
    // finer than the octree can carry is bandwidth spent on nothing.
    let idx = ceilingIdx;
    while (idx > 0 && spacingM(RESOLUTION_STOPS_M[idx - 1]) <= detailM) idx--;
    const resolutionM = RESOLUTION_STOPS_M[idx];
    // On a large zone even the coarsest stop oversamples: thin the ground instead.
    const groundStride = coherentGroundStride(widthM, lengthM, resolutionM, depth);
    const { points, bytes } = estimateCapture(widthM, lengthM, resolutionM);
    const vertices = (points * VERTICES_PER_POINT) / groundStride;
    return {
        detailM,
        resolutionM,
        depth,
        groundStride,
        points,
        bytes,
        vertices,
        seconds: points / FETCH_POINTS_PER_S + vertices / SOLVE_VERTICES_PER_S,
    };
}

/**
 * Quality steps for a zone, coarse → fine. The last one is the finest the IGN
 * pyramid and the download budget allow, so the dial runs out of travel on a
 * large zone instead of offering settings that buy nothing. The travel stops at
 * {@link maxResolutionM}, not at the auto resolution: the auto one sizes a
 * comfortable *default*, and capping the dial there left a large zone unable to
 * ask for the detail its data actually holds. The cost of each step is shown.
 */
export function qualityTiers(widthM: number, lengthM: number): QualityTier[] {
    const ceilingIdx = resolutionToIndex(maxResolutionM(widthM, lengthM));
    const finest = clampDepth(Math.round(
        coherentDepthExact(widthM, lengthM, RESOLUTION_STOPS_M[ceilingIdx], 1),
    ));
    const coarsest = Math.max(POISSON_DEPTH_MIN, finest - (QUALITY_TIER_COUNT - 1));
    const tiers: QualityTier[] = [];
    for (let depth = coarsest; depth <= finest; depth++) {
        tiers.push(tierAt(widthM, lengthM, depth, ceilingIdx));
    }
    return tiers;
}

/** Finest tier still under {@link COMFORT_SECONDS}, else the coarsest one. */
export function defaultQualityIndex(tiers: readonly QualityTier[]): number {
    for (let i = tiers.length - 1; i >= 0; i--) {
        if (tiers[i].seconds <= COMFORT_SECONDS) return i;
    }
    return 0;
}

/** Which tier a set of settings sits on, or -1 when it matches none. */
export function tierIndexOf(
    tiers: readonly QualityTier[], resolutionM: number, depth: number, groundStride: number,
): number {
    return tiers.findIndex((t) => t.depth === depth
        && t.resolutionM === resolutionM
        && t.groundStride === groundStride);
}

/** A setting pulling the capture away from the coherent point, with the fix. */
export type CaptureAdvice =
    | { kind: 'depthTooHigh'; suggested: number }
    | { kind: 'depthTooLow'; suggested: number }
    | { kind: 'groundTooSparse'; suggested: number }
    | { kind: 'groundTooDense'; suggested: number };

export interface CaptureSettings {
    widthM: number;
    lengthM: number;
    resolutionM: number;
    depth: number;
    groundStride: number;
}

function depthAdvice(s: CaptureSettings): CaptureAdvice | null {
    const exact = coherentDepthExact(s.widthM, s.lengthM, s.resolutionM, s.groundStride);
    const suggested = clampDepth(Math.round(exact));
    if (s.depth > exact + 0.5) return { kind: 'depthTooHigh', suggested };
    // One step below still reads every point; two is where half the download
    // stops reaching the mesh.
    if (s.depth < exact - 1.5) return { kind: 'depthTooLow', suggested };
    return null;
}

function groundAdvice(s: CaptureSettings): CaptureAdvice | null {
    const suggested = coherentGroundStride(s.widthM, s.lengthM, s.resolutionM, s.depth);
    // The decimation is curvature-adaptive, so it keeps relief at full density
    // one stop past the theoretical limit — only flag beyond that.
    if (s.groundStride > suggested * 2) return { kind: 'groundTooSparse', suggested };
    if (s.groundStride < suggested / 2) return { kind: 'groundTooDense', suggested };
    return null;
}

/** Every incoherence worth telling the user about, in reading order. */
export function captureAdvice(s: CaptureSettings): CaptureAdvice[] {
    return [depthAdvice(s), groundAdvice(s)].filter((a): a is CaptureAdvice => a !== null);
}

/** Read-out for a detail size: `24 cm`, `2,9 m`. */
export function formatDetail(metres: number): string {
    if (metres < 1) return `${Math.round(metres * 100)} cm`;
    return `${metres.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m`;
}

/** Read-out for a duration estimate: `45 s`, `2 min 10`. */
export function formatSeconds(seconds: number): string {
    const total = Math.round(seconds);
    if (total < 90) return `${total} s`;
    const min = Math.floor(total / 60);
    return `${min} min ${String(total % 60).padStart(2, '0')}`;
}
