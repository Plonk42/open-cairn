import { describe, expect, it } from 'vitest';
import type { Peak } from './peaks';
import {
    LABEL_ANGLE_DEG,
    labelPriority,
    layoutPeakLabels,
    reachScaleForFov,
    selectCandidates,
    sightPeaks,
    sightPeaksInSlices,
    type PeakLabelSlot,
    type PlacedPeakLabel,
} from './peakSightings';
import type { GroundSampler, SkylineObserver } from './skyline';

const OBSERVER: SkylineObserver = { lng: 6.0, lat: 45.0, altitudeM: 1000 };

const METRES_PER_DEG_LAT = 111320;

/** A summit `northM` metres due north of the observer. */
function peakNorth(id: string, northM: number, importance = 1): Peak {
    return {
        id,
        name: id,
        lng: OBSERVER.lng,
        lat: OBSERVER.lat + northM / METRES_PER_DEG_LAT,
        importance,
        spotHeightM: null,
    };
}

const flat: GroundSampler = () => 1000;

/** Flat ground, except a disc of `height` around each listed summit. */
function summits(height: number, peaks: readonly Peak[], ground = 1000): GroundSampler {
    return (lng, lat) => {
        for (const peak of peaks) {
            if (Math.abs(lat - peak.lat) < 0.0009 && Math.abs(lng - peak.lng) < 0.0013) return height;
        }
        return ground;
    };
}

describe('selectCandidates', () => {
    it('keeps a notorious summit far away and drops a minor one at the same spot', () => {
        const far = 40_000;
        const kept = selectCandidates(OBSERVER, [peakNorth('major', far, 1)], flat);
        const dropped = selectCandidates(OBSERVER, [peakNorth('minor', far, 4)], flat);
        expect(kept.map((c) => c.peak.id)).toEqual(['major']);
        expect(dropped).toEqual([]);
    });

    it('keeps a minor summit once it is close enough to be checked', () => {
        const close = selectCandidates(OBSERVER, [peakNorth('minor', 5_000, 4)], flat);
        expect(close.map((c) => c.peak.id)).toEqual(['minor']);
    });

    it('reaches farther under a narrower lens, never shorter under a wider one', () => {
        const minor = [peakNorth('minor', 50_000, 4)];
        expect(selectCandidates(OBSERVER, minor, flat, reachScaleForFov(30))).toEqual([]);
        expect(selectCandidates(OBSERVER, minor, flat, reachScaleForFov(15))).toEqual([]);
        expect(selectCandidates(OBSERVER, minor, flat, reachScaleForFov(8))).toHaveLength(1);
        expect(reachScaleForFov(60)).toBe(1);
        expect(reachScaleForFov(1)).toBe(4);
    });

    it('reads the azimuth in the same frame the ray march walks', () => {
        const [north] = selectCandidates(OBSERVER, [peakNorth('n', 5_000)], flat);
        expect(north.azimuthDeg).toBeCloseTo(0, 3);
        expect(north.distanceM).toBeCloseTo(5_000, 0);

        const east: Peak = {
            id: 'e',
            name: 'e',
            lng: OBSERVER.lng + 0.05,
            lat: OBSERVER.lat,
            importance: 1,
            spotHeightM: null,
        };
        expect(selectCandidates(OBSERVER, [east], flat)[0].azimuthDeg).toBeCloseTo(90, 3);
    });

    it('caps the marching budget', () => {
        const many: Peak[] = [];
        for (let i = 0; i < 2_000; i++) many.push(peakNorth(`minor-${i}`, 5_000 + i, 4));
        expect(selectCandidates(OBSERVER, many, flat)).toHaveLength(900);
    });

    it('drops the summit the observer is standing on', () => {
        // The eye lands a few metres above the DEM, never on the recorded top: from
        // 34 m away the summit reads 16° up and hangs the whole band in the sky.
        const selected = selectCandidates(OBSERVER, [peakNorth('underfoot', 34), peakNorth('ridge', 900)], flat);
        expect(selected.map((c) => c.peak.id)).toEqual(['ridge']);
    });

    it('spends the budget on a nearby minor summit before a distant notorious one', () => {
        const selected = selectCandidates(OBSERVER, [
            peakNorth('far-major', 50_000, 1),
            peakNorth('near-minor', 2_000, 4),
        ], flat);
        expect(selected.map((c) => c.peak.id)).toEqual(['near-minor', 'far-major']);
    });

    it('spends the budget on summits standing on drawn terrain only', () => {
        const offTile: Peak[] = [];
        for (let i = 0; i < 900; i++) offTile.push(peakNorth(`off-${i}`, 2_000 + i, 4));
        // Farther than every off-tile summit, so reach share alone would cut it.
        const drawn = peakNorth('drawn', 10_000, 4);
        const drawnOnly: GroundSampler = (_lng, lat) => (lat >= drawn.lat - 1e-6 ? 1000 : Number.NaN);
        const selected = selectCandidates(OBSERVER, [...offTile, drawn], drawnOnly);
        expect(selected.map((c) => c.peak.id)).toEqual(['drawn']);
    });
});

describe('sightPeaks', () => {
    it('sees a summit standing alone on a plain', () => {
        const peak = peakNorth('alone', 6_000);
        const seen = sightPeaks(OBSERVER, [peak], summits(2_000, [peak]));
        expect(seen.map((s) => s.peak.id)).toEqual(['alone']);
        expect(seen[0].distanceM).toBeCloseTo(6_000, -1);
    });

    it('hides a summit a taller nearer one stands in front of', () => {
        const behind = peakNorth('behind', 12_000);
        const front = peakNorth('front', 4_000);
        // Both 2 000 m, so the nearer one subtends far more sky.
        const sample = summits(2_000, [behind, front]);
        const seen = sightPeaks(OBSERVER, [behind, front], sample);
        expect(seen.map((s) => s.peak.id)).toEqual(['front']);
    });

    it('does not let a summit hide itself with its own slope', () => {
        // A broad dome: the probes just short of the top are barely lower, which
        // is exactly the case the summit zone exists for.
        const dome = peakNorth('dome', 8_000);
        const sample: GroundSampler = (_lng, lat) => {
            const dM = Math.abs(lat - dome.lat) * METRES_PER_DEG_LAT;
            return dM > 2_000 ? 1_000 : 2_000 - (dM / 2_000) * 1_000;
        };
        expect(sightPeaks(OBSERVER, [dome], sample).map((s) => s.peak.id)).toEqual(['dome']);
    });

    it('hides a summit behind a col in front of its top, even inside the summit zone', () => {
        const top = peakNorth('top', 5_000);
        const northOf = (lat: number) => (lat - OBSERVER.lat) * METRES_PER_DEG_LAT;
        const sample: GroundSampler = (_lng, lat) => {
            const dM = northOf(lat);
            if (Math.abs(dM - 5_000) < 60) return 2_000;
            if (Math.abs(dM - 4_200) < 60) return 2_100;
            if (Math.abs(dM - 4_600) < 60) return 1_950;
            return 1_000;
        };
        expect(sightPeaks(OBSERVER, [top], sample)).toEqual([]);
    });

    it('does not forgive a bench near the eye as the mass of a summit 1 km away', () => {
        const near = peakNorth('near', 1_000);
        const sample: GroundSampler = (_lng, lat) => {
            const dM = (lat - OBSERVER.lat) * METRES_PER_DEG_LAT;
            if (dM > 940) return 1_100;
            return dM > 200 ? 1_060 : 998;
        };
        expect(sightPeaks(OBSERVER, [near], sample)).toEqual([]);
    });

    it('measures a near summit\'s clearance against the relief in front of it', () => {
        const near = peakNorth('near', 1_000);
        const sample: GroundSampler = (_lng, lat) => {
            const dM = (lat - OBSERVER.lat) * METRES_PER_DEG_LAT;
            return dM > 940 ? 1_030 : 998;
        };
        const [seen] = sightPeaks(OBSERVER, [near], sample);
        expect(seen.clearanceDeg).toBeGreaterThan(0);
        expect(seen.clearanceDeg).toBeLessThan(5);
    });

    it('sees over a hummock at the eye\'s feet', () => {
        const far = peakNorth('far', 10_000);
        const sample: GroundSampler = (_lng, lat) => {
            const dM = (lat - OBSERVER.lat) * METRES_PER_DEG_LAT;
            if (Math.abs(dM - 10_000) < 60) return 1_010;
            return dM > 50 && dM < 300 ? 1_003 : 998;
        };
        expect(sightPeaks(OBSERVER, [far], sample).map((s) => s.peak.id)).toEqual(['far']);
    });

    it('drops a summit whose DEM reads at sea level, i.e. outside the loaded terrain', () => {
        const peak = peakNorth('unloaded', 30_000);
        expect(sightPeaks(OBSERVER, [peak], () => 0)).toEqual([]);
    });

    it('carries the published height straight through, having no say over it', () => {
        // Which heights survive is settled by `tools/build-peaks.mjs` against
        // RGE ALTI, not here: a sighting reports, it does not arbitrate.
        const peak = { ...peakNorth('coted', 6_000), spotHeightM: 1_990 };
        const [seen] = sightPeaks(OBSERVER, [peak], summits(2_000, [peak]));
        expect(seen.peak.spotHeightM).toBe(1_990);
    });

    it('reports the ground height the summit was judged on', () => {
        const peak = peakNorth('alone', 6_000);
        const [seen] = sightPeaks(OBSERVER, [peak], summits(2_000, [peak]));
        expect(seen.groundM).toBe(2_000);
    });

    it('skips a summit the sampler cannot see, and treats a blind ray as clear', () => {
        const peak = peakNorth('far', 12_000);
        const blind: GroundSampler = (_lng, lat) => {
            if (Math.abs(lat - peak.lat) < 0.0009) return 2_000;
            return Number.NaN;
        };
        expect(sightPeaks(OBSERVER, [peak], blind).map((s) => s.peak.id)).toEqual(['far']);
        expect(sightPeaks(OBSERVER, [peak], () => Number.NaN)).toEqual([]);
    });

    it('tells a summit cut out against the sky from one set against a farther slope', () => {
        const knoll = peakNorth('knoll', 5_000);
        const northOf = (lat: number) => (lat - OBSERVER.lat) * METRES_PER_DEG_LAT;
        const alone = summits(1_200, [knoll]);
        const backed: GroundSampler = (lng, lat) => (northOf(lat) > 9_000 ? 2_500 : alone(lng, lat));
        expect(sightPeaks(OBSERVER, [knoll], alone)[0].onSkyline).toBe(true);
        expect(sightPeaks(OBSERVER, [knoll], backed)[0].onSkyline).toBe(false);
    });
});

describe('sightPeaksInSlices', () => {
    const peaks = [peakNorth('behind', 12_000), peakNorth('front', 4_000), peakNorth('middle', 7_000)];
    const sample = summits(2_000, peaks);

    /** A clock that moves 1 ms per reading, and counts the slices handed back. */
    function schedule(stale = () => false) {
        let t = 0;
        const state = { slices: 1 };
        return {
            state,
            sliceMs: 2,
            now: () => t++,
            nextSlice: async () => { state.slices += 1; },
            stale,
        };
    }

    it('reaches the same verdicts as the single pass, over several slices', async () => {
        const s = schedule();
        const sliced = await sightPeaksInSlices(OBSERVER, peaks, sample, 1, s);
        expect(sliced).toEqual(sightPeaks(OBSERVER, peaks, sample));
        expect(s.state.slices).toBeGreaterThan(1);
    });

    it('gives up once the result is no longer wanted', async () => {
        expect(await sightPeaksInSlices(OBSERVER, peaks, sample, 1, schedule(() => true))).toBeNull();
    });
});

describe('labelPriority', () => {
    const at = (peak: Peak, distanceM: number, clearanceDeg = 0.5, onSkyline = false) =>
        ({ peak, distanceM, clearanceDeg, onSkyline });

    it('keeps the Mont Blanc over the knoll that used to evict it', () => {
        // From Chamechaude the two land 16 px apart, and the fraction alone put
        // the Dent du Corbeau first: 0.58 of a rank-2 reach against 0.69 of a
        // rank-1 one.
        const montBlanc = { ...peakNorth('Mont Blanc', 1, 1), importance: 1 };
        const corbeau = { ...peakNorth('Dent du Corbeau', 1, 2), importance: 2 };
        expect(labelPriority(at(montBlanc, 104_000))).toBeLessThan(labelPriority(at(corbeau, 58_000)));
    });

    it('prefers a nearby rank-3 summit over a far rank-2 speck in the same column', () => {
        // Looking west from Chamechaude: Rocher de Chalves against Crêt de Montivert.
        const chalves = { ...peakNorth('Rocher de Chalves', 1, 3), importance: 3 };
        const montivert = { ...peakNorth('Crêt de Montivert', 1, 2), importance: 2 };
        expect(labelPriority(at(chalves, 7_100, 0.57))).toBeLessThan(labelPriority(at(montivert, 91_800, 0.27)));
    });

    it('prefers the summit standing clear over the one barely peeking', () => {
        const peak = peakNorth('p', 1, 3);
        expect(labelPriority(at(peak, 15_000, 1.2))).toBeLessThan(labelPriority(at(peak, 15_000, 0.05)));
    });

    it('separates equals by how far they reach for their rank', () => {
        const near = peakNorth('near', 1, 2);
        const far = peakNorth('far', 1, 2);
        expect(labelPriority(at(near, 20_000))).toBeLessThan(labelPriority(at(far, 90_000)));
    });

    it('prefers a summit with a published height over a nearer, better-ranked one without', () => {
        // From Chamechaude, both standing well clear of the ridge in front.
        const sitre = { ...peakNorth('Pointe de la Sitre', 1, 5), spotHeightM: 2_195 };
        const saintMury = peakNorth('Mont Saint-Mury', 1, 4);
        expect(labelPriority(at(sitre, 17_040, 2.1))).toBeLessThan(labelPriority(at(saintMury, 16_480, 2.0)));
    });

    it('prefers the summit cut out against the sky over a nearer knoll set against its flank', () => {
        // From Chamechaude towards the Vercors, 17 px apart at 7°.
        const veymont = { ...peakNorth('le Grand Veymont', 1, 3), spotHeightM: 2_341 };
        const ferriere = { ...peakNorth('Crête de la Ferrière', 1, 3), spotHeightM: 1_468 };
        expect(labelPriority(at(veymont, 50_800, 1.0, true)))
            .toBeLessThan(labelPriority(at(ferriere, 37_600, 0.35, false)));
    });
});

describe('layoutPeakLabels', () => {
    const slot = (key: string, x: number, y = 300, priority = 0.5, fontPx = 12): PeakLabelSlot =>
        ({ key, x, y, priority, fontPx });

    const RAD = Math.PI / 180;
    /** Signed offset of a label's strip across its own direction, in pixels. */
    const lane = (p: PlacedPeakLabel) =>
        p.anchorX * Math.sin(-LABEL_ANGLE_DEG * RAD) + p.anchorY * Math.cos(-LABEL_ANGLE_DEG * RAD);
    /** 12 px of ink, cap to descender, plus one edge of the halo the overlay paints under it. */
    const LINE_BOX_PX = 14;

    it('hangs every name from one band, clear of the highest summit on screen', () => {
        const placed = layoutPeakLabels([slot('high', 100, 240), slot('low', 400, 520)]);
        expect(placed.map((p) => p.anchorY)).toEqual([placed[0].anchorY, placed[0].anchorY]);
        expect(placed[0].anchorY).toBeLessThan(240);
    });

    it('lifts the band into free sky, but only so far', () => {
        const [roomy] = layoutPeakLabels([slot('a', 100, 520)]);
        expect(roomy.anchorY).toBe(520 - 26 - 50);
        // 40 px of sky past the ceiling: the band climbs half of it.
        const [tight] = layoutPeakLabels([slot('a', 100, 144 + 26 + 40)]);
        expect(tight.anchorY).toBe(144 + 20);
    });

    it('says nothing rather than hang a name under its summit', () => {
        // A skyline too high for the band to clear: the leaders would point down
        // and reverse the reading of the whole panorama.
        expect(layoutPeakLabels([slot('a', 100, 40), slot('b', 400, 60)])).toEqual([]);
    });

    it('draws a strictly vertical leader back to the summit', () => {
        const placed = layoutPeakLabels([slot('a', 100, 300), slot('b', 400, 520)]);
        for (const p of placed) expect(p.anchorX).toBe(p.tipX);
    });

    it('keeps the name that ranks first when two cannot both fit', () => {
        const placed = layoutPeakLabels([
            slot('minor', 100, 300, 0.9),
            slot('notorious', 108, 300, 0.1),
        ]);
        expect(placed.map((p) => p.key)).toEqual(['notorious']);
    });

    it('finds room for a dropped name once zooming spreads the summits apart', () => {
        const crowded = [slot('a', 100), slot('b', 108), slot('c', 116)];
        // The same three summits under a field of view four times narrower.
        const spread = crowded.map((s) => ({ ...s, x: 100 + (s.x - 100) * 4 }));
        expect(layoutPeakLabels(crowded)).toHaveLength(1);
        expect(layoutPeakLabels(spread)).toHaveLength(3);
    });

    it('never prints two names on top of one another', () => {
        const slots: PeakLabelSlot[] = [];
        for (let i = 0; i < 40; i++) slots.push(slot(`p${i}`, 200 + i * 7, 300 + (i % 5) * 40));
        const placed = layoutPeakLabels(slots);
        expect(placed.length).toBeLessThan(slots.length);
        for (let i = 1; i < placed.length; i++) {
            expect(lane(placed[i]) - lane(placed[i - 1])).toBeGreaterThanOrEqual(LINE_BOX_PX);
        }
    });

    it('gives a larger name more room than a plain one', () => {
        // 21 px apart: enough for two 12 px names, not once one of them is set in 14 px.
        expect(layoutPeakLabels([slot('a', 100), slot('b', 121)])).toHaveLength(2);
        expect(layoutPeakLabels([slot('a', 100, 300, 0.1, 14), slot('b', 121)])).toHaveLength(1);
    });

    it('keeps a larger name clear of the top of the canvas', () => {
        const plain = layoutPeakLabels([slot('a', 100, 150)]);
        const large = layoutPeakLabels([slot('a', 100, 180, 0.5, 14)]);
        expect(large[0].anchorY).toBeGreaterThan(plain[0].anchorY);
    });

    it('returns the names in screen order, whatever order the sightings arrive in', () => {
        const placed = layoutPeakLabels([slot('right', 400), slot('left', 100)]);
        expect(placed.map((p) => p.key)).toEqual(['left', 'right']);
    });

    it('survives an empty ridge', () => {
        expect(layoutPeakLabels([])).toEqual([]);
    });
});
