import { l93RectAxes, l93ToLngLat, lngLatToL93 } from '@/lib/lidarBrowser/proj';
import { rectCornersLngLat } from '@/lib/lidarCaptureRect';
import { describe, expect, it } from 'vitest';

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

describe('l93RectAxes', () => {
    it('returns a unit vector', () => {
        const { ux, uy } = l93RectAxes(6.5, 45.2, 37);
        expect(Math.hypot(ux, uy)).toBeCloseTo(1, 6);
    });

    it('points to grid north on the central meridian (lon 3°E, azimuth 0)', () => {
        // No meridian convergence at lon 3°E → length axis ≈ +Y (grid north).
        const { ux, uy } = l93RectAxes(3, 46.5, 0);
        expect(ux).toBeCloseTo(0, 3);
        expect(uy).toBeCloseTo(1, 3);
    });

    it('rotates with the azimuth (90° → grid east)', () => {
        const { ux, uy } = l93RectAxes(3, 46.5, 90);
        expect(ux).toBeCloseTo(1, 3);
        expect(uy).toBeCloseTo(0, 3);
    });

    it('reflects meridian convergence away from the central meridian', () => {
        // East of 3°E, grid north tilts: a true-north step gains a small +X
        // (east) component in Lambert-93, so the axis is not exactly (0, 1).
        const { ux } = l93RectAxes(7.5, 45, 0);
        expect(Math.abs(ux)).toBeGreaterThan(0.01);
    });
});

describe('rectCornersLngLat ↔ l93RectAxes consistency', () => {
    it('preview corners land on the crop rectangle half-extents in L93', () => {
        const lng = 6.2;
        const lat = 45.5;
        const azimuthDeg = 52;
        const widthM = 180;
        const lengthM = 420;

        const ring = rectCornersLngLat(lng, lat, azimuthDeg, widthM, lengthM);
        const [x0, y0] = lngLatToL93(lng, lat);
        const { ux, uy } = l93RectAxes(lng, lat, azimuthDeg);

        // The closing point repeats corner 0 — test the four distinct corners.
        for (const [clng, clat] of ring.slice(0, 4)) {
            const [cx, cy] = lngLatToL93(clng, clat);
            const dx = cx - x0;
            const dy = cy - y0;
            const lAxis = dx * ux + dy * uy;   // along the length axis
            const wAxis = -dx * uy + dy * ux;  // along the width axis
            expect(Math.abs(Math.abs(lAxis) - lengthM / 2)).toBeLessThan(2);
            expect(Math.abs(Math.abs(wAxis) - widthM / 2)).toBeLessThan(2);
        }
    });
});
