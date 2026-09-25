import { describe, expect, it } from 'vitest';
import { boxMeetsRect, type QueryRectL93 } from './hierarchy';

const box = (minX: number, minY: number, side: number) => (
    { minX, minY, maxX: minX + side, maxY: minY + side }
);

describe('boxMeetsRect', () => {
    const upright: QueryRectL93 = { x0: 0, y0: 0, ux: 0, uy: 1, halfWidthM: 100, halfLengthM: 200 };

    it('tells apart boxes on either side of an unrotated edge', () => {
        expect(boxMeetsRect(box(90, -10, 20), upright)).toBe(true);
        expect(boxMeetsRect(box(110, -10, 20), upright)).toBe(false);
        expect(boxMeetsRect(box(-10, 190, 20), upright)).toBe(true);
        expect(boxMeetsRect(box(-10, 210, 20), upright)).toBe(false);
    });

    it('rejects a box in the corner the enclosing square keeps', () => {
        // Rotated 45°: the rectangle's AABB reaches (212, 212), its corner does not.
        const s = Math.SQRT1_2;
        const diagonal: QueryRectL93 = { ...upright, ux: s, uy: s };
        expect(boxMeetsRect(box(150, 150, 40), diagonal)).toBe(false);
        expect(boxMeetsRect(box(120, 120, 40), diagonal)).toBe(true);
    });

    it('keeps a box that contains the whole rectangle', () => {
        expect(boxMeetsRect(box(-1000, -1000, 2000), upright)).toBe(true);
    });
});
