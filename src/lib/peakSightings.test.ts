import { describe, expect, it } from 'vitest';
import type { Peak } from './peaks';
import {
    LABEL_ANGLE_DEG,
    labelPriority,
    layoutPeakLabels,
    selectCandidates,
    sightPeaks,
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
        const kept = selectCandidates(OBSERVER, [peakNorth('major', far, 1)]);
        const dropped = selectCandidates(OBSERVER, [peakNorth('minor', far, 4)]);
        expect(kept.map((c) => c.peak.id)).toEqual(['major']);
        expect(dropped).toEqual([]);
    });

    it('keeps a minor summit once it is close enough to be checked', () => {
        const close = selectCandidates(OBSERVER, [peakNorth('minor', 5_000, 4)]);
        expect(close.map((c) => c.peak.id)).toEqual(['minor']);
    });

    it('reads the azimuth in the same frame the ray march walks', () => {
        const [north] = selectCandidates(OBSERVER, [peakNorth('n', 5_000)]);
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
        expect(selectCandidates(OBSERVER, [east])[0].azimuthDeg).toBeCloseTo(90, 3);
    });

    it('caps the marching budget', () => {
        const many: Peak[] = [];
        for (let i = 0; i < 2_000; i++) many.push(peakNorth(`minor-${i}`, 5_000 + i, 4));
        expect(selectCandidates(OBSERVER, many)).toHaveLength(900);
    });

    it('spends the budget on a nearby minor summit before a distant notorious one', () => {
        const selected = selectCandidates(OBSERVER, [
            peakNorth('far-major', 50_000, 1),
            peakNorth('near-minor', 2_000, 4),
        ]);
        expect(selected.map((c) => c.peak.id)).toEqual(['near-minor', 'far-major']);
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
        // is exactly the case the self-clearance margin exists for.
        const dome = peakNorth('dome', 8_000);
        const sample: GroundSampler = (_lng, lat) => {
            const dM = Math.abs(lat - dome.lat) * METRES_PER_DEG_LAT;
            return dM > 2_000 ? 1_000 : 2_000 - (dM / 2_000) * 1_000;
        };
        expect(sightPeaks(OBSERVER, [dome], sample).map((s) => s.peak.id)).toEqual(['dome']);
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

    it('points the direction vector east for a summit due east', () => {
        const east: Peak = {
            id: 'e',
            name: 'e',
            lng: OBSERVER.lng + 0.05,
            lat: OBSERVER.lat,
            importance: 1,
            spotHeightM: null,
        };
        const [seen] = sightPeaks(OBSERVER, [east], summits(3_000, [east]));
        const [x, y, z] = seen.dir;
        // 2 000 m up over ~3.9 km is a steep but real 27°, so the direction is
        // mostly east with a solid tilt upwards.
        expect(Math.abs(y)).toBeLessThan(0.01);
        expect(x).toBeCloseTo(Math.cos(27 * (Math.PI / 180)), 2);
        expect(z).toBeCloseTo(Math.sin(27 * (Math.PI / 180)), 2);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    });
});

describe('labelPriority', () => {
    it('keeps the Mont Blanc over the knoll that used to evict it', () => {
        // From Chamechaude the two land 16 px apart, and the fraction alone put
        // the Dent du Corbeau first: 0.58 of a rank-2 reach against 0.69 of a
        // rank-1 one.
        const montBlanc = { ...peakNorth('Mont Blanc', 1, 1), importance: 1 };
        const corbeau = { ...peakNorth('Dent du Corbeau', 1, 2), importance: 2 };
        expect(labelPriority(montBlanc, 104_000)).toBeLessThan(labelPriority(corbeau, 58_000));
    });

    it('separates equals by how far they reach for their rank', () => {
        const near = peakNorth('near', 1, 2);
        const far = peakNorth('far', 1, 2);
        expect(labelPriority(near, 20_000)).toBeLessThan(labelPriority(far, 90_000));
    });
});

describe('layoutPeakLabels', () => {
    const slot = (key: string, x: number, y = 300, priority = 0.5): PeakLabelSlot =>
        ({ key, x, y, priority });

    const RAD = Math.PI / 180;
    /** Signed offset of a label's strip across its own direction, in pixels. */
    const lane = (p: PlacedPeakLabel) =>
        p.anchorX * Math.sin(-LABEL_ANGLE_DEG * RAD) + p.anchorY * Math.cos(-LABEL_ANGLE_DEG * RAD);
    /** The 12 px line box plus the halo the overlay paints under the glyphs. */
    const LINE_BOX_PX = 15.5;

    it('hangs every name from one band, clear of the highest summit on screen', () => {
        const placed = layoutPeakLabels([slot('high', 100, 240), slot('low', 400, 520)]);
        expect(placed.map((p) => p.anchorY)).toEqual([placed[0].anchorY, placed[0].anchorY]);
        expect(placed[0].anchorY).toBeLessThan(240);
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
        const crowded = [slot('a', 100), slot('b', 112), slot('c', 124)];
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

    it('returns the names in screen order, whatever order the sightings arrive in', () => {
        const placed = layoutPeakLabels([slot('right', 400), slot('left', 100)]);
        expect(placed.map((p) => p.key)).toEqual(['left', 'right']);
    });

    it('survives an empty ridge', () => {
        expect(layoutPeakLabels([])).toEqual([]);
    });
});
