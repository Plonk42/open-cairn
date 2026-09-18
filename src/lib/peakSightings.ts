// ─────────────────────────────────────────────────────────────────────────────
// Which named summits are actually SEEN from a standpoint, and where their
// labels go on screen.
//
// Two independent halves, both pure so both can be tested without a map:
//
//   1. the sighting — azimuth, distance, apparent height, and the ray march
//      that decides whether a nearer ridge stands in the way (`skyline.ts`);
//   2. the layout — a screen-space pass that keeps a dense ridge legible.
//
// The layout rule comes from the shape of the label: the text runs at
// {@link LABEL_ANGLE_DEG} from the horizontal, so two labels are parallel
// strips. Parallel strips never touch as long as they are far enough apart
// ACROSS that direction, whatever their lengths. That is why nothing here
// measures text: the room a name needs does not depend on how long it is.
//
// Measuring that gap on the horizontal axis alone — which is what this did
// first — is only right when two names sit at the same height. It is not:
// seen from Chamechaude, a name 19 px to the right and 30 px HIGHER is 0.2 px
// away from the previous one across the strips, i.e. printed on top of it. The
// separation is measured on the strips' own normal now, which also stops the
// pass from shoving apart two names that are vertically far away anyway.
// ─────────────────────────────────────────────────────────────────────────────

import type { Peak } from '@/lib/peaks';
import {
    apparentAngleDeg,
    ridgeAngleBefore,
    sightingFrom,
    type GroundSampler,
    type SkylineObserver,
} from '@/lib/skyline';

const DEG = Math.PI / 180;

/**
 * How far each IGN notoriety rank is worth labelling, in metres.
 *
 * A rank-4 summit is a local point named for the hamlet below it: at 30 km it
 * is a bump nobody can check. A rank-1 is a name everyone in the valley knows.
 * Indexed by `importance`, so slot 0 is unused.
 */
const REACH_BY_IMPORTANCE_M = [0, 60_000, 60_000, 25_000, 8_000];

/**
 * Ceiling on the number of rays marched. Each is ~0.6 ms of DEM lookups and
 * they are all paid in one go when the eye lands, so this is the hitch budget.
 */
const MAX_MARCHED = 220;

/**
 * The march stops this fraction short of the summit. Without it the DEM sample
 * taken one step before the top — on the summit's own slope, and barely lower —
 * would be counted as an occluder and hide every peak in the panorama.
 */
const SELF_CLEARANCE = 0.985;

/** Under a summit's own apparent size, a "clearance" is DEM noise, not a view. */
const CLEARANCE_TOLERANCE_DEG = 0.02;

/** A summit whose DEM reads at sea level is outside the loaded terrain. */
const MIN_GROUND_M = 1;

/**
 * How far the ground may stand above a surveyed height before that height is
 * taken to describe some other point.
 *
 * A cote is an exact measurement; what goes wrong is what it is attached to.
 * BD CARTO® hangs the 2596 m of the *Petite* Lance de Domène — which it does not
 * itself contain — on the identifier of the Grande Lance, whose own ground the
 * DEM reads 168 m higher.
 *
 * The margin is wide because a DEM can genuinely read high: névé standing on the
 * rock when the survey was flown, or a mast the bare-earth filter left behind on
 * a narrow top. Measured over the Chartreuse, the ground stands above the cote by
 * 155, 23, 23 and 20 m on four summits, then by 10 and 9.7 m on two where that
 * explanation is credible, then by no more than 1.7 m. Cutting at 15 m keeps
 * only what no DEM error accounts for.
 */
const MAX_SURVEY_UNDERSHOOT_M = 15;

export interface PeakSighting {
    peak: Peak;
    distanceM: number;
    /** Unit ENU direction towards the summit (x=east, y=north, z=up). */
    dir: [number, number, number];
}

interface Candidate {
    peak: Peak;
    distanceM: number;
    azimuthDeg: number;
}

/**
 * Thin the raw summit list down to what is worth a ray: near enough for its
 * rank, and inside the marching budget. Sorted by rank first so the budget is
 * spent on the names that carry the panorama.
 */
export function selectCandidates(observer: SkylineObserver, peaks: readonly Peak[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const peak of peaks) {
        const reach = REACH_BY_IMPORTANCE_M[peak.importance] ?? 0;
        if (reach === 0) continue;
        const { azimuthDeg, distanceM } = sightingFrom(observer, peak.lng, peak.lat);
        if (distanceM > reach || distanceM < 1) continue;
        candidates.push({ peak, distanceM, azimuthDeg });
    }
    candidates.sort((a, b) => a.peak.importance - b.peak.importance || a.distanceM - b.distanceM);
    return candidates.slice(0, MAX_MARCHED);
}

/**
 * Keep the summits that stand clear of everything between them and the eye.
 *
 * Each gets its OWN ray, at its exact azimuth: bucketing azimuths the way the
 * sun labels do would be 130 m off course at 30 km, enough to march up the
 * wrong gully and call a summit hidden.
 *
 * The whole test runs in DEM space, the summit included, even when BD CARTO®
 * publishes a surveyed height for it: comparing a surveyed top against a DEM
 * ridge would tilt every verdict by the few metres that separate the two
 * models. The surveyed height is only printed — and only after the terrain
 * under it has failed to contradict it.
 */
export function sightPeaks(
    observer: SkylineObserver,
    peaks: readonly Peak[],
    sample: GroundSampler,
): PeakSighting[] {
    const out: PeakSighting[] = [];
    for (const { peak, distanceM, azimuthDeg } of selectCandidates(observer, peaks)) {
        const groundM = sample(peak.lng, peak.lat);
        if (!Number.isFinite(groundM) || groundM < MIN_GROUND_M) continue;
        const elevationDeg = apparentAngleDeg(observer.altitudeM, groundM, distanceM);
        const ridgeDeg = ridgeAngleBefore(observer, azimuthDeg, distanceM * SELF_CLEARANCE, sample);
        if (elevationDeg < ridgeDeg + CLEARANCE_TOLERANCE_DEG) continue;
        const az = azimuthDeg * DEG;
        const el = elevationDeg * DEG;
        const ce = Math.cos(el);
        out.push({
            peak: withCheckedSpotHeight(peak, groundM),
            distanceM,
            dir: [ce * Math.sin(az), ce * Math.cos(az), Math.sin(el)],
        });
    }
    return out;
}

/** Drop a surveyed height the terrain under it says cannot be right. */
function withCheckedSpotHeight(peak: Peak, groundM: number): Peak {
    if (peak.spotHeightM === null) return peak;
    if (groundM <= peak.spotHeightM + MAX_SURVEY_UNDERSHOOT_M) return peak;
    return { ...peak, spotHeightM: null };
}

// ── Screen-space layout ──────────────────────────────────────────────────────

/** Degrees the text is rotated by, counter-clockwise on screen. */
export const LABEL_ANGLE_DEG = -58;

/** Rise from the summit to where its name starts. */
const LEADER_PX = 18;

/**
 * Unit normal to a label's own direction, pointing right and down. Projecting
 * an anchor on it gives the strip's signed offset from the origin: two labels
 * whose offsets differ by less than a line box are printed on top of one
 * another, however far apart they are on screen otherwise.
 */
const LANE_NX = Math.sin(-LABEL_ANGLE_DEG * DEG);
const LANE_NY = Math.cos(-LABEL_ANGLE_DEG * DEG);

/**
 * Room one name needs ACROSS its own direction: the 12 px line box widened by
 * the 3.5 px halo the overlay paints under the glyphs. At equal height that is
 * the 19 px of horizontal room measured on the Drus / Aiguille Verte pair seen
 * from the Brévent, which touched at 15 px — the old rule was this one, read on
 * the only axis where the two agree.
 */
const MIN_LANE_GAP_PX = 16;

/**
 * How far a name may be pushed off its summit before the leader line stops
 * being readable. Past it the name is dropped rather than moved: a line that
 * crosses three other summits to reach its own is worse than no label.
 */
const MAX_SHIFT_PX = 46;

export interface PeakLabelSlot {
    key: string;
    /** Where the summit itself projects, in CSS pixels. */
    x: number;
    y: number;
}

export interface PlacedPeakLabel {
    key: string;
    tipX: number;
    tipY: number;
    anchorX: number;
    anchorY: number;
}

/**
 * Spread the names of a crowded ridge rightwards so no two strips overlap, and
 * drop the ones that no longer fit. Input order is irrelevant: the pass sorts
 * by the only quantity an overlap depends on, the offset across the strips.
 */
export function layoutPeakLabels(slots: readonly PeakLabelSlot[]): PlacedPeakLabel[] {
    const anchored = slots.map((slot) => {
        const anchorY = slot.y - LEADER_PX;
        return { slot, anchorY, lane: slot.x * LANE_NX + anchorY * LANE_NY };
    });
    anchored.sort((a, b) => a.lane - b.lane);
    const placed: PlacedPeakLabel[] = [];
    let previousLane = Number.NEGATIVE_INFINITY;
    for (const { slot, anchorY, lane } of anchored) {
        // Pushing an anchor one pixel right moves it `LANE_NX` across the strips.
        const shiftPx = Math.max(0, (previousLane + MIN_LANE_GAP_PX - lane) / LANE_NX);
        if (shiftPx > MAX_SHIFT_PX) continue;
        previousLane = lane + shiftPx * LANE_NX;
        placed.push({
            key: slot.key,
            tipX: slot.x,
            tipY: slot.y,
            anchorX: slot.x + shiftPx,
            anchorY,
        });
    }
    return placed;
}
