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
// The split is also what keeps the labelling free while the lens moves. Whether
// a summit is VISIBLE is a fact about the terrain, so the march is paid once per
// standpoint; whether it is worth NAMING is a fact about how crowded the screen
// is, so it is decided in the layout, which runs every frame.
//
// What the split does NOT do is uncover names as the lens narrows, which this
// comment claimed for a while. Measured across the whole lens range from a
// 2070 m standpoint, the count only ever falls — 23 names at 60° down to 8 at 8°
// — because the layout's gap rule only bites at wide angle: an 8° frame holds
// 3.5 % of the circle, and all 8 of the ~8 summits standing in it are already
// named. What starves a telephoto frame is how far the march was allowed to
// reach, below.
//
// Nothing here measures text. The text runs at {@link LABEL_ANGLE_DEG} from the
// horizontal, so two labels are parallel strips, and parallel strips never
// touch as long as they are far enough apart ACROSS that direction — whatever
// their lengths.
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
 * A rank-4 summit is a local point named for the hamlet below it; a rank-1 is a
 * name everyone in the valley knows. Indexed by `importance`, so slot 0 is
 * unused.
 *
 * The first cut of this — 25 km for rank 3, 8 km for rank 4 — was far too tight
 * to read a panorama with. Counted in the 70° looking west from Chamechaude, it
 * left 3 names on screen where 40 summits stand clear of the ridge, and 39 of
 * those 40 are ranks 3 and 4: the Aiguille de Quaix at 5.8 km, la Sure at 16,
 * Dent de Moirans at 15, le Gey at 31. PeakFinder names every one of them.
 * Rank 4 still stops well short of rank 3, which is what keeps the far end of
 * the list free of the obscure ones the wider radius would otherwise drag in.
 *
 * The FAR end was set by the haze, and the haze was the wrong judge — the lens
 * is. At 8° the frame holds 3.5 % of the circle, so the 60 km first given to
 * ranks 1 and 2 left 9 candidates standing in it out of the 432 the whole
 * circle offered, while PeakFinder names summits past 200 km. Taking rank 1 to
 * 150 km and rank 2 to 100 km leaves the circle at 831 candidates, still inside
 * {@link MAX_MARCHED}: the reach was the binding constraint, never the cost.
 * Measured from a 2067 m standpoint above Belledonne, at 8° and pitch 89° over
 * twelve azimuths, it takes the sightings from 128 to 228 — 66 of them past
 * 60 km — and the names actually printed from 48 to 85.
 *
 * Ranks 3 and 4 deliberately stay put, and that cut is editorial rather than
 * budgetary: a rank-4 top is a name borrowed from the hamlet below it, and it
 * says nothing at 100 km.
 */
const REACH_BY_IMPORTANCE_M = [0, 150_000, 100_000, 40_000, 20_000];

/**
 * Ceiling on the number of rays marched, paid in one go when the eye lands.
 *
 * Measured in the browser on the Chamechaude standpoint, a ray costs 0.28 ms,
 * not the 0.6 ms this budget was first sized on — so 900 of them cost about a
 * quarter of a second, once. A ray is also barely longer since the reach grew:
 * the march steps geometrically, so 150 km costs 380 samples against 334 for
 * 60 km.
 *
 * It is no longer roomy, though: over Belledonne the circle now offers 831 of
 * them, and the march measured 139 ms there. Reaching further means giving up
 * marching the whole circle and spending the budget inside the visible wedge
 * instead — which buys a lot, an 8° frame holding 3.5 % of the circle, but has
 * to re-march on every turn of the head, where today turning is free.
 */
const MAX_MARCHED = 900;

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
 * Nearer than this, a summit is the ground underfoot rather than a sighting.
 *
 * The mode puts the eye 1.70 m above the DEM at the picked spot, which is never
 * exactly the recorded top: standing on Chamechaude the summit row sits 34 m
 * away and the DEM reads 10 m higher there, so its apparent elevation is **16°**
 * — a leader pointing at empty sky, and a label band dragged 340 px above the
 * skyline it is supposed to clear, because the band hangs off the highest slot
 * on screen. At 250 m the same 10 m of DEM noise is 2.3°, under the slope noise
 * of a real ridge.
 *
 * The price is paid only when the eye is within 250 m of a named top, i.e. when
 * standing on one: 295 of the 25 830 summits have a neighbour that close, and
 * 500 m would already cost 1 454.
 */
const MIN_SIGHT_DISTANCE_M = 250;

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
 * Share of its rank's reach a summit uses, which is what the budget is spent in
 * order of.
 *
 * Ranking on the rank itself — every rank-2 before any rank-3, as this did at
 * first — empties the budget into the far horizon: from Chamechaude it marched
 * 198 rank-2 summits, les Rouies at 59.8 km among them, and reached 7 of the
 * 363 rank-3 and none at all of the 1030 rank-4, so Montvernet at 3.4 km never
 * got a ray. A rank is an editorial judgement about how far a name carries;
 * measuring a summit against its own rank's reach turns it into one number, and
 * a nearby minor top then rightly outranks a notorious speck on the skyline.
 */
export function reachFraction(peak: Peak, distanceM: number): number {
    return distanceM / REACH_BY_IMPORTANCE_M[peak.importance];
}

/**
 * Which of two names the band keeps when it has room for only one.
 *
 * The layout used to rank on {@link reachFraction} alone, on the argument that
 * the name which survives should be the one the budget would have marched
 * first. Those are two different questions, and answering them with one number
 * printed `Dent du Corbeau` over `Mont Blanc`: 2286 m at 58 km uses 0.58 of a
 * rank-2 reach where 4806 m at 104 km uses 0.69 of a rank-1 reach, the two land
 * 16 px apart, and the nearer one takes the slot. Deciding what to march is a
 * question about COST, and there the far speck rightly loses; deciding what to
 * print is a question about NOTORIETY, and there it rightly wins.
 *
 * So rank comes first and the fraction only separates equals — it stays below 1
 * by construction, so a rank never bleeds into the next.
 */
export function labelPriority(peak: Peak, distanceM: number): number {
    return peak.importance + Math.min(1, reachFraction(peak, distanceM));
}

/**
 * Thin the raw summit list down to what is worth a ray: near enough for its
 * rank, and inside the marching budget.
 */
export function selectCandidates(observer: SkylineObserver, peaks: readonly Peak[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const peak of peaks) {
        const reach = REACH_BY_IMPORTANCE_M[peak.importance] ?? 0;
        if (reach === 0) continue;
        const { azimuthDeg, distanceM } = sightingFrom(observer, peak.lng, peak.lat);
        if (distanceM > reach || distanceM < MIN_SIGHT_DISTANCE_M) continue;
        candidates.push({ peak, distanceM, azimuthDeg });
    }
    candidates.sort((a, b) =>
        reachFraction(a.peak, a.distanceM) - reachFraction(b.peak, b.distanceM));
    return candidates.slice(0, MAX_MARCHED);
}

/**
 * Keep the summits that stand clear of everything between them and the eye.
 *
 * Each gets its OWN ray, at its exact azimuth: bucketing azimuths the way the
 * sun labels do would be 130 m off course at 30 km, enough to march up the
 * wrong gully and call a summit hidden.
 *
 * The whole test runs in DEM space, the summit included, even when a surveyed
 * height is published for it: comparing a surveyed top against a DEM ridge
 * would tilt every verdict by the few metres that separate the two models. The
 * published height is only printed — and `tools/build-peaks.mjs` has already
 * dropped the ones RGE ALTI® contradicts.
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
            peak,
            distanceM,
            dir: [ce * Math.sin(az), ce * Math.cos(az), Math.sin(el)],
        });
    }
    return out;
}

// ── Screen-space layout ──────────────────────────────────────────────────────

/** Degrees the text is rotated by, counter-clockwise on screen. */
export const LABEL_ANGLE_DEG = -32;

/** Clear air between the highest summit on screen and the band the names hang from. */
const BAND_CLEARANCE_PX = 26;

/**
 * How close the band may come to the top of the canvas.
 *
 * The text rises from its anchor, so a band placed too high is a band whose
 * names are all cut off — which is what happens as soon as the skyline climbs.
 * The value is the rise of a long name at {@link LABEL_ANGLE_DEG}: about 190 px
 * of glyphs for "Pointe de Gratte-Cul 1232 m", so a hundred of vertical room.
 *
 * A summit that ends up ABOVE the clamped band simply goes unnamed. Hanging its
 * name under it instead would reverse the reading of every leader on screen for
 * the sake of one label; raising the camera is the answer, and it costs the
 * reader nothing to discover.
 */
const BAND_MIN_Y_PX = 110;

/**
 * Room one name needs along the band, and the 12 px line box widened by the
 * 3.5 px halo it is derived from.
 *
 * Every anchor sits on the same y, so the offset across two parallel strips
 * reduces to their horizontal gap times the sine of the angle — the pass no
 * longer projects anything. The shallower the text, the more horizontal room a
 * name needs: 30 px at -32°, where -58° only asked 19.
 */
const LINE_BOX_PX = 15.5;
const MIN_ANCHOR_GAP_PX = LINE_BOX_PX / Math.sin(-LABEL_ANGLE_DEG * DEG);

export interface PeakLabelSlot {
    key: string;
    /** Where the summit itself projects, in CSS pixels. */
    x: number;
    y: number;
    /** Lower is printed first when two names cannot both fit. */
    priority: number;
}

export interface PlacedPeakLabel {
    key: string;
    tipX: number;
    tipY: number;
    anchorX: number;
    anchorY: number;
}

/**
 * Hang every name from one horizontal band, joined to its summit by a vertical
 * leader, and drop those the band has no room for.
 *
 * This is PeakFinder's reading of a panorama, and the reason it looks tidy on a
 * crowded ridge: the names do not follow the skyline, so they neither cover the
 * relief nor bunch up wherever the summits do. The leader carries the meaning
 * instead, and being vertical it is unambiguous however long it gets.
 *
 * It also used to be sold as making the selection follow the zoom for free:
 * narrowing the field spreads the summits, the gap test stops failing, and the
 * minor names appear on their own. Measured, the count only falls as the lens
 * narrows — the gap test is not what binds at 8°, {@link BAND_MIN_Y_PX} is, and
 * what it drops is the whole top of the skyline.
 *
 * Which name survives a collision is `priority`, not screen order — an obscure
 * knoll used to be able to evict a notorious summit for standing slightly left
 * of it. See {@link labelPriority} for what that order is, and for the summit
 * it was getting wrong.
 */
export function layoutPeakLabels(slots: readonly PeakLabelSlot[]): PlacedPeakLabel[] {
    if (slots.length === 0) return [];
    let bandY = Number.POSITIVE_INFINITY;
    for (const slot of slots) bandY = Math.min(bandY, slot.y);
    bandY = Math.max(BAND_MIN_Y_PX, bandY - BAND_CLEARANCE_PX);

    const taken: number[] = [];
    const placed: PlacedPeakLabel[] = [];
    for (const slot of [...slots].sort((a, b) => a.priority - b.priority)) {
        if (slot.y < bandY) continue;
        if (taken.some((x) => Math.abs(x - slot.x) < MIN_ANCHOR_GAP_PX)) continue;
        taken.push(slot.x);
        placed.push({
            key: slot.key,
            tipX: slot.x,
            tipY: slot.y,
            anchorX: slot.x,
            anchorY: bandY,
        });
    }
    placed.sort((a, b) => a.anchorX - b.anchorX);
    return placed;
}
