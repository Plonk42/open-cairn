import { apparentSunPosition } from '@/lib/sun';
import {
    buildSunPathGeometry,
    sampleSunPath,
    SUN_ANGULAR_RADIUS_DEG,
    SUN_PATH_FLOATS_PER_VERTEX,
} from '@/lib/sunPath';
import { describe, expect, it } from 'vitest';

const CHAMONIX = { lat: 45.92, lng: 6.87 };
const DEG = 180 / Math.PI;

describe('sampleSunPath', () => {
    it('covers the whole day, endpoints included', () => {
        const samples = sampleSunPath('2026-06-21', CHAMONIX.lat, CHAMONIX.lng, 30);
        expect(samples[0].minutesOfDay).toBe(0);
        expect(samples.at(-1)?.minutesOfDay).toBe(1440);
        expect(samples).toHaveLength(49);
    });

    it('returns unit direction vectors consistent with the azimuth/elevation', () => {
        for (const s of sampleSunPath('2026-06-21', CHAMONIX.lat, CHAMONIX.lng, 120)) {
            expect(Math.hypot(...s.dir)).toBeCloseTo(1, 9);
            expect(Math.asin(s.dir[2]) * DEG).toBeCloseTo(s.elevationDeg, 9);
            expect(Math.atan2(s.dir[0], s.dir[1]) * DEG).toBeCloseTo(
                s.azimuthDeg > 180 ? s.azimuthDeg - 360 : s.azimuthDeg,
                9,
            );
        }
    });

    it('reports the APPARENT elevation, like the rest of the sun pipeline', () => {
        const [first] = sampleSunPath('2026-06-21', CHAMONIX.lat, CHAMONIX.lng, 720);
        const expected = apparentSunPosition(new Date('2026-06-21T00:00'), CHAMONIX.lat, CHAMONIX.lng);
        expect(first.elevationDeg).toBeCloseTo(expected.elevation * DEG, 9);
    });

    it('culminates around solar noon and stays below the horizon at night', () => {
        const samples = sampleSunPath('2026-06-21', CHAMONIX.lat, CHAMONIX.lng, 10);
        const highest = samples.reduce((a, b) => (b.elevationDeg > a.elevationDeg ? b : a));
        // 13:34 local (CEST) — solar noon plus the equation of time. The sample
        // grid is 10 min wide and the azimuth sweeps 0.57°/min at culmination,
        // so the nearest sample lands within a few degrees of due south.
        expect(highest.minutesOfDay).toBeGreaterThan(13 * 60);
        expect(highest.minutesOfDay).toBeLessThan(14 * 60);
        expect(Math.abs(highest.azimuthDeg - 180)).toBeLessThan(3);
        expect(samples[0].elevationDeg).toBeLessThan(0);
    });

    it('returns nothing without a usable date or location', () => {
        expect(sampleSunPath('', CHAMONIX.lat, CHAMONIX.lng)).toEqual([]);
        expect(sampleSunPath('2026-06-21', Number.NaN, CHAMONIX.lng)).toEqual([]);
    });
});

describe('buildSunPathGeometry', () => {
    const samples = sampleSunPath('2026-06-21', CHAMONIX.lat, CHAMONIX.lng, 60);

    it('emits one six-vertex quad per segment', () => {
        const { track } = buildSunPathGeometry(samples);
        expect(track.length / SUN_PATH_FLOATS_PER_VERTEX).toBe((samples.length - 1) * 6);
    });

    it('accumulates the arc length monotonically over ~360° in a day', () => {
        const { track } = buildSunPathGeometry(samples);
        const stride = SUN_PATH_FLOATS_PER_VERTEX;
        let previous = -1;
        for (let v = 0; v < track.length / stride; v += 6) {
            const arc = track[v * stride + 8];
            expect(arc).toBeGreaterThanOrEqual(previous);
            previous = arc;
        }
        // A day traces a small circle of 360°·cos(δ) ≈ 330° at the solstice, and
        // the chords of an hourly polyline measure a little less than that.
        expect(previous).toBeGreaterThan(300);
        expect(previous).toBeLessThan(360);
    });

    it('marks every whole hour with a tick', () => {
        const { ticks } = buildSunPathGeometry(samples);
        expect(ticks.length / SUN_PATH_FLOATS_PER_VERTEX).toBe(24 * 6);
    });

    it('builds ticks shorter than the solar disc is wide, so they never mask it', () => {
        const { ticks } = buildSunPathGeometry(samples);
        const a = [ticks[0], ticks[1], ticks[2]];
        const b = [ticks[3], ticks[4], ticks[5]];
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const lengthDeg = Math.acos(Math.min(1, dot)) * DEG;
        expect(lengthDeg).toBeGreaterThan(SUN_ANGULAR_RADIUS_DEG);
        expect(lengthDeg).toBeLessThan(5);
    });

    it('yields empty buffers rather than throwing on a degenerate path', () => {
        const { track, ticks } = buildSunPathGeometry([]);
        expect(track).toHaveLength(0);
        expect(ticks).toHaveLength(0);
    });
});
