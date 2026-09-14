import { describe, expect, it } from 'vitest';
import {
    captureAdvice, coherentDepth, coherentGroundStride, COMFORT_SECONDS,
    defaultQualityIndex, formatDetail, formatSeconds, octreeCellM, POISSON_DEPTH_MAX,
    POISSON_DEPTH_MIN, QUALITY_TIER_COUNT, qualityTiers, spacingM, tierIndexOf,
} from './lidarQuality';
import { CAPTURE_POINT_CEILING } from './lidarResolution';

describe('coherentDepth', () => {
    it('matches the depth the 250 m sweep saturates at', () => {
        // 250 × 250 m at the native density: vertex growth collapses from ×3.9
        // to ×1.1 across depth 10, and the ground density starts biting there.
        expect(coherentDepth(250, 250, 0)).toBe(10);
    });

    it('adds one step per doubling of the zone', () => {
        expect(coherentDepth(500, 500, 0)).toBe(11);
        expect(coherentDepth(1000, 1000, 0)).toBe(12);
    });

    it('gains more than one octree level per resolution stop', () => {
        // The IGN pyramid decuples the points from one level to the next, so a
        // stop divides the spacing by ~sqrt(10) rather than by 2.
        const coarsest = coherentDepth(1000, 1000, 6.8);
        expect(coherentDepth(1000, 1000, 3.4)).toBe(coarsest + 2);
        expect(coherentDepth(1000, 1000, 1.7)).toBe(coarsest + 3);
    });

    it('drops one step per two ground-density steps', () => {
        const full = coherentDepth(1000, 1000, 1.7, 1);
        expect(coherentDepth(1000, 1000, 1.7, 4)).toBe(full - 1);
        expect(coherentDepth(1000, 1000, 1.7, 16)).toBe(full - 2);
    });

    it('stays within the range the pipeline clamps to', () => {
        expect(coherentDepth(50, 50, 6.8)).toBeGreaterThanOrEqual(POISSON_DEPTH_MIN);
        expect(coherentDepth(5000, 5000, 0)).toBeLessThanOrEqual(POISSON_DEPTH_MAX);
    });
});

describe('coherentGroundStride', () => {
    it('reproduces the sweep: 1/16 is free two steps under the coherent depth', () => {
        // Depth 8 on that zone yielded 212 103 vertices at max density and
        // 212 338 at 1/16 — the octree could not see the difference.
        expect(coherentGroundStride(250, 250, 0, 8)).toBe(16);
        expect(coherentGroundStride(250, 250, 0, 9)).toBe(4);
        expect(coherentGroundStride(250, 250, 0, 10)).toBe(1);
    });

    it('never asks for more thinning than the slider offers', () => {
        expect(coherentGroundStride(5000, 5000, 6.8, 6)).toBeLessThanOrEqual(64);
    });
});

describe('qualityTiers', () => {
    it('halves the detail at every step', () => {
        const tiers = qualityTiers(1000, 1000);
        for (let i = 1; i < tiers.length; i++) {
            expect(tiers[i].detailM).toBeCloseTo(tiers[i - 1].detailM / 2, 6);
        }
    });

    it('orders steps by increasing cost', () => {
        const tiers = qualityTiers(1000, 1000);
        for (let i = 1; i < tiers.length; i++) {
            expect(tiers[i].seconds).toBeGreaterThan(tiers[i - 1].seconds);
        }
    });

    it('keeps every step inside the download ceiling', () => {
        for (const side of [250, 500, 1000, 2000, 3000, 5000]) {
            for (const tier of qualityTiers(side, side)) {
                expect(tier.points).toBeLessThanOrEqual(CAPTURE_POINT_CEILING);
            }
        }
    });

    it('makes each step internally coherent', () => {
        for (const side of [250, 500, 1000, 2000, 3000, 5000]) {
            for (const tier of qualityTiers(side, side)) {
                expect(captureAdvice({
                    widthM: side,
                    lengthM: side,
                    resolutionM: tier.resolutionM,
                    depth: tier.depth,
                    groundStride: tier.groundStride,
                })).toEqual([]);
            }
        }
    });

    it('never fetches finer than the octree can carry', () => {
        for (const side of [250, 1000, 5000]) {
            for (const tier of qualityTiers(side, side)) {
                const cell = octreeCellM(side, side, tier.depth);
                // Depth is an integer, so the cell lands within a half step of
                // the spacing rather than exactly on it.
                expect(spacingM(tier.resolutionM)).toBeLessThanOrEqual(cell * Math.SQRT2);
            }
        }
    });

    it('offers a coarser detail on a larger zone at the same step', () => {
        const small = qualityTiers(500, 500);
        const large = qualityTiers(3000, 3000);
        expect(large.at(-1)!.detailM).toBeGreaterThan(small.at(-1)!.detailM);
    });

    it('runs out of travel rather than clamping below the pipeline minimum', () => {
        const tiny = qualityTiers(50, 50);
        expect(tiny.length).toBeLessThan(QUALITY_TIER_COUNT);
        expect(tiny[0].depth).toBe(POISSON_DEPTH_MIN);
    });

    it('only pays for a finer IGN level once the octree can carry it', () => {
        // At 5 km the two coarsest steps share the 6.8 m level: their octree
        // cell is wider than that level's spacing, so fetching finer would
        // reach no extra vertex.
        const tiers = qualityTiers(5000, 5000);
        expect(tiers.map((t) => t.resolutionM)).toEqual([6.8, 6.8, 3.4, 3.4]);
        for (let i = 1; i < tiers.length; i++) {
            expect(tiers[i].bytes).toBeGreaterThanOrEqual(tiers[i - 1].bytes);
        }
    });
});

describe('qualityTiers on a measured pyramid', () => {
    // Read from the COPC hierarchy of the tiles under the Vercors test zone.
    const VERCORS_PYRAMID = [0.053, 0.637, 2.535, 8.085, 24.617, 29.816];

    it('keeps every invariant the table-based tiers hold', () => {
        for (const side of [250, 1000, 3000, 5000]) {
            const tiers = qualityTiers(side, side, VERCORS_PYRAMID);
            for (const tier of tiers) {
                expect(tier.points).toBeLessThanOrEqual(CAPTURE_POINT_CEILING);
                expect(captureAdvice({
                    widthM: side,
                    lengthM: side,
                    resolutionM: tier.resolutionM,
                    depth: tier.depth,
                    groundStride: tier.groundStride,
                }, VERCORS_PYRAMID)).toEqual([]);
            }
        }
    });

    it('reaches the same detail at a coarser stop where the zone is denser', () => {
        // Vercors carries 24.6 pt/m² at the 0.43 m level where the table
        // assumes 18.2, so the finest step gets its vertices one level earlier
        // — the dial is derived from the profile, not from the table.
        const table = qualityTiers(1000, 1000);
        const measured = qualityTiers(1000, 1000, VERCORS_PYRAMID);
        expect(measured.map((t) => t.resolutionM))
            .not.toEqual(table.map((t) => t.resolutionM));
    });
});

describe('defaultQualityIndex', () => {
    it('picks the finest step that stays reasonably quick', () => {
        for (const side of [250, 500, 1000, 2000, 3000, 5000]) {
            const tiers = qualityTiers(side, side);
            const idx = defaultQualityIndex(tiers);
            expect(tiers[idx].seconds).toBeLessThanOrEqual(COMFORT_SECONDS);
            if (idx + 1 < tiers.length) {
                expect(tiers[idx + 1].seconds).toBeGreaterThan(COMFORT_SECONDS);
            }
        }
    });

    it('trades detail for area rather than making the user wait longer', () => {
        const defaults = [250, 1000, 3000].map((side) => {
            const tiers = qualityTiers(side, side);
            return tiers[defaultQualityIndex(tiers)].detailM;
        });
        for (let i = 1; i < defaults.length; i++) {
            expect(defaults[i]).toBeGreaterThan(defaults[i - 1]);
        }
    });
});

describe('tierIndexOf', () => {
    it('recognises settings that sit exactly on a step', () => {
        const tiers = qualityTiers(1000, 1000);
        const t = tiers[1];
        expect(tierIndexOf(tiers, t.resolutionM, t.depth, t.groundStride)).toBe(1);
    });

    it('reports no step for a hand-tuned combination', () => {
        const tiers = qualityTiers(1000, 1000);
        expect(tierIndexOf(tiers, tiers[1].resolutionM, 12, 1)).toBe(-1);
    });
});

describe('captureAdvice', () => {
    const zone = { widthM: 250, lengthM: 250, resolutionM: 0 };

    it('flags a depth the data cannot feed', () => {
        expect(captureAdvice({ ...zone, depth: 12, groundStride: 1 }))
            .toContainEqual({ kind: 'depthTooHigh', suggested: 10 });
    });

    it('flags a depth that wastes the download', () => {
        expect(captureAdvice({ ...zone, depth: 7, groundStride: 1 }))
            .toContainEqual({ kind: 'depthTooLow', suggested: 10 });
    });

    it('leaves one step of slack around the coherent depth', () => {
        expect(captureAdvice({ ...zone, depth: 9, groundStride: 4 })).toEqual([]);
    });

    it('flags ground thinning that eats into the mesh', () => {
        expect(captureAdvice({ ...zone, depth: 10, groundStride: 16 }))
            .toContainEqual({ kind: 'groundTooSparse', suggested: 1 });
    });

    it('flags ground density the octree cannot use', () => {
        expect(captureAdvice({ ...zone, depth: 7, groundStride: 1 }))
            .toContainEqual({ kind: 'groundTooDense', suggested: 64 });
    });
});

describe('read-outs', () => {
    it('switches from centimetres to metres', () => {
        expect(formatDetail(0.24)).toBe('24 cm');
        expect(formatDetail(2.93)).toBe('2,9 m');
    });

    it('switches from seconds to minutes', () => {
        expect(formatSeconds(42.4)).toBe('42 s');
        expect(formatSeconds(130)).toBe('2 min 10');
    });
});
