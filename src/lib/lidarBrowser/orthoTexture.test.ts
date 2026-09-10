import { describe, expect, it } from 'vitest';
import { snapDetailView } from './orthoTexture';

describe('snapDetailView', () => {
    const LAT = 45;
    const LNG = 6;

    it('gives two nearby cameras the same mosaic', () => {
        const a = snapDetailView(LNG, LAT, 400);
        // ~10 m east: far below the quarter-radius grid step.
        const b = snapDetailView(LNG + 10 / (111_320 * Math.cos((LAT * Math.PI) / 180)), LAT, 405);
        expect(b).toEqual(a);
    });

    it('gives a distinct mosaic once the camera has moved a grid step', () => {
        const a = snapDetailView(LNG, LAT, 400);
        // 512 m is the snapped radius, so the grid step is 128 m.
        const b = snapDetailView(LNG, LAT + 200 / 111_320, 400);
        expect(b.lat).not.toBe(a.lat);
    });

    it('covers the requested disc despite the centre snapping', () => {
        // Worst case: the centre is pushed by half a grid step, so the mosaic
        // must still reach the far edge of the requested disc.
        for (const requested of [120, 400, 900, 2500]) {
            const snapped = snapDetailView(LNG, LAT, requested);
            const shift = Math.max(
                Math.abs(snapped.lat - LAT) * 111_320,
                Math.abs(snapped.lng - LNG) * 111_320 * Math.cos((LAT * Math.PI) / 180),
            );
            expect(snapped.radiusMeters - shift).toBeGreaterThanOrEqual(requested);
        }
    });

    it('snaps the radius to a power of two, so it takes a real zoom change to refetch', () => {
        expect(snapDetailView(LNG, LAT, 300).radiusMeters).toBe(512 * 1.25);
        expect(snapDetailView(LNG, LAT, 512).radiusMeters).toBe(512 * 1.25);
        expect(snapDetailView(LNG, LAT, 513).radiusMeters).toBe(1024 * 1.25);
    });
});
