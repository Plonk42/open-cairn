import { l93OffsetsToGeographicEnu, l93RectAxes, l93ToLngLat, lngLatToL93 } from '@/lib/lidarBrowser/proj';
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

describe('l93OffsetsToGeographicEnu', () => {
    it('leaves offsets unchanged on the central meridian (no convergence)', () => {
        // At lon 3°E grid north = true north, so ENU === L93 offsets.
        const pos = new Float32Array([100, 50, 7, -30, 80, 3]);
        l93OffsetsToGeographicEnu(pos, 2, 3, 46.5);
        expect(pos[0]).toBeCloseTo(100, 2);
        expect(pos[1]).toBeCloseTo(50, 2);
        expect(pos[3]).toBeCloseTo(-30, 2);
        expect(pos[4]).toBeCloseTo(80, 2);
    });

    it('preserves horizontal length and height (rigid rotation about up)', () => {
        const lng = 6.004;
        const lat = 45.208;
        const dx = 120;
        const dy = -45;
        const z = 12.5;
        const pos = new Float32Array([dx, dy, z]);
        l93OffsetsToGeographicEnu(pos, 1, lng, lat);
        expect(Math.hypot(pos[0], pos[1])).toBeCloseTo(Math.hypot(dx, dy), 3);
        expect(pos[2]).toBe(z); // height untouched
    });

    it('rotates offsets by the meridian convergence east of 3°E', () => {
        // A pure grid-north offset (0, d) gains a small east component once
        // expressed in true ENU, because grid north tilts away from 3°E. The
        // magnitude is the convergence γ ≈ (λ − 3°)·sin(lat) ≈ 2.2° here.
        const lng = 6.004;
        const lat = 45.208;
        const d = 200;
        const pos = new Float32Array([0, d]);
        l93OffsetsToGeographicEnu(pos, 1, lng, lat);
        const gammaDeg = Math.abs((Math.atan2(pos[0], pos[1]) * 180) / Math.PI);
        expect(gammaDeg).toBeGreaterThan(1.8);
        expect(gammaDeg).toBeLessThan(2.6);
    });

    it('makes two clouds at different centres agree on a shared point', () => {
        // Same physical point, seen from two capture centres A and B. Each cloud
        // stores it as an L93 offset from its own centre; after conversion both
        // must land at the same true-ENU position relative to a common origin.
        const A = { lng: 6.000, lat: 45.205 };
        const B = { lng: 6.010, lat: 45.210 };
        const P = { lng: 6.005, lat: 45.208 };
        const [xa, ya] = lngLatToL93(A.lng, A.lat);
        const [xb, yb] = lngLatToL93(B.lng, B.lat);
        const [xp, yp] = lngLatToL93(P.lng, P.lat);

        const fromA = new Float32Array([xp - xa, yp - ya, 0]);
        const fromB = new Float32Array([xp - xb, yp - yb, 0]);
        l93OffsetsToGeographicEnu(fromA, 1, A.lng, A.lat);
        l93OffsetsToGeographicEnu(fromB, 1, B.lng, B.lat);

        // Re-express B's point around A's origin: (B−A in ENU) + fromB.
        const off = new Float32Array([xb - xa, yb - ya, 0]);
        l93OffsetsToGeographicEnu(off, 1, A.lng, A.lat);
        const bEast = off[0] + fromB[0];
        const bNorth = off[1] + fromB[1];

        // With the correction the residual is well under a decimetre across a
        // ~1 km baseline (uncorrected they would differ by a few metres).
        expect(Math.hypot(bEast - fromA[0], bNorth - fromA[1])).toBeLessThan(0.1);
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
