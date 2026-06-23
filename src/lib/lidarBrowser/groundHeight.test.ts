import { computeHeightAboveGround, sanitizeVegHeights } from '@/lib/lidarBrowser/groundHeight';
import { describe, expect, it } from 'vitest';

describe('computeHeightAboveGround — nearest ground at cliff edges', () => {
    it('references a cliff-top tree against the cliff-top terrain, not the base', () => {
        // Build a small scene straddling a vertical cliff. Ground (class 2) is at
        // 100 m on the plateau (north side) and drops to 0 m at the base (south).
        // A 15 m tree sits on the plateau edge. A pure vertical lookup would
        // reference it against the void below (0 m) → ~115 m phantom height.
        const positions: number[] = [];
        const classes: number[] = [];
        const add = (x: number, y: number, z: number, c: number) => {
            positions.push(x, y, z);
            classes.push(c);
        };
        // Plateau ground at z=100 for north y in [0..9], base ground at z=0 for
        // south y in [-12..-1], across x in [0..9] (metres).
        for (let x = 0; x <= 9; x++) {
            for (let y = 0; y <= 9; y++) add(x, y, 100, 2);
            for (let y = -12; y <= -1; y++) add(x, y, 0, 2);
            // Near-vertical cliff face at the edge (y≈0): ground samples all the
            // way down so the edge cell's min-Z is the base (0 m), which is what
            // breaks a plain vertical lookup.
            for (let z = 0; z <= 100; z += 10) add(x, 0, z, 2);
        }
        // Tree-top point on the plateau edge: rooted at z=100, canopy at z=115.
        const treeIndex = positions.length / 3;
        add(5, 0.5, 115, 5);

        const count = positions.length / 3;
        const hag = computeHeightAboveGround(
            Float32Array.from(positions),
            Uint8Array.from(classes),
            count,
        );
        expect(hag).not.toBeNull();
        if (!hag) throw new Error('expected ground field');
        // Real canopy height ~15 m, NOT the ~115 m cliff drop.
        expect(hag[treeIndex]).toBeGreaterThan(10);
        expect(hag[treeIndex]).toBeLessThan(25);
    });
});

describe('sanitizeVegHeights', () => {
    it('clamps cliff-edge outliers to the robust canopy top', () => {
        // 100 canopy points around 20 m plus one absurd 150 m cliff-edge artefact.
        const n = 101;
        const heights = new Float32Array(n);
        const classes = new Uint8Array(n).fill(5); // high vegetation
        for (let i = 0; i < 100; i++) heights[i] = 18 + (i % 5); // 18..22 m
        heights[100] = 150;
        const robustMax = sanitizeVegHeights(heights, classes, n);
        expect(robustMax).not.toBeNull();
        // The robust max tracks the real canopy, not the artefact.
        expect(robustMax).toBeLessThan(40);
        expect(robustMax).toBeGreaterThanOrEqual(20);
        // The 150 m artefact is clamped down to the robust max.
        expect(heights[100]).toBe(robustMax);
        // Real canopy points are untouched.
        expect(heights[0]).toBe(18);
    });

    it('floors the scale for low scrub and returns null without vegetation', () => {
        const scrub = Float32Array.from([1, 1.5, 2, 1.2]);
        const scrubClasses = Uint8Array.from([3, 3, 3, 3]);
        expect(sanitizeVegHeights(scrub, scrubClasses, 4)).toBe(5);

        const ground = Float32Array.from([0, 0, 0]);
        const groundClasses = Uint8Array.from([2, 2, 2]);
        expect(sanitizeVegHeights(ground, groundClasses, 3)).toBeNull();
    });
});
