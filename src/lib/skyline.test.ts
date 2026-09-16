import { describe, expect, it } from 'vitest';
import {
    findSkyCrossings,
    formatCrossingTime,
    skylineAt,
    type GroundSampler,
    type SkylineObserver,
} from './skyline';

const OBSERVER: SkylineObserver = { lng: 6.0, lat: 45.0, altitudeM: 1000 };

/** Flat ground at sea level everywhere. */
const flat = (height: number): GroundSampler => () => height;

describe('skylineAt', () => {
    it('reports a horizon just below eye level over flat ground at the same height', () => {
        // Same height as the eye, so only Earth curvature separates them: the
        // farthest probe wins and its drop puts it a fraction of a degree down.
        const sky = skylineAt(OBSERVER, 0, flat(1000));
        expect(sky.elevationDeg).toBeLessThan(0);
        expect(sky.elevationDeg).toBeGreaterThan(-0.2);
    });

    it('dips the horizon further the higher the eye stands', () => {
        const low = skylineAt({ ...OBSERVER, altitudeM: 200 }, 0, flat(0));
        const high = skylineAt({ ...OBSERVER, altitudeM: 3000 }, 0, flat(0));
        expect(high.elevationDeg).toBeLessThan(low.elevationDeg);
        // Textbook apparent dip, sqrt(2h(1-k)/R): 0.42° at 200 m, 1.64° at 3 000 m.
        expect(low.elevationDeg).toBeCloseTo(-0.42, 1);
        expect(high.elevationDeg).toBeCloseTo(-1.64, 1);
    });

    it('finds a wall that blocks one azimuth and misses it in the opposite one', () => {
        // A 500 m step 2 km due north of the observer.
        const wall: GroundSampler = (_lng, lat) => (lat > OBSERVER.lat + 0.017 ? 1500 : 1000);
        const north = skylineAt(OBSERVER, 0, wall);
        const south = skylineAt(OBSERVER, 180, wall);
        expect(north.elevationDeg).toBeGreaterThan(5);
        expect(north.distanceM).toBeGreaterThan(1500);
        expect(north.distanceM).toBeLessThan(3000);
        expect(south.elevationDeg).toBeLessThan(0);
    });

    it('returns the ridge it found, not the observer, so a label can anchor to it', () => {
        const wall: GroundSampler = (_lng, lat) => (lat > OBSERVER.lat + 0.017 ? 1500 : 1000);
        const north = skylineAt(OBSERVER, 0, wall);
        expect(north.groundM).toBe(1500);
        expect(north.lat).toBeGreaterThan(OBSERVER.lat);
        expect(north.lng).toBeCloseTo(OBSERVER.lng, 6);
    });

    it('treats a blind DEM as open sky rather than as ground at zero', () => {
        const blind = skylineAt(OBSERVER, 0, () => Number.NaN);
        expect(blind.elevationDeg).toBe(-90);
    });
});

/** A body that rises due east, culminates due south and sets due west. */
function idealDay(maxElevationDeg: number) {
    return (minutesOfDay: number) => {
        const hourAngle = ((minutesOfDay - 720) / 720) * Math.PI;
        return {
            azimuthDeg: 90 + (minutesOfDay / 1440) * 360,
            elevationDeg: maxElevationDeg * Math.cos(hourAngle),
        };
    };
}

const openSky = () => ({ elevationDeg: 0, distanceM: 0, lng: 0, lat: 0, groundM: 0 });

describe('findSkyCrossings', () => {
    it('finds a symmetric rise and set around noon on an open horizon', () => {
        const { rise, set } = findSkyCrossings(idealDay(40), openSky);
        expect(rise?.minutesOfDay).toBeCloseTo(360, 0);
        expect(set?.minutesOfDay).toBeCloseTo(1080, 0);
    });

    it('delays the rise and advances the set when a ridge stands in the way', () => {
        const ridge = () => ({ ...openSky(), elevationDeg: 20 });
        const open = findSkyCrossings(idealDay(40), openSky);
        const blocked = findSkyCrossings(idealDay(40), ridge);
        expect(blocked.rise!.minutesOfDay).toBeGreaterThan(open.rise!.minutesOfDay);
        expect(blocked.set!.minutesOfDay).toBeLessThan(open.set!.minutesOfDay);
    });

    it('reports nothing when the body never clears the relief', () => {
        const wall = () => ({ ...openSky(), elevationDeg: 60 });
        expect(findSkyCrossings(idealDay(40), wall)).toEqual({ rise: null, set: null });
    });

    it('keeps the ridge point of the crossing, not of the coarse sample', () => {
        const ridge = () => ({ elevationDeg: 20, distanceM: 4200, lng: 6.1, lat: 45.1, groundM: 2400 });
        const { set } = findSkyCrossings(idealDay(40), ridge);
        expect(set?.point.groundM).toBe(2400);
        expect(set?.point.distanceM).toBe(4200);
    });

    it('keeps the first rise and the last set when a peak hides the body at midday', () => {
        // The body is out from ~418 to ~1022 over a 10° ridge, but a 45° peak
        // stands in the azimuths it crosses around noon: four crossings in all.
        const jagged = (azimuthDeg: number) => ({
            ...openSky(),
            elevationDeg: azimuthDeg > 260 && azimuthDeg < 280 ? 45 : 10,
        });
        const { rise, set } = findSkyCrossings(idealDay(40), jagged);
        expect(rise!.minutesOfDay).toBeCloseTo(418, -1);
        expect(set!.minutesOfDay).toBeCloseTo(1022, -1);
    });
});

describe('formatCrossingTime', () => {
    it('rounds to the displayed minute and pads both fields', () => {
        expect(formatCrossingTime(7 * 60 + 5.4)).toBe('07:05');
        expect(formatCrossingTime(19 * 60 + 47.6)).toBe('19:48');
    });

    it('wraps midnight instead of showing a 24th hour', () => {
        expect(formatCrossingTime(1440)).toBe('00:00');
    });
});
