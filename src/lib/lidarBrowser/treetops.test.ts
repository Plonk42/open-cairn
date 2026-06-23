import { detectTreetops, TREE_SEED_NONE } from '@/lib/lidarBrowser/treetops';
import { describe, expect, it } from 'vitest';

/**
 * Build a conical "tree": vegetation points on a 1 m grid within `radius`,
 * height-above-ground peaking at the centre and tapering to 0 at the edge.
 */
function coneTree(cx: number, cy: number, radius: number, peak: number) {
    const pos: number[] = [];
    const hag: number[] = [];
    const cls: number[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const r = Math.hypot(dx, dy);
            if (r > radius) continue;
            const h = Math.max(0, peak * (1 - r / radius));
            pos.push(cx + dx, cy + dy, h);
            hag.push(h);
            cls.push(5);
        }
    }
    return { pos, hag, cls };
}

/** Find the seed of the point at grid coordinate (x,y), or -1 if absent. */
function seedAt(positions: Float32Array, seeds: Uint8Array, count: number, x: number, y: number): number {
    for (let i = 0; i < count; i++) {
        if (positions[i * 3] === x && positions[i * 3 + 1] === y) return seeds[i];
    }
    return -1;
}

describe('detectTreetops', () => {
    it('returns null when the cloud has no vegetation', () => {
        const positions = Float32Array.from([0, 0, 0, 1, 1, 0]);
        const hag = Float32Array.from([0, 0]);
        const classes = Uint8Array.from([2, 2]);
        expect(detectTreetops(positions, hag, classes, 2)).toBeNull();
    });

    it('assigns one coherent seed to a single tree crown', () => {
        const { pos, hag, cls } = coneTree(0, 0, 4, 15);
        const positions = Float32Array.from(pos);
        const heightAboveGround = Float32Array.from(hag);
        const classes = Uint8Array.from(cls);
        const seeds = detectTreetops(positions, heightAboveGround, classes, cls.length);
        if (!seeds) throw new Error('expected seeds');

        const centre = seedAt(positions, seeds, cls.length, 0, 0);
        expect(centre).not.toBe(TREE_SEED_NONE);
        // A neighbouring point of the same crown shares the seed.
        expect(seedAt(positions, seeds, cls.length, 1, 0)).toBe(centre);
        expect(seedAt(positions, seeds, cls.length, 0, 1)).toBe(centre);
    });

    it('seeds two separated trees independently of their neighbours', () => {
        const a = coneTree(0, 0, 3, 14);
        const b = coneTree(40, 0, 3, 14);
        const pos = [...a.pos, ...b.pos];
        const hag = [...a.hag, ...b.hag];
        const cls = [...a.cls, ...b.cls];
        const positions = Float32Array.from(pos);
        const seeds = detectTreetops(positions, Float32Array.from(hag), Uint8Array.from(cls), cls.length);
        if (!seeds) throw new Error('expected seeds');

        expect(seedAt(positions, seeds, cls.length, 0, 0)).not.toBe(TREE_SEED_NONE);
        expect(seedAt(positions, seeds, cls.length, 40, 0)).not.toBe(TREE_SEED_NONE);
    });
});
