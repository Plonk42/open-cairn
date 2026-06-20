import { describe, expect, it } from 'vitest';
import { l93ToLngLat, lngLatToL93 } from '@/lib/lidarBrowser/proj';

describe('Lambert-93 projection', () => {
    it('round-trips a point in the French Alps', () => {
        const lng = 6.8652;
        const lat = 45.8326;
        const [x, y] = lngLatToL93(lng, lat);
        const [lng2, lat2] = l93ToLngLat(x, y);
        expect(lng2).toBeCloseTo(lng, 6);
        expect(lat2).toBeCloseTo(lat, 6);
    });

    it('places the projection origin near the false easting/northing', () => {
        // lon_0 = 3°, around lat_0 = 46.5°, x should be close to x_0 = 700000.
        const [x] = lngLatToL93(3, 46.5);
        expect(x).toBeCloseTo(700_000, 0);
    });

    it('increases easting as longitude increases', () => {
        const [xWest] = lngLatToL93(5, 45);
        const [xEast] = lngLatToL93(6, 45);
        expect(xEast).toBeGreaterThan(xWest);
    });
});
