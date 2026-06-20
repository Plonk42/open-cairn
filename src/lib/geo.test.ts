import { describe, expect, it } from 'vitest';
import {
    dedupeAdjacentCoordinates,
    distanceMeters,
    formatDistance,
    formatElevation,
    interpolateAlongLine,
    lineDistanceMeters,
    sliceLineByDistance,
    type LngLatTuple,
} from '@/lib/geo';

describe('distanceMeters', () => {
    it('returns 0 for identical points', () => {
        expect(distanceMeters([5, 45], [5, 45])).toBe(0);
    });

    it('matches a known one-degree-of-latitude distance (~111 km)', () => {
        const d = distanceMeters([0, 0], [0, 1]);
        expect(d).toBeGreaterThan(111_000);
        expect(d).toBeLessThan(111_400);
    });

    it('is symmetric', () => {
        const a: LngLatTuple = [6.86, 45.83];
        const b: LngLatTuple = [5.74, 45.29];
        expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
    });
});

describe('lineDistanceMeters', () => {
    it('returns 0 for fewer than two points', () => {
        expect(lineDistanceMeters([])).toBe(0);
        expect(lineDistanceMeters([[5, 45]])).toBe(0);
    });

    it('sums segment distances', () => {
        const coords: LngLatTuple[] = [
            [0, 0],
            [0, 1],
            [0, 2],
        ];
        const expected = distanceMeters([0, 0], [0, 1]) + distanceMeters([0, 1], [0, 2]);
        expect(lineDistanceMeters(coords)).toBeCloseTo(expected, 6);
    });
});

describe('dedupeAdjacentCoordinates', () => {
    it('removes consecutive duplicates only', () => {
        const coords: LngLatTuple[] = [
            [0, 0],
            [0, 0],
            [1, 1],
            [1, 1],
            [0, 0],
        ];
        expect(dedupeAdjacentCoordinates(coords)).toEqual([
            [0, 0],
            [1, 1],
            [0, 0],
        ]);
    });

    it('keeps the first element', () => {
        expect(dedupeAdjacentCoordinates([[2, 3]])).toEqual([[2, 3]]);
    });
});

describe('interpolateAlongLine', () => {
    const line: LngLatTuple[] = [
        [0, 0],
        [0, 1],
    ];

    it('returns null for an empty line', () => {
        expect(interpolateAlongLine([], 100)).toBeNull();
    });

    it('clamps to the first point for non-positive distance', () => {
        expect(interpolateAlongLine(line, 0)).toEqual([0, 0]);
        expect(interpolateAlongLine(line, -50)).toEqual([0, 0]);
    });

    it('interpolates to the midpoint at half the length', () => {
        const total = distanceMeters([0, 0], [0, 1]);
        const mid = interpolateAlongLine(line, total / 2);
        expect(mid).not.toBeNull();
        expect(mid![0]).toBeCloseTo(0, 6);
        expect(mid![1]).toBeCloseTo(0.5, 3);
    });

    it('returns the last point when the distance exceeds the length', () => {
        const total = distanceMeters([0, 0], [0, 1]);
        expect(interpolateAlongLine(line, total * 2)).toEqual([0, 1]);
    });
});

describe('sliceLineByDistance', () => {
    const line: LngLatTuple[] = [
        [0, 0],
        [0, 1],
        [0, 2],
    ];

    it('returns an empty array for invalid ranges', () => {
        expect(sliceLineByDistance(line, 100, 100)).toEqual([]);
        expect(sliceLineByDistance(line, 200, 100)).toEqual([]);
        expect(sliceLineByDistance([[0, 0]], 0, 100)).toEqual([]);
    });

    it('returns a sub-line bounded by the requested distances', () => {
        const total = lineDistanceMeters(line);
        const result = sliceLineByDistance(line, total * 0.25, total * 0.75);
        expect(result.length).toBeGreaterThanOrEqual(2);
        // First and last points should sit on the central meridian.
        expect(result[0][0]).toBeCloseTo(0, 6);
        expect(result.at(-1)![0]).toBeCloseTo(0, 6);
        // Latitude span should be roughly half the total (0.5 of 2 degrees).
        expect(result.at(-1)![1] - result[0][1]).toBeCloseTo(1, 1);
    });
});

describe('formatDistance', () => {
    it('formats sub-kilometre distances in metres', () => {
        expect(formatDistance(0)).toBe('0 m');
        expect(formatDistance(523.4)).toBe('523 m');
        expect(formatDistance(999)).toBe('999 m');
    });

    it('formats kilometres with two decimals below 10 km', () => {
        expect(formatDistance(1500)).toBe('1.50 km');
        expect(formatDistance(9999)).toBe('10.00 km');
    });

    it('formats kilometres with one decimal at or above 10 km', () => {
        expect(formatDistance(10_000)).toBe('10.0 km');
        expect(formatDistance(25_400)).toBe('25.4 km');
    });
});

describe('formatElevation', () => {
    it('rounds to whole metres', () => {
        expect(formatElevation(1234.6)).toBe('1235 m');
        expect(formatElevation(0)).toBe('0 m');
    });
});
