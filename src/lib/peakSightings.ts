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
// a summit is VISIBLE is a fact about the terrain, so the march is paid when the
// drawn terrain changes, never per frame; whether it is worth NAMING is a fact
// about how crowded the screen is, so it is decided in the layout, which runs
// every frame.
//
// What the split does NOT do by itself is uncover names as the lens narrows.
// Measured across the whole lens range from a 2070 m standpoint, the count only
// ever fell — 23 names at 60° down to 8 at 8° — because an 8° frame holds 3.5 %
// of the circle, and every summit within reach standing in it was already
// named. What starved a telephoto frame was how far the march was allowed to
// reach, so the reach now stretches with the lens ({@link reachScaleForFov}).
//
// Nothing here measures text. The text runs at {@link LABEL_ANGLE_DEG} from the
// horizontal, so two labels are parallel strips, and parallel strips never
// touch as long as they are far enough apart ACROSS that direction — whatever
// their lengths.
// ─────────────────────────────────────────────────────────────────────────────

import type { Peak } from '@/lib/peaks';
import {
    apparentAngleDeg,
    rayStep,
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
 * Rank 4 stays put, and that cut is editorial rather than budgetary: a rank-4
 * top is a name borrowed from the hamlet below it, and it says nothing at 100 km.
 * Rank 3 is not that: it holds the Grand Veymont, highest of the Vercors, and
 * the Mont Aiguille, 50 and 53 km from Chamechaude, which its first 40 km cut
 * off. At 80 km, looking at them through 9°, the names printed go from 5 to 10.
 *
 * Rank 5 gets rank 4's reach: it holds classic hikes the IGN ranks below a
 * neighbouring shoulder (Pointe de la Sitre, 17 km from Chamechaude), and
 * {@link labelPriority} already puts it behind rank 4 at equal distance.
 */
const REACH_BY_IMPORTANCE_M = [0, 150_000, 100_000, 80_000, 20_000, 20_000];

/**
 * Below this vertical field of view the reaches stretch as the lens narrows,
 * since a summit covers as many pixels at `d` under `fov` as at `d · 30°/fov`
 * under 30°. Measured looking at the Vercors from Chamechaude: 15 → 20 names at
 * 15° (march 53 → 141 ms), 10 → 27 at 8° (33 → 162 ms); doubling ranks 3–5 at
 * 31° would have bought 27 → 37 for a march 3.5× longer — hence no stretch above.
 */
const REACH_REF_FOV_DEG = 30;
const MAX_REACH_SCALE = 4;

/** How much every reach stretches under a lens of `fovDeg` (vertical). */
export function reachScaleForFov(fovDeg: number): number {
    return Math.min(MAX_REACH_SCALE, Math.max(1, REACH_REF_FOV_DEG / fovDeg));
}

/**
 * Ceiling on the number of rays marched in one pass.
 *
 * A ray costs about 0.10 ms (measured over 3 800 rays, sampler included), and a
 * hidden summit — most of them — stops at its first foreground blocker. Only
 * summits on drawn terrain get a ray, so a pass is paid for the frame, not the
 * circle.
 */
const MAX_MARCHED = 900;

/*
 * How the visibility march reads the relief. Calibrated against PeakFinder's
 * verdicts on 2 952 named summits seen from four standpoints (Chamechaude, below
 * the Croix de Belledonne, Brévent, Col de Porte): this march disagrees on 51,
 * where the one it replaced — stop 1.5 % short of the summit, 0.02° of margin,
 * a step of 2 % of the distance — disagreed on 94, at the same cost per ray.
 */

/** First probe, and the finest step: 10 m up to 1.5 km, then 1/150 of the distance. */
const RAY_MIN_STEP_M = 10;
const RAY_STEP_FRACTION = 1 / 150;

/**
 * The ground near the eye is lowered, by this much at the eye and smoothly less
 * out to this radius, so the slope underfoot hides nothing the walker sees over.
 * Without it the march above disagrees on 75 summits instead of 52 — but
 * PeakFinder does the same, so that gain is partly circular: not yet checked
 * against an independent reference.
 */
const SINK_DEPTH_M = 20;
const SINK_RADIUS_M = 1_000;

/**
 * A blocker this close to the summit is the summit's own mass, forgiven as long
 * as no later blocker sits {@link SUMMIT_DIP_M} below the highest one — a notch
 * in what stands before the top. Farther out, anything above the line of sight
 * hides the summit.
 *
 * A drop BELOW the line of sight is deliberately not checked, although it is
 * what tells a separate crest from the summit's flank: it is also the far side
 * of a top the anchor sits just behind. Checking it hid 7 summits of 2 952 that
 * PeakFinder sees — la Grande Roche, Tête Pelouse, Pic de la Loze… — all with
 * their anchor 200 m to 1 km past the highest point of the DEM.
 *
 * The zone never covers more than {@link SUMMIT_ZONE_MAX_SHARE} of the way: past
 * the halfway point the terrain is nearer the eye than the summit is, and a
 * 1 400 m zone would otherwise forgive the whole ray of a summit 1 km away.
 */
const SUMMIT_ZONE_M = 1_400;
const SUMMIT_ZONE_MAX_SHARE = 0.5;
const SUMMIT_DIP_M = 15;

/** A summit whose DEM reads at sea level is outside the loaded terrain. */
const MIN_GROUND_M = 1;

/**
 * Nearer than this, a summit is the ground underfoot rather than a sighting.
 *
 * The mode puts the eye a few metres above the DEM at the picked spot, which is
 * never exactly the recorded top: with the eye at 1.70 m, standing on Chamechaude
 * the summit row sat 34 m away and the DEM read 10 m higher there, so its apparent
 * elevation was **16°**
 * — a leader pointing at empty sky, and a label band dragged 340 px above the
 * skyline it is supposed to clear, because the band hangs off the highest slot
 * on screen. At 250 m the same 10 m of DEM noise is 2.3°, under the slope noise
 * of a real ridge.
 *
 * The price is paid only when the eye is within 250 m of a named top, i.e. when
 * standing on one: 1 093 of the 39 846 summits have a neighbour that close, and
 * 500 m would already cost 5 996.
 */
const MIN_SIGHT_DISTANCE_M = 250;

export interface PeakSighting {
    peak: Peak;
    distanceM: number;
    /**
     * Ground height under the summit, as sampled for the march. Placed with
     * MapLibre's own matrix (`screenProjector`), so the tip lands on the relief
     * as drawn: no curvature, the renderer's vertical scale, its padding.
     */
    groundM: number;
    /** How far the summit stands above the nearer relief, in degrees. */
    clearanceDeg: number;
    /** Nothing drawn behind the summit rises above it: it is cut out against the sky. */
    onSkyline: boolean;
}

interface Candidate {
    peak: Peak;
    distanceM: number;
    azimuthDeg: number;
    groundM: number;
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

/** What one rank of notoriety is worth, in shares of reach. */
const RANK_STEP = 0.15;
/**
 * What a summit no source publishes a height for loses, in ranks. One rank left
 * Mont Saint-Mury (rank 4, a shoulder PeakFinder gives no prominence) ahead of
 * the Pointe de la Sitre (rank 5, 2195 m) it hides from Chamechaude, 560 m nearer.
 */
const HEIGHTLESS_RANKS = 2;
/** What one degree of clearance above the nearer relief is worth, capped at 1.5°. */
const CLEARANCE_WEIGHT = 0.2;
const CLEARANCE_CAP_DEG = 1.5;
/**
 * What standing against the sky is worth, in shares of reach — two ranks. The
 * Grand Veymont (2341 m, 51 km) is the one top of the Vercors skyline seen from
 * Chamechaude, yet lost its column to the Crête de la Ferrière (1468 m, 38 km),
 * a foreground knoll set against its flank, by 0.73 to 0.70.
 */
const SKYLINE_BONUS = 0.3;

/**
 * Which of two names the band keeps when it has room for only one — lower
 * first.
 *
 * Rank used to come first, whole: every rank-2 before any rank-3. Looking west
 * from Chamechaude that printed Crêt de Montivert (92 km, peeking 0.27° over
 * the ridge in front) instead of Rocher de Chalves (7 km, 0.57°) in the same
 * column, the Gerbier de Jonc at 132 km over la Sure at 16 km, and Mont Salomon
 * — a 270 m hill at 76 km — over Montfromage at 3.6 km. A rank is how far a
 * name carries, so it is weighed against the distance ({@link reachFraction})
 * instead of trumping it, a step of {@link RANK_STEP} per rank; and a summit
 * that stands clear of the relief before it reads as a summit, where one
 * barely peeking over a nearer ridge reads as a notch.
 *
 * Still holds the case rank-first was introduced for: the Mont Blanc (4806 m
 * at 104 km, 0.69 of a rank-1 reach) over the Dent du Corbeau (58 km, 0.58 of
 * a rank-2 one), which land 16 px apart.
 *
 * A summit without a published height counts {@link HEIGHTLESS_RANKS} ranks
 * lower: 57 % of the file has none, most of them shoulders and knolls of ranks
 * 4 and 5. One cut out against the sky gains {@link SKYLINE_BONUS}.
 */
export function labelPriority(
    sighting: Pick<PeakSighting, 'peak' | 'distanceM' | 'clearanceDeg' | 'onSkyline'>,
): number {
    const { peak, distanceM, clearanceDeg, onSkyline } = sighting;
    const rank = peak.importance + (peak.spotHeightM === null ? HEIGHTLESS_RANKS : 0);
    return reachFraction(peak, distanceM)
        + RANK_STEP * (rank - 1)
        - CLEARANCE_WEIGHT * Math.min(CLEARANCE_CAP_DEG, Math.max(0, clearanceDeg))
        - (onSkyline ? SKYLINE_BONUS : 0);
}

/**
 * Thin the raw summit list down to what is worth a ray: near enough for its
 * rank, standing on terrain the sampler can see, and inside the marching budget.
 *
 * The ground under each summit is read BEFORE the budget is applied. Read after,
 * as it first was, the 900 slots went to candidates all round the circle, and
 * those off the drawn tiles — everything behind the camera — were then thrown
 * away for one sample each, while framed summits past the cut never got a ray:
 * 150 of them from the Croix de Belledonne, whose circle holds 1 050.
 *
 * `reachScale` ({@link reachScaleForFov}) only moves the cut: the budget, and
 * {@link labelPriority} after it, still weigh a summit against its rank's base
 * reach, so zooming never changes which of two names wins a column.
 */
export function selectCandidates(
    observer: SkylineObserver,
    peaks: readonly Peak[],
    sample: GroundSampler,
    reachScale = 1,
): Candidate[] {
    const candidates: Candidate[] = [];
    for (const peak of peaks) {
        const reach = (REACH_BY_IMPORTANCE_M[peak.importance] ?? 0) * reachScale;
        if (reach === 0) continue;
        const { azimuthDeg, distanceM } = sightingFrom(observer, peak.lng, peak.lat);
        if (distanceM > reach || distanceM < MIN_SIGHT_DISTANCE_M) continue;
        const groundM = sample(peak.lng, peak.lat);
        if (!Number.isFinite(groundM) || groundM < MIN_GROUND_M) continue;
        candidates.push({ peak, distanceM, azimuthDeg, groundM });
    }
    candidates.sort((a, b) =>
        reachFraction(a.peak, a.distanceM) - reachFraction(b.peak, b.distanceM));
    return candidates.slice(0, MAX_MARCHED);
}

/** Metres the ground is lowered by, `d` metres from the eye. */
function sinkM(d: number): number {
    const x = Math.min(1, d / SINK_RADIUS_M);
    return SINK_DEPTH_M * (1 - x * x * (3 - 2 * x));
}

/**
 * How far the summit stands above the relief in front of its own mass, in
 * degrees, or null when that relief hides it.
 */
function summitClearanceDeg(observer: SkylineObserver, candidate: Candidate, sample: GroundSampler): number | null {
    const { distanceM, groundM } = candidate;
    const eyeM = observer.altitudeM;
    const { perMetreLng, perMetreLat } = rayStep(observer, candidate.azimuthDeg);
    const summitDeg = apparentAngleDeg(eyeM, groundM, distanceM);
    const zoneStartM = distanceM - Math.min(SUMMIT_ZONE_M, distanceM * SUMMIT_ZONE_MAX_SHARE);
    let foregroundDeg = -90;
    let highestBlockerM = Number.NEGATIVE_INFINITY;
    for (let d = RAY_MIN_STEP_M; d < distanceM; d += Math.max(RAY_MIN_STEP_M, d * RAY_STEP_FRACTION)) {
        const rawM = sample(observer.lng + perMetreLng * d, observer.lat + perMetreLat * d);
        if (!Number.isFinite(rawM)) continue;
        const h = rawM - sinkM(d);
        const deg = apparentAngleDeg(eyeM, h, d);
        if (d < zoneStartM) {
            if (deg > summitDeg) return null;
            foregroundDeg = Math.max(foregroundDeg, deg);
            continue;
        }
        if (deg <= summitDeg) continue;
        highestBlockerM = Math.max(highestBlockerM, h);
        if (highestBlockerM - h >= SUMMIT_DIP_M) return null;
    }
    return summitDeg - foregroundDeg;
}

/** Past the summit, what lies this close is its own far flank or its true top. */
const BACKDROP_START_M = 300;
/** How far behind a summit the march looks for relief rising above it. */
const BACKDROP_END_M = 150_000;

/**
 * Whether nothing drawn behind the summit rises above it, i.e. whether it is
 * seen against the sky rather than against a farther slope. The backdrop gets
 * {@link SUMMIT_DIP_M} of slack, the DEM noise the summit zone already forgives.
 * Measured over the 77 summits seen through 7° towards the Vercors: 14 ms.
 */
function standsOnSkyline(observer: SkylineObserver, candidate: Candidate, sample: GroundSampler): boolean {
    const { distanceM, groundM } = candidate;
    const eyeM = observer.altitudeM;
    const { perMetreLng, perMetreLat } = rayStep(observer, candidate.azimuthDeg);
    const summitDeg = apparentAngleDeg(eyeM, groundM, distanceM);
    for (let d = distanceM + BACKDROP_START_M; d < BACKDROP_END_M; d += d * RAY_STEP_FRACTION) {
        const h = sample(observer.lng + perMetreLng * d, observer.lat + perMetreLat * d);
        if (Number.isFinite(h) && apparentAngleDeg(eyeM, h - SUMMIT_DIP_M, d) > summitDeg) return false;
    }
    return true;
}

/**
 * Keep the summits that stand clear of everything between them and the eye.
 *
 * Each gets its OWN ray, at its exact azimuth: bucketing azimuths the way the
 * sun labels do would be 130 m off course at 30 km, enough to march up the
 * wrong gully and call a summit hidden.
 *
 * The march stays physical (curvature, refraction) while the placement is the
 * renderer's: whether a ridge really hides a summit is a question about the
 * world, where its name goes is a question about the picture, and the picture
 * is a plane.
 *
 * The whole test runs in DEM space, the summit included, even when a surveyed
 * height is published for it: comparing a surveyed top against a DEM ridge
 * would tilt every verdict by the few metres that separate the two models. The
 * published height is only printed — and `tools/build-peaks.mjs` has already
 * dropped the ones RGE ALTI® contradicts.
 *
 * A summit the sampler cannot see (non-finite) is skipped, and a blind stretch
 * of ray counts as clear ground: fed the drawn surface, that is terrain below
 * the frame, which cannot stand in front of a summit inside it.
 */
export function sightPeaks(
    observer: SkylineObserver,
    peaks: readonly Peak[],
    sample: GroundSampler,
    reachScale = 1,
): PeakSighting[] {
    const out: PeakSighting[] = [];
    for (const candidate of selectCandidates(observer, peaks, sample, reachScale)) {
        const seen = sightCandidate(observer, candidate, sample);
        if (seen) out.push(seen);
    }
    return out;
}

function sightCandidate(observer: SkylineObserver, candidate: Candidate, sample: GroundSampler): PeakSighting | null {
    const clearanceDeg = summitClearanceDeg(observer, candidate, sample);
    if (clearanceDeg === null) return null;
    const { peak, distanceM, groundM } = candidate;
    return { peak, distanceM, groundM, clearanceDeg, onSkyline: standsOnSkyline(observer, candidate, sample) };
}

/** How {@link sightPeaksInSlices} shares the main thread. */
export interface SliceSchedule {
    /** Time one slice may take before handing the thread back, in ms. */
    sliceMs: number;
    /** Resolves when the next slice may run — the next frame, in the app. */
    nextSlice: () => Promise<void>;
    /** True once the result is no longer wanted: the pass stops and resolves to null. */
    stale: () => boolean;
    now: () => number;
}

/**
 * {@link sightPeaks}, cut into slices of about `sliceMs` so a telephoto pass —
 * 140 to 160 ms measured at 8° — does not freeze a gesture resumed meanwhile.
 * Same verdicts, in the same order; `sample` must stay valid across slices.
 */
export async function sightPeaksInSlices(
    observer: SkylineObserver,
    peaks: readonly Peak[],
    sample: GroundSampler,
    reachScale: number,
    schedule: SliceSchedule,
): Promise<PeakSighting[] | null> {
    const out: PeakSighting[] = [];
    let sliceStart = schedule.now();
    for (const candidate of selectCandidates(observer, peaks, sample, reachScale)) {
        if (schedule.now() - sliceStart >= schedule.sliceMs) {
            await schedule.nextSlice();
            if (schedule.stale()) return null;
            sliceStart = schedule.now();
        }
        const seen = sightCandidate(observer, candidate, sample);
        if (seen) out.push(seen);
    }
    return out;
}

// ── Screen-space layout ──────────────────────────────────────────────────────

/**
 * Degrees the text is rotated by, counter-clockwise on screen. Steeper packs more
 * names on one band (see {@link anchorGapPx}): looking at Belledonne from
 * Chamechaude at 10°, the screen went from 18 names at −32° to 20 at −45°.
 */
export const LABEL_ANGLE_DEG = -45;

/** Clear air between the highest summit on screen and the band the names hang from. */
const BAND_CLEARANCE_PX = 26;

/** Share of the sky left above that clearance the band climbs into, up to a cap. */
const BAND_LIFT_SHARE = 0.5;
const BAND_LIFT_MAX_PX = 50;

/** Font size of a plain name, in CSS pixels. */
export const LABEL_FONT_PX = 12;

/** Glyph run of a long name at {@link LABEL_FONT_PX}, "Pointe de Gratte-Cul 1232 m". */
const LONG_NAME_PX = 190;

/**
 * How close the band may come to the top of the canvas, for names up to
 * `fontPx`.
 *
 * The text rises from its anchor, so a band placed too high is a band whose
 * names are all cut off — which is what happens as soon as the skyline climbs.
 * The value is the rise of a long name at {@link LABEL_ANGLE_DEG}, plus a margin.
 * It scales with the largest font on screen: a rank-1 name set in 14 px bold
 * runs 220 px at the 95th percentile, not 190.
 *
 * A summit that ends up ABOVE the clamped band simply goes unnamed. Hanging its
 * name under it instead would reverse the reading of every leader on screen for
 * the sake of one label; raising the camera is the answer, and it costs the
 * reader nothing to discover.
 */
function bandMinYPx(fontPx: number): number {
    return Math.round(LONG_NAME_PX * (fontPx / LABEL_FONT_PX) * Math.sin(-LABEL_ANGLE_DEG * DEG)) + 10;
}

/**
 * Room a name needs across its own direction, on top of its font size: a 12 px
 * Helvetica spans 12 px of ink from cap to descender (measured, 9 + 3), plus one
 * halo edge (1.75 px, half the 3.5 px stroke) so a neighbour's halo never bites
 * a glyph. Two halos may touch; they are the same dark.
 *
 * It was 15.5 — the full halo on both sides — which is 3.5 px too careful and
 * cost a name every so often: looking into Chartreuse from Chamechaude,
 * Montfromage lost its slot to Rocher de Lorzier by 0.8 px, and Mont Salomon
 * took the column instead.
 *
 * Every anchor sits on the same y, so the offset across two parallel strips
 * reduces to their horizontal gap times the sine of the angle: 20 px between
 * two plain names at −45°, 26 at −32°. Two strips of different sizes each need
 * half their own box.
 */
const HALO_EDGE_PX = 2;

function anchorGapPx(fontA: number, fontB: number): number {
    return ((fontA + fontB) / 2 + HALO_EDGE_PX) / Math.sin(-LABEL_ANGLE_DEG * DEG);
}

export interface PeakLabelSlot {
    key: string;
    /** Where the summit itself projects, in CSS pixels. */
    x: number;
    y: number;
    /** Lower is printed first when two names cannot both fit. */
    priority: number;
    /** Font size the name is set in. */
    fontPx: number;
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
 * instead, and being vertical it is unambiguous however long it gets. Sliding
 * crowded names aside with a bent leader was tried and rejected: it reads as a
 * tangle.
 *
 * Narrowing the lens uncovers names only through the reach it stretches
 * ({@link reachScaleForFov}): at a fixed reach the count only fell as the lens
 * narrowed.
 *
 * Which name survives a collision is `priority`, not screen order — an obscure
 * knoll used to be able to evict a notorious summit for standing slightly left
 * of it. See {@link labelPriority} for what that order is.
 */
export function layoutPeakLabels(slots: readonly PeakLabelSlot[]): PlacedPeakLabel[] {
    if (slots.length === 0) return [];
    let topY = Number.POSITIVE_INFINITY;
    let maxFontPx = LABEL_FONT_PX;
    for (const slot of slots) {
        topY = Math.min(topY, slot.y);
        maxFontPx = Math.max(maxFontPx, slot.fontPx);
    }
    const ceilingY = bandMinYPx(maxFontPx);
    const lowestY = topY - BAND_CLEARANCE_PX;
    const lift = Math.min(BAND_LIFT_MAX_PX, BAND_LIFT_SHARE * Math.max(0, lowestY - ceilingY));
    const bandY = Math.max(ceilingY, lowestY - lift);

    const taken: PeakLabelSlot[] = [];
    const placed: PlacedPeakLabel[] = [];
    for (const slot of [...slots].sort((a, b) => a.priority - b.priority)) {
        if (slot.y < bandY) continue;
        if (taken.some((t) => Math.abs(t.x - slot.x) < anchorGapPx(t.fontPx, slot.fontPx))) continue;
        taken.push(slot);
        placed.push({ key: slot.key, tipX: slot.x, tipY: slot.y, anchorX: slot.x, anchorY: bandY });
    }
    placed.sort((a, b) => a.anchorX - b.anchorX);
    return placed;
}
