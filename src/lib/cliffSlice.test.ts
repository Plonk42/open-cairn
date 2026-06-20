import { describe, expect, it } from 'vitest';
import {
    extractSliceProfile,
    lngLatToLocalMeters,
    mergeSliceProfiles,
    ropeBetween,
    ropeSegments,
    ropeTotals,
    snapToProfile,
    type SliceSource,
} from '@/lib/cliffSlice';
import type { LngLatTuple } from '@/lib/geo';

const METERS_PER_DEGREE_LAT = 111_319.491;
/** lng offset (at lat 0) that maps to a given easting in metres. */
const eastingToLng = (m: number) => m / METERS_PER_DEGREE_LAT;

describe('lngLatToLocalMeters', () => {
    it('maps the reference point to the origin', () => {
        expect(lngLatToLocalMeters(6.87, 45.92, 6.87, 45.92)).toEqual([0, 0]);
    });

    it('produces positive east for points to the right of the reference', () => {
        const [east, north] = lngLatToLocalMeters(eastingToLng(10), 0, 0, 0);
        expect(east).toBeCloseTo(10, 3);
        expect(north).toBeCloseTo(0, 6);
    });

    it('scales northing by the latitude-independent constant', () => {
        const [, north] = lngLatToLocalMeters(0, 1, 0, 0);
        expect(north).toBeCloseTo(METERS_PER_DEGREE_LAT, 0);
    });
});

// A synthetic cloud centred at (0,0); positions are already local east/north/alt.
function makeSource(): SliceSource {
    return {
        centerLng: 0,
        centerLat: 0,
        positions: new Float32Array([
            2, 0, 100, // on the line, d=2
            5, 0.5, 110, // within a 1 m corridor, d=5
            5, 5, 120, // far outside the corridor (depth 5)
            -1, 0, 90, // before the start (t < 0)
            12, 0, 130, // past the end (t > length)
        ]),
        classifications: new Uint8Array([2, 5, 2, 2, 2]),
        pointCount: 5,
    };
}

const START: LngLatTuple = [0, 0];
const END: LngLatTuple = [eastingToLng(10), 0];

describe('extractSliceProfile', () => {
    it('keeps only points inside the corridor and the [0, length] span', () => {
        const profile = extractSliceProfile(makeSource(), START, END, 1);
        expect(profile.length).toBeCloseTo(10, 3);
        expect(profile.points).toHaveLength(2);
        expect(profile.eMin).toBe(100);
        expect(profile.eMax).toBe(110);
    });

    it('records distance-along-line and signed perpendicular depth', () => {
        const profile = extractSliceProfile(makeSource(), START, END, 1);
        const sorted = profile.sorted;
        expect(sorted[0].d).toBeCloseTo(2, 3);
        expect(sorted[0].depth).toBeCloseTo(0, 3);
        expect(sorted[1].d).toBeCloseTo(5, 3);
        expect(sorted[1].depth).toBeCloseTo(0.5, 3);
    });

    it('applies the class filter', () => {
        const profile = extractSliceProfile(makeSource(), START, END, 1, new Set([2]));
        expect(profile.points).toHaveLength(1);
        expect(profile.points[0].cls).toBe(2);
    });

    it('returns an empty profile for a degenerate (too short) line', () => {
        const profile = extractSliceProfile(makeSource(), START, START, 1);
        expect(profile.points).toHaveLength(0);
    });
});

describe('mergeSliceProfiles', () => {
    it('returns the other profile when one is empty', () => {
        const full = extractSliceProfile(makeSource(), START, END, 1);
        const empty = extractSliceProfile(makeSource(), START, START, 1);
        expect(mergeSliceProfiles(empty, full)).toBe(full);
        expect(mergeSliceProfiles(full, empty)).toBe(full);
    });

    it('concatenates points and recomputes the elevation extent', () => {
        const a = extractSliceProfile(makeSource(), START, END, 1, new Set([2]));
        const b = extractSliceProfile(makeSource(), START, END, 1, new Set([5]));
        const merged = mergeSliceProfiles(a, b);
        expect(merged.points).toHaveLength(2);
        expect(merged.eMin).toBe(100);
        expect(merged.eMax).toBe(110);
        // sorted ascending by d
        expect(merged.sorted[0].d).toBeLessThanOrEqual(merged.sorted[1].d);
    });
});

describe('snapToProfile', () => {
    it('returns null for an empty profile', () => {
        const empty = extractSliceProfile(makeSource(), START, START, 1);
        expect(snapToProfile(empty, 0, 0)).toBeNull();
    });

    it('finds the nearest point in (d, e) space', () => {
        const profile = extractSliceProfile(makeSource(), START, END, 1);
        const snapped = snapToProfile(profile, 2.1, 100.2);
        expect(snapped?.d).toBeCloseTo(2, 3);
        expect(snapped?.e).toBe(100);
    });
});

describe('ropeBetween', () => {
    it('computes a 3-4-5 pitch with a safety margin', () => {
        const seg = ropeBetween({ id: 'a', d: 0, e: 0 }, { id: 'b', d: 3, e: 4 }, 0.15);
        expect(seg.run).toBe(3);
        expect(seg.rise).toBe(4);
        expect(seg.direct).toBeCloseTo(5, 6);
        expect(seg.rope).toBeCloseTo(5.75, 6);
        expect(seg.angle).toBeCloseTo(53.13, 1);
        expect(seg.overhang).toBe(false);
    });

    it('flags an overhang when climbing while moving backward', () => {
        const seg = ropeBetween({ id: 'a', d: 0, e: 0 }, { id: 'b', d: -1, e: 2 }, 0.15);
        expect(seg.overhang).toBe(true);
        expect(seg.run).toBeLessThan(0);
        expect(seg.rise).toBeGreaterThan(0);
    });
});

describe('ropeSegments + ropeTotals', () => {
    const stations = [
        { id: 's0', d: 0, e: 0 },
        { id: 's1', d: 0, e: 10 },
        { id: 's2', d: 0, e: 6 },
    ];

    it('produces one segment per consecutive station pair', () => {
        expect(ropeSegments(stations, 0)).toHaveLength(2);
    });

    it('aggregates ascent, descent, longest and totals', () => {
        const segs = ropeSegments(stations, 0);
        const totals = ropeTotals(segs);
        expect(totals.ascent).toBe(10);
        expect(totals.descent).toBe(4);
        expect(totals.longest).toBe(10);
        expect(totals.directTotal).toBe(14);
        expect(totals.total).toBe(14); // margin 0
    });
});
