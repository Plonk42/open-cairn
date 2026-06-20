import { describe, expect, it } from 'vitest';
import {
    computeSunPosition,
    formatSunDate,
    parseSunDate,
    sunDirectionVector,
    sunLighting,
} from '@/lib/sun';

describe('parseSunDate', () => {
    it('extracts the date part and minutes-of-day', () => {
        expect(parseSunDate('2026-06-21T14:30')).toEqual({
            datePart: '2026-06-21',
            minutesOfDay: 14 * 60 + 30,
        });
    });

    it('defaults to noon when the time is missing', () => {
        expect(parseSunDate('2026-06-21')).toEqual({
            datePart: '2026-06-21',
            minutesOfDay: 720,
        });
    });

    it('clamps an out-of-range time to the last minute of the day', () => {
        expect(parseSunDate('2026-06-21T99:99').minutesOfDay).toBe(1439);
    });

    it('returns an empty date part for unparseable input', () => {
        expect(parseSunDate('not-a-date')).toEqual({ datePart: '', minutesOfDay: 720 });
    });
});

describe('formatSunDate', () => {
    it('zero-pads hours and minutes', () => {
        expect(formatSunDate('2026-01-02', 9 * 60 + 5)).toBe('2026-01-02T09:05');
    });

    it('round-trips with parseSunDate', () => {
        const input = '2026-12-31T23:59';
        const { datePart, minutesOfDay } = parseSunDate(input);
        expect(formatSunDate(datePart, minutesOfDay)).toBe(input);
    });
});

describe('sunDirectionVector', () => {
    it('points straight up at the zenith', () => {
        const v = sunDirectionVector({ azimuth: 0, elevation: Math.PI / 2 });
        expect(v[0]).toBeCloseTo(0, 6);
        expect(v[1]).toBeCloseTo(0, 6);
        expect(v[2]).toBeCloseTo(1, 6);
    });

    it('returns a unit-length vector', () => {
        const v = sunDirectionVector({ azimuth: 1.2, elevation: 0.4 });
        const len = Math.hypot(v[0], v[1], v[2]);
        expect(len).toBeCloseTo(1, 6);
    });

    it('points east for an azimuth of 90 degrees at the horizon', () => {
        const v = sunDirectionVector({ azimuth: Math.PI / 2, elevation: 0 });
        expect(v[0]).toBeCloseTo(1, 6);
        expect(v[1]).toBeCloseTo(0, 6);
        expect(v[2]).toBeCloseTo(0, 6);
    });
});

describe('computeSunPosition', () => {
    it('puts the sun high in the sky at solar noon in summer (Chamonix)', () => {
        // ~12:00 UTC on the summer solstice; sun should be well above horizon.
        const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
        const { elevation } = computeSunPosition(date, 45.92, 6.87);
        expect(elevation).toBeGreaterThan(1); // > ~57°
    });

    it('puts the sun below the horizon at local midnight', () => {
        const date = new Date(Date.UTC(2026, 5, 21, 0, 0, 0));
        const { elevation } = computeSunPosition(date, 45.92, 6.87);
        expect(elevation).toBeLessThan(0);
    });
});

describe('sunLighting', () => {
    it('reports zero intensity at night', () => {
        const date = new Date(Date.UTC(2026, 11, 21, 0, 0, 0));
        const light = sunLighting(date, 45.92, 6.87);
        expect(light.intensity).toBe(0);
        expect(light.elevationDeg).toBeLessThan(0);
    });

    it('reports full intensity for a high sun and a normalized azimuth', () => {
        const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
        const light = sunLighting(date, 45.92, 6.87);
        expect(light.intensity).toBe(1);
        expect(light.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(light.azimuthDeg).toBeLessThan(360);
    });
});
