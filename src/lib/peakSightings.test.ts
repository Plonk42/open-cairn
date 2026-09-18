import { describe, expect, it } from 'vitest';
import type { Peak } from './peaks';
import {
    LABEL_ANGLE_DEG,
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

    it('spends the marching budget on the most notorious summits first', () => {
        const many: Peak[] = [];
        for (let i = 0; i < 400; i++) many.push(peakNorth(`minor-${i}`, 5_000 + i, 4));
        many.push(peakNorth('major', 5_000, 1));
        const selected = selectCandidates(OBSERVER, many);
        expect(selected.length).toBeLessThanOrEqual(220);
        expect(selected[0].peak.id).toBe('major');
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

describe('layoutPeakLabels', () => {
    const slot = (key: string, x: number, y = 300): PeakLabelSlot => ({ key, x, y });

    const RAD = Math.PI / 180;
    /** Signed offset of a label's strip across its own direction, in pixels. */
    const lane = (p: PlacedPeakLabel) =>
        p.anchorX * Math.sin(-LABEL_ANGLE_DEG * RAD) + p.anchorY * Math.cos(-LABEL_ANGLE_DEG * RAD);
    /** The 12 px line box plus the halo the overlay paints under the glyphs. */
    const LINE_BOX_PX = 15.5;

    it('leaves a sparse ridge exactly where it is', () => {
        const placed = layoutPeakLabels([slot('a', 100), slot('b', 400)]);
        expect(placed.map((p) => p.anchorX)).toEqual([100, 400]);
        expect(placed.map((p) => p.tipX)).toEqual([100, 400]);
    });

    it('leaves two names alone when only their height separates them', () => {
        // Same x: 300 px apart vertically, the strips are nowhere near touching
        // and the old horizontal-only rule pushed them apart for nothing.
        const placed = layoutPeakLabels([slot('low', 200, 500), slot('high', 200, 200)]);
        expect(placed.map((p) => p.anchorX)).toEqual([200, 200]);
    });

    it('lifts every name above its own summit', () => {
        const [placed] = layoutPeakLabels([slot('a', 100, 300)]);
        expect(placed.anchorY).toBeLessThan(placed.tipY);
        expect(placed.tipY).toBe(300);
    });

    it('spreads a crowded cluster rightwards without reordering it', () => {
        const placed = layoutPeakLabels([slot('a', 100), slot('b', 103), slot('c', 106)]);
        expect(placed.map((p) => p.key)).toEqual(['a', 'b', 'c']);
        for (let i = 1; i < placed.length; i++) {
            expect(lane(placed[i]) - lane(placed[i - 1])).toBeGreaterThanOrEqual(LINE_BOX_PX);
        }
        // The leader still points back at the true summit.
        expect(placed.map((p) => p.tipX)).toEqual([100, 103, 106]);
    });

    it('separates two names the horizontal gap alone declared far enough apart', () => {
        // 19 px right AND 30 px up: the strips run at -58°, so those two shifts
        // cancel and the second name lands on the first. Seen from Chamechaude.
        const placed = layoutPeakLabels([slot('near', 100, 300), slot('over', 119, 270)]);
        expect(placed).toHaveLength(2);
        expect(Math.abs(lane(placed[1]) - lane(placed[0]))).toBeGreaterThanOrEqual(LINE_BOX_PX);
    });

    it('drops the names it would have to drag too far from their summit', () => {
        const slots: PeakLabelSlot[] = [];
        for (let i = 0; i < 40; i++) slots.push(slot(`p${i}`, 200 + i));
        const placed = layoutPeakLabels(slots);
        expect(placed.length).toBeLessThan(slots.length);
        for (const p of placed) expect(p.anchorX - p.tipX).toBeLessThanOrEqual(46);
    });

    it('sorts by screen position, whatever order the sightings arrive in', () => {
        const placed = layoutPeakLabels([slot('right', 400), slot('left', 100)]);
        expect(placed.map((p) => p.key)).toEqual(['left', 'right']);
    });
});
