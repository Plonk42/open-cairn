import { describe, expect, it } from 'vitest';
import { slopeColor, vertexColor } from '@/lib/lidarBrowser/slope';

describe('slopeColor', () => {
    it('returns the flat-ground colour at zero slope', () => {
        expect(slopeColor(0)).toEqual([94, 138, 62]);
    });

    it('returns integer RGB channels in [0, 255]', () => {
        const c = slopeColor(0.6); // ~34°
        expect(c).toHaveLength(3);
        for (const ch of c) {
            expect(Number.isInteger(ch)).toBe(true);
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
        }
    });

    it('clamps slopes beyond the palette to the last stop', () => {
        const vertical = slopeColor(Math.PI / 2); // 90°
        expect(vertical).toEqual([182, 178, 170]);
    });
});

describe('vertexColor', () => {
    it('colours a flat upward-facing point as grass (cliff preset)', () => {
        // Normal straight up → slope 0 → first cliff palette stop.
        expect(vertexColor(0, 0, 1, 1000, 'cliff')).toEqual([94, 138, 62]);
    });

    it('normalizes the input normal before computing slope', () => {
        // A non-unit upward normal should give the same colour as the unit one.
        expect(vertexColor(0, 0, 5, 1000, 'cliff')).toEqual(vertexColor(0, 0, 1, 1000, 'cliff'));
    });

    it('treats downward normals the same as upward (uses |nz|)', () => {
        expect(vertexColor(0, 0, -1, 1000, 'cliff')).toEqual(vertexColor(0, 0, 1, 1000, 'cliff'));
    });

    it('returns valid RGB for the winter preset on a steep north face', () => {
        const c = vertexColor(0, 1, 0.2, 2000, 'winter');
        expect(c).toHaveLength(3);
        for (const ch of c) {
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
        }
    });
});
