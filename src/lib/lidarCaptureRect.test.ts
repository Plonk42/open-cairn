import {
    clampRectToArea, LIDAR_RECT_MIN_SIDE_M, rectAreaHa, rectCornersLngLat,
    rectEnclosingRadiusM, rectFromDrag, rectOnScreen, type CaptureRect,
} from '@/lib/lidarCaptureRect';
import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

/** A rectangle anchored somewhere in the Vercors, for the clamping tests. */
function rectAt(widthM: number, lengthM: number, bearingDeg = 0): CaptureRect {
    return { centerLng: 5.7, centerLat: 45.2, bearingDeg, widthM, lengthM };
}

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

describe('rectOnScreen', () => {
    /** 800×600 canvas with a plain equirectangular projection around the rect. */
    function fakeMap(originLng: number, originLat: number): maplibregl.Map {
        return {
            getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
            project: ([lng, lat]: [number, number]) => ({
                x: (lng - originLng) * 100_000,
                y: (originLat - lat) * 100_000,
            }),
        } as unknown as maplibregl.Map;
    }

    it('sees a rectangle under the camera', () => {
        expect(rectOnScreen(fakeMap(5.698, 45.202), rectAt(400, 400))).toBe(true);
    });

    it('reports a rectangle panned out of the view', () => {
        expect(rectOnScreen(fakeMap(6.2, 45.202), rectAt(400, 400))).toBe(false);
    });
});

describe('clampRectToArea', () => {
    it('leaves a rectangle within the cap untouched', () => {
        const r = clampRectToArea(rectAt(300, 400), 1_000_000);
        expect(r.widthM).toBe(300);
        expect(r.lengthM).toBe(400);
    });

    it('scales an oversized rectangle down, preserving aspect ratio', () => {
        // area 1.92M → scale sqrt(1M/1.92M)
        const r = clampRectToArea(rectAt(1200, 1600), 1_000_000);
        expect(r.widthM * r.lengthM).toBeCloseTo(1_000_000, 3);
        expect(r.lengthM / r.widthM).toBeCloseTo(1600 / 1200, 6);
    });

    it('keeps the ground anchor', () => {
        const r = clampRectToArea(rectAt(1200, 1600, 42), 1_000_000);
        expect(r.centerLng).toBe(5.7);
        expect(r.centerLat).toBe(45.2);
        expect(r.bearingDeg).toBe(42);
    });

    it('raises a degenerate side to the minimum', () => {
        const r = clampRectToArea(rectAt(0, 400), 1_000_000);
        expect(r.widthM).toBe(LIDAR_RECT_MIN_SIDE_M);
    });
});

describe('rectFromDrag', () => {
    const mPerDegLat = 111_320;

    it('centres on the midpoint of the dragged diagonal', () => {
        const a = { lng: 5.7, lat: 45.2 };
        const b = { lng: 5.71, lat: 45.21 };
        const r = rectFromDrag(a, b, 0);
        expect(r.centerLng).toBeCloseTo(5.705, 9);
        expect(r.centerLat).toBeCloseTo(45.205, 9);
    });

    it('measures the north/south span as the length at bearing 0', () => {
        const a = { lng: 5.7, lat: 45.2 };
        const mPerDegLng = mPerDegLat * Math.cos((45.2 * Math.PI) / 180);
        const b = { lng: 5.7 + 200 / mPerDegLng, lat: 45.2 + 400 / mPerDegLat };
        const r = rectFromDrag(a, b, 0);
        expect(r.widthM).toBeCloseTo(200, 0);
        expect(r.lengthM).toBeCloseTo(400, 0);
    });

    it('swaps the two sides when the drag frame is rotated 90°', () => {
        const a = { lng: 5.7, lat: 45.2 };
        const mPerDegLng = mPerDegLat * Math.cos((45.2 * Math.PI) / 180);
        const b = { lng: 5.7 + 200 / mPerDegLng, lat: 45.2 + 400 / mPerDegLat };
        const r = rectFromDrag(a, b, 90);
        expect(r.widthM).toBeCloseTo(400, 0);
        expect(r.lengthM).toBeCloseTo(200, 0);
    });

    it('is orientation-independent in area for a drag of the same ground extent', () => {
        const a = { lng: 5.7, lat: 45.2 };
        const b = { lng: 5.8, lat: 45.3 };
        const straight = rectFromDrag(a, b, 0);
        const rotated = rectFromDrag(a, b, 30);
        expect(rotated.widthM * rotated.lengthM)
            .toBeLessThanOrEqual(straight.widthM * straight.lengthM + 1);
        expect(rotated.bearingDeg).toBe(30);
    });

    it('caps a huge drag at the maximum area', () => {
        const r = rectFromDrag({ lng: 5, lat: 45 }, { lng: 6, lat: 46 }, 0);
        expect(r.widthM * r.lengthM).toBeCloseTo(25_000_000, 0);
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
