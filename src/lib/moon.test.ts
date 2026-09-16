import { brightLimbDirection, moonEcliptic, moonEquatorial, moonState } from '@/lib/moon';
import { describe, expect, it } from 'vitest';

/**
 * Meeus, *Astronomical Algorithms*, worked example 47.a — and 48.a, which uses
 * the same instant. This is the only way to tell a truncated series that is
 * merely imprecise from one with a wrong coefficient: both look plausible on
 * screen, and only the reference tells them apart.
 */
const MEEUS_EXAMPLE = new Date(Date.UTC(1992, 3, 12));

describe('moonEcliptic', () => {
    it('matches Meeus example 47.a within the truncation error', () => {
        const { longitudeDeg, latitudeDeg, distanceKm } = moonEcliptic(MEEUS_EXAMPLE);
        // Full series: 133.162655°, −3.229126°, 368409.7 km. The truncation
        // costs 0.03′ in longitude and latitude — 1/500 of the lunar disc.
        expect(Math.abs(longitudeDeg - 133.162655) * 60).toBeLessThan(0.05);
        expect(Math.abs(latitudeDeg + 3.229126) * 60).toBeLessThan(0.05);
        expect(Math.abs(distanceKm - 368409.7)).toBeLessThan(5);
    });

    it('keeps the distance inside the real perigee/apogee range over a year', () => {
        for (let day = 0; day < 365; day += 1) {
            const date = new Date(Date.UTC(2026, 0, 1 + day));
            const { distanceKm, latitudeDeg } = moonEcliptic(date);
            expect(distanceKm).toBeGreaterThan(356000);
            expect(distanceKm).toBeLessThan(407000);
            // The orbit is inclined 5.1° on the ecliptic; nothing can exceed it
            // by more than the ~0.3° the perturbations add.
            expect(Math.abs(latitudeDeg)).toBeLessThan(5.5);
        }
    });

    it('advances about 13.2° of longitude a day', () => {
        const a = moonEcliptic(new Date(Date.UTC(2026, 5, 1)));
        const b = moonEcliptic(new Date(Date.UTC(2026, 5, 2)));
        const delta = ((b.longitudeDeg - a.longitudeDeg) % 360 + 360) % 360;
        expect(delta).toBeGreaterThan(11);
        expect(delta).toBeLessThan(15);
    });
});

describe('moonEquatorial', () => {
    it('matches Meeus example 47.a in right ascension and declination', () => {
        const { ra, dec } = moonEquatorial(MEEUS_EXAMPLE);
        const deg = 180 / Math.PI;
        // Full series: α = 134.688470°, δ = 13.768368°. The extra 0.3′ on α
        // comes from the nutation this skips — a fiftieth of the disc.
        expect(Math.abs(((ra * deg) % 360 + 360) % 360 - 134.68847) * 60).toBeLessThan(0.5);
        expect(Math.abs(dec * deg - 13.768368) * 60).toBeLessThan(0.2);
    });
});

describe('moonState', () => {
    const CHAMONIX = { lat: 45.92, lng: 6.87 };

    it('reports Meeus example 48.a illuminated fraction', () => {
        // Full series: k = 0.6786.
        const { illuminatedFraction } = moonState(MEEUS_EXAMPLE, CHAMONIX.lat, CHAMONIX.lng);
        expect(illuminatedFraction).toBeCloseTo(0.6786, 2);
    });

    it('sweeps the whole phase range over a lunation', () => {
        let min = 1;
        let max = 0;
        for (let day = 0; day < 30; day += 1) {
            const date = new Date(Date.UTC(2026, 2, 1 + day));
            const k = moonState(date, CHAMONIX.lat, CHAMONIX.lng).illuminatedFraction;
            min = Math.min(min, k);
            max = Math.max(max, k);
        }
        expect(min).toBeLessThan(0.02);
        expect(max).toBeGreaterThan(0.98);
    });

    it('keeps the apparent radius inside the real 0.245°–0.28° range', () => {
        for (let day = 0; day < 30; day += 1) {
            const date = new Date(Date.UTC(2026, 2, 1 + day));
            const { angularRadiusDeg } = moonState(date, CHAMONIX.lat, CHAMONIX.lng);
            expect(angularRadiusDeg).toBeGreaterThan(0.24);
            expect(angularRadiusDeg).toBeLessThan(0.29);
        }
    });

    it('lowers a moon near the horizon by the parallax, nearly a degree', () => {
        // Scan a day and keep the sample closest to the horizon, where the
        // parallax is at its largest and the correction is easiest to read.
        const deg = 180 / Math.PI;
        let closest = { gap: 90, drop: 0 };
        for (let minute = 0; minute < 1440; minute += 5) {
            const date = new Date(Date.UTC(2026, 2, 3, 0, minute));
            const { position } = moonState(date, CHAMONIX.lat, CHAMONIX.lng);
            const geocentricDeg = geocentricElevationDeg(date, CHAMONIX.lat, CHAMONIX.lng);
            const gap = Math.abs(position.elevation * deg);
            if (gap < closest.gap) {
                closest = { gap, drop: geocentricDeg - position.elevation * deg };
            }
        }
        // 0.95° of parallax, minus 0.48° of refraction that lifts it back.
        expect(closest.drop).toBeGreaterThan(0.3);
        expect(closest.drop).toBeLessThan(0.7);
    });
});

/** Uncorrected elevation, to measure what `moonState` takes off it. */
function geocentricElevationDeg(date: Date, lat: number, lng: number): number {
    const eq = moonEquatorial(date);
    const rad = Math.PI / 180;
    const n = date.getTime() / 86400000 + 2440587.5 - 2451545;
    const gmstHours = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
    const H = (gmstHours * 15 + lng) * rad - eq.ra;
    const phi = lat * rad;
    const sinEl = Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, sinEl))) / rad;
}

describe('brightLimbDirection', () => {
    it('is perpendicular to the moon and points towards the sun', () => {
        const moonDir = [0, 1, 0];
        const sunDir = [0.6, 0.8, 0];
        const limb = brightLimbDirection(moonDir, sunDir);
        expect(limb[0] * moonDir[0] + limb[1] * moonDir[1] + limb[2] * moonDir[2]).toBeCloseTo(0, 9);
        expect(Math.hypot(...limb)).toBeCloseTo(1, 9);
        // The sun is to the east, so the lit limb is the eastern one.
        expect(limb[0]).toBeCloseTo(1, 6);
    });

    it('points up when the sun is below a moon high in the sky', () => {
        const limb = brightLimbDirection([0, 0, 1], [0, 1, 0]);
        expect(limb[1]).toBeCloseTo(1, 6);
    });

    it('falls back to a valid unit vector when the sun is exactly aligned', () => {
        const limb = brightLimbDirection([0, 0, 1], [0, 0, 1]);
        expect(Math.hypot(...limb)).toBeCloseTo(1, 9);
    });
});
