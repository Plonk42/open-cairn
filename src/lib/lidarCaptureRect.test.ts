import {
    clampRectToArea, rectAreaHa, rectCornersLngLat, rectEnclosingRadiusM,
} from '@/lib/lidarCaptureRect';
import { describe, expect, it } from 'vitest';

describe('rectEnclosingRadiusM', () => {
    it('is half the diagonal', () => {
        expect(rectEnclosingRadiusM(600, 800)).toBeCloseTo(500, 6); // 3-4-5 → 1000/2
    });
});

describe('rectAreaHa', () => {
    it('converts m² to hectares', () => {
        expect(rectAreaHa(100, 100)).toBeCloseTo(1, 6); // 10 000 m² = 1 ha
    });
});

describe('clampRectToArea', () => {
    it('leaves a rectangle within the cap untouched', () => {
        const r = clampRectToArea(300, 400, 1_000_000);
        expect(r.widthM).toBe(300);
        expect(r.lengthM).toBe(400);
    });

    it('scales an oversized rectangle down, preserving aspect ratio', () => {
        const r = clampRectToArea(1200, 1600, 1_000_000); // area 1.92M → scale sqrt(1M/1.92M)
        expect(r.widthM * r.lengthM).toBeCloseTo(1_000_000, 3);
        expect(r.lengthM / r.widthM).toBeCloseTo(1600 / 1200, 6);
    });
});

describe('rectCornersLngLat', () => {
    it('produces a closed ring of five positions', () => {
        const ring = rectCornersLngLat(6, 45, 0, 200, 400);
        expect(ring).toHaveLength(5);
        expect(ring[0]).toEqual(ring[4]);
    });

    it('aligns width with east/west and length with north/south at azimuth 0', () => {
        const lng = 6;
        const lat = 45;
        const ring = rectCornersLngLat(lng, lat, 0, 200, 400);
        const lngs = ring.slice(0, 4).map((p) => p[0]);
        const lats = ring.slice(0, 4).map((p) => p[1]);
        const mPerDegLat = 111_320;
        const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
        const spanLngM = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng;
        const spanLatM = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
        expect(spanLngM).toBeCloseTo(200, 3); // width along east/west
        expect(spanLatM).toBeCloseTo(400, 3); // length along north/south
    });

    it('swaps the on-ground spans when rotated 90°', () => {
        const lng = 6;
        const lat = 45;
        const ring = rectCornersLngLat(lng, lat, 90, 200, 400);
        const lngs = ring.slice(0, 4).map((p) => p[0]);
        const lats = ring.slice(0, 4).map((p) => p[1]);
        const mPerDegLat = 111_320;
        const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
        const spanLngM = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng;
        const spanLatM = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
        expect(spanLngM).toBeCloseTo(400, 3); // length now east/west
        expect(spanLatM).toBeCloseTo(200, 3); // width now north/south
    });
});
