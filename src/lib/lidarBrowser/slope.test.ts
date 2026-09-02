import { slopeColor, vertexColor } from '@/lib/lidarBrowser/slope';
import { describe, expect, it } from 'vitest';

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

    it('colours flat ground green and near-vertical faces a bright violet/pink (slope preset)', () => {
        const flat = vertexColor(0, 0, 1, 1000, 'slope');
        expect(flat).toEqual([34, 139, 58]);
        const vertical = vertexColor(1, 0, 0, 1000, 'slope');
        expect(vertical).toEqual([236, 160, 240]);
        // The steep end must stay bright/legible, not fade toward black.
        expect(Math.max(...vertical)).toBeGreaterThan(150);
    });
});

describe('vertexColor — montagne preset', () => {
    const lum = (c: readonly [number, number, number]): number => (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255;

    it('bakes no aspect shading: a north and a south face of the same rock match', () => {
        // Same slope, same altitude, opposite bearings — below the snow line so
        // the aspect-shifted snow line cannot legitimately separate them.
        const north = vertexColor(0, 0.9, 0.44, 1200, 'montagne');
        const south = vertexColor(0, -0.9, 0.44, 1200, 'montagne');
        expect(north).toEqual(south);
    });

    it('keeps rock in the physical reflectance range instead of the legible-under-flat-ambient range', () => {
        const rock = vertexColor(0.8, 0, 0.6, 1500, 'montagne');
        expect(lum(rock)).toBeGreaterThan(0.25);
        expect(lum(rock)).toBeLessThan(0.62);
        // The default 'cliff' preset sits near 0.75 because it compensates for
        // a constant 0.35 ambient; that double-lights under the PBR path.
        expect(lum(rock)).toBeLessThan(lum(vertexColor(0.8, 0, 0.6, 1500, 'cliff')) - 0.25);
    });

    it('puts bright snow on high gentle ground and bare rock on a high vertical wall', () => {
        const snowfield = vertexColor(0, 0, 1, 3200, 'montagne');
        const wall = vertexColor(1, 0, 0, 3200, 'montagne');
        expect(lum(snowfield)).toBeGreaterThan(0.85);
        expect(lum(wall)).toBeLessThan(0.35);
    });

    it('holds snow lower on north faces than on south faces', () => {
        const north = vertexColor(0, 1, 1, 2150, 'montagne');
        const south = vertexColor(0, -1, 1, 2150, 'montagne');
        expect(lum(north)).toBeGreaterThan(lum(south));
    });

    it('returns integer RGB channels in [0, 255]', () => {
        for (const z of [800, 1800, 2400, 3600]) {
            const c = vertexColor(0.5, 0.5, 0.7, z, 'montagne', 0.2);
            for (const ch of c) {
                expect(Number.isInteger(ch)).toBe(true);
                expect(ch).toBeGreaterThanOrEqual(0);
                expect(ch).toBeLessThanOrEqual(255);
            }
        }
    });
});
