import {
    computeSunPosition,
    formatSunDate,
    parseSunDate,
    sunDirectionVector,
    sunLight,
    sunSettingsAt,
} from '@/lib/sun';
import { describe, expect, it } from 'vitest';

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

describe('sunSettingsAt', () => {
    it('reports zero intensity at night', () => {
        const date = new Date(Date.UTC(2026, 11, 21, 0, 0, 0));
        const s = sunSettingsAt(date, 45.92, 6.87);
        expect(s.intensity).toBe(0);
        expect(s.elevationDeg).toBeLessThan(0);
    });

    it('reports full intensity for a high sun and a normalized azimuth', () => {
        const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
        const s = sunSettingsAt(date, 45.92, 6.87);
        expect(s.intensity).toBe(1);
        expect(s.warmth).toBe(1);
        expect(s.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(s.azimuthDeg).toBeLessThan(360);
    });
});

describe('sunLight', () => {
    it('turns azimuth/elevation back into the matching direction vector', () => {
        const { dir } = sunLight({ azimuthDeg: 90, elevationDeg: 0, warmth: 1, intensity: 1 });
        expect(dir[0]).toBeCloseTo(1, 6);
        expect(dir[1]).toBeCloseTo(0, 6);
        expect(dir[2]).toBeCloseTo(0, 6);
    });

    it('lerps the tint from deep orange to neutral white along warmth', () => {
        expect(sunLight({ azimuthDeg: 0, elevationDeg: 10, warmth: 0, intensity: 1 }).color)
            .toEqual([1, 0.55, 0.3]);
        expect(sunLight({ azimuthDeg: 0, elevationDeg: 10, warmth: 1, intensity: 1 }).color)
            .toEqual([1, 0.98, 0.95]);
    });

    it('honours forced values that no real sun would produce', () => {
        // Nuit astronomique (soleil sous l'horizon) mais lumière à fond : c'est
        // exactement ce que l'override doit permettre.
        const { dir, intensity } = sunLight({ azimuthDeg: 0, elevationDeg: -30, warmth: 0.2, intensity: 1 });
        expect(dir[2]).toBeLessThan(0);
        expect(intensity).toBe(1);
    });

    it('clamps warmth and intensity to 0..1', () => {
        const light = sunLight({ azimuthDeg: 0, elevationDeg: 45, warmth: 4, intensity: -2 });
        expect(light.intensity).toBe(0);
        expect(light.color).toEqual([1, 0.98, 0.95]);
    });
});
