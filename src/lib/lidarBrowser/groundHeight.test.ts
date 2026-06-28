import {
    buildVegGroundGrid, computeVegHeights, computeVegHeightStacked,
    DIAG_FLAG_CLIFF, DIAG_FLAG_FLOATING, DIAG_FLAG_GROUND, DIAG_FLAG_VEG,
    sanitizeVegHeights, smoothCliffOutliers, VEG_DIAG_STRIDE,
} from '@/lib/lidarBrowser/groundHeight';
import { describe, expect, it } from 'vitest';

describe('computeVegHeightStacked — per-column vertical clustering', () => {
    // All points live in one ~1.5 m XY column so they cluster together.
    const COL_X = 0.5;
    const COL_Y = 0.5;
    const buildColumn = (zs: number[], cls: number) => {
        const positions: number[] = [];
        const classes: number[] = [];
        for (const z of zs) {
            positions.push(COL_X, COL_Y, z);
            classes.push(cls);
        }
        return {
            positions: Float32Array.from(positions),
            classes: Uint8Array.from(classes),
            count: zs.length,
        };
    };

    it('gives a tall tree leaning on a cliff its full height (one continuous cluster)', () => {
        // A continuous canopy from the root (z=0) to the crown (z=30) with no
        // vertical void: a single cluster anchored at 0, so the crown reads ~30 m
        // — exactly the case a nearest-surface metric flattened to a few metres.
        const zs = Array.from({ length: 31 }, (_, i) => i); // 0..30 step 1
        const { positions, classes, count } = buildColumn(zs, 5);
        const h = computeVegHeightStacked(positions, classes, count, 3);
        expect(h[0]).toBe(0);          // base of the cluster
        expect(h[count - 1]).toBeCloseTo(30, 5); // crown keeps its real height
    });

    it('separates trees stacked on different cliff ledges, each with its own height', () => {
        // Two ~8 m masses with a 20 m vertical void between them (trees rooted on
        // two ledges of the same face). The gap exceeds gapM, so each becomes its
        // own cluster and keeps ~8 m instead of merging into one ~36 m phantom.
        const lower = Array.from({ length: 9 }, (_, i) => i);        // 0..8
        const upper = Array.from({ length: 9 }, (_, i) => 28 + i);   // 28..36
        const { positions, classes, count } = buildColumn([...lower, ...upper], 5);
        const h = computeVegHeightStacked(positions, classes, count, 3);
        // Lower tree crown (index 8) and upper tree crown (last) both ~8 m.
        expect(h[8]).toBeCloseTo(8, 5);
        expect(h[count - 1]).toBeCloseTo(8, 5);
        // The upper cluster restarts at its own base (height 0 there).
        expect(h[9]).toBe(0);
    });

    it('reads an ordinary height on a flat column and ignores non-vegetation', () => {
        const positions = Float32Array.from([
            COL_X, COL_Y, 0,    // veg base
            COL_X, COL_Y, 1,
            COL_X, COL_Y, 2,    // veg top
            COL_X, COL_Y, 50,   // ground/other class far above — must stay 0
        ]);
        const classes = Uint8Array.from([5, 5, 5, 2]);
        const h = computeVegHeightStacked(positions, classes, 4, 3);
        expect(h[2]).toBeCloseTo(2, 5); // ordinary height above the column base
        expect(h[3]).toBe(0);           // non-vegetation untouched
    });

    it('keeps a smaller gap from merging closely stacked masses', () => {
        // A 4 m void splits two masses only when gapM < 4.
        const { positions, classes, count } = buildColumn([0, 1, 2, 6, 7, 8], 5);
        const split = computeVegHeightStacked(positions, classes, count, 3);
        expect(split[count - 1]).toBeCloseTo(2, 5); // second cluster, own base at 6
        const merged = computeVegHeightStacked(positions, classes, count, 5);
        expect(merged[count - 1]).toBeCloseTo(8, 5); // single cluster from 0
    });
});

describe('computeVegHeights — hybrid (stacked blended with vertical over flat ground)', () => {
    // A bare-earth reference plus one isolated high vegetation return that the
    // stacked metric necessarily reads as ~0 m (it is alone in its column, so it
    // anchors its own base). This is the spreading-broadleaf-crown failure case.
    const FLOATING_X = 5.2;
    const FLOATING_Y = 5.2;
    const FLOATING_Z = 12;

    /** Flat ground (class 2) tiling a 0..10 m square, plus one lone canopy
     *  point (class 5) floating 12 m up with nothing below it in its column. */
    function flatGroundWithFloatingCrown(groundZ: number) {
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 10; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, groundZ);
                classes.push(2);
            }
        }
        positions.push(FLOATING_X, FLOATING_Y, groundZ + FLOATING_Z);
        classes.push(5);
        return {
            positions: Float32Array.from(positions),
            classes: Uint8Array.from(classes),
            count: classes.length,
            vegIndex: classes.length - 1,
        };
    }

    it('recovers a floating crown height from flat ground the stacked metric reads as ~0', () => {
        const { positions, classes, count, vegIndex } = flatGroundWithFloatingCrown(0);
        const stacked = computeVegHeightStacked(positions, classes, count, 3);
        expect(stacked[vegIndex]).toBe(0); // alone in its column → no height

        const grid = buildVegGroundGrid(positions, count, classes);
        expect(grid).not.toBeNull();
        const hybrid = computeVegHeights(positions, classes, count, 3, grid, 12);
        // Flat ground (relief 0) → full trust in the vertical-to-ground height.
        expect(hybrid[vegIndex]).toBeCloseTo(FLOATING_Z, 5);
    });

    it('falls back to the stacked height with no grid or when disabled (roughM ≤ 0)', () => {
        const { positions, classes, count, vegIndex } = flatGroundWithFloatingCrown(0);
        const grid = buildVegGroundGrid(positions, count, classes);
        // No grid → identical to stacked.
        expect(computeVegHeights(positions, classes, count, 3)[vegIndex]).toBe(0);
        // roughM = 0 disables the hybrid even when a grid is present.
        expect(computeVegHeights(positions, classes, count, 3, grid, 0)[vegIndex]).toBe(0);
    });

    it('colour smoothing pulls in absurd cliff outliers and is off (identical) by default', () => {
        // A patch of cliff vegetation all rendered ≈ 5 m, with one absurd lone
        // return at 30 m — the kind of stray speck sparse cliff LiDAR produces.
        // 3×3 points 1 m apart, centre point the outlier.
        const positions: number[] = [];
        const out: number[] = [];
        let centre = -1;
        for (let gx = 0; gx <= 2; gx++) {
            for (let gy = 0; gy <= 2; gy++) {
                if (gx === 1 && gy === 1) centre = out.length;
                positions.push(gx, gy, 0);
                out.push(gx === 1 && gy === 1 ? 30 : 5);
            }
        }
        const count = out.length;
        const isCliff = new Uint8Array(count).fill(1);
        const pos = Float32Array.from(positions);

        // strength 0 → untouched.
        const off = smoothCliffOutliers(Float32Array.from(out), pos, isCliff, count, 0);
        expect(off[centre]).toBe(30);

        // strength 1 → the strong outlier is pulled fully onto its robust local
        // reference (≈ 6 m, the count-weighted neighbourhood mean), not merely to
        // the tolerance edge, while the inliers (within tol) stay exactly 5.
        const on = smoothCliffOutliers(Float32Array.from(out), pos, isCliff, count, 1);
        expect(on[centre]).toBeLessThan(9);
        for (let i = 0; i < count; i++) {
            if (i !== centre) expect(on[i]).toBe(5);
        }
    });

    it('colour smoothing barely touches a mild deviation even at full strength', () => {
        // A point just past the tolerance must keep most of its value — the ramp
        // protects column-to-column steps from being flattened at full strength.
        // 5×5 cliff patch at 5 m with one point at 11 m (dev ≈ 6, just over tol).
        const positions: number[] = [];
        const out: number[] = [];
        let mild = -1;
        for (let gx = 0; gx <= 4; gx++) {
            for (let gy = 0; gy <= 4; gy++) {
                if (gx === 2 && gy === 2) mild = out.length;
                positions.push(gx, gy, 0);
                out.push(gx === 2 && gy === 2 ? 11 : 5);
            }
        }
        const count = out.length;
        const isCliff = new Uint8Array(count).fill(1);
        const pos = Float32Array.from(positions);
        const on = smoothCliffOutliers(Float32Array.from(out), pos, isCliff, count, 1);
        // Pulled only slightly (ramp ≈ small just past tol), still clearly > 5.
        expect(on[mild]).toBeGreaterThan(9);
        expect(on[mild]).toBeLessThan(11);
    });

    it('colour smoothing leaves non-cliff vegetation untouched', () => {
        // Same absurd 30 m point but flagged as non-cliff → never smoothed.
        const pos = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
        const out = Float32Array.from([5, 5, 5, 30]);
        const isCliff = new Uint8Array([0, 0, 0, 0]);
        const result = smoothCliffOutliers(out, pos, isCliff, 4, 1);
        expect(result[3]).toBe(30);
    });

    it('keeps the stacked height over rough ground (a cliff cell) to avoid phantoms', () => {
        // A reference surface with a 40 m step (cliff) so the crown's
        // neighbourhood has huge relief: the vertical drop would invent a
        // phantom-tall tree — the hybrid must keep the conservative stacked ~0.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 10; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx < 5 ? 0 : 40); // vertical face at x≈5
                classes.push(2);
            }
        }
        positions.push(FLOATING_X, FLOATING_Y, FLOATING_Z);
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const hybrid = computeVegHeights(pos, cls, count, 3, grid, 12);
        // High relief → weight on vertical ≈ 0 → stays at the stacked height.
        expect(hybrid[vegIndex]).toBeCloseTo(0, 5);
    });

    it('builds a grid only from ground/water classes when classifications are given', () => {
        const { positions, classes, count } = flatGroundWithFloatingCrown(7);
        const grid = buildVegGroundGrid(positions, count, classes);
        expect(grid).not.toBeNull();
        // The lone veg point must not pull the min-Z field up; ground sits at 7 m.
        const finite = grid ? grid.groundZ.filter((z) => Number.isFinite(z)) : [];
        expect(finite.length).toBeGreaterThan(0);
        for (const z of finite) expect(z).toBeCloseTo(7, 5);
    });

    it('anchors a crown overhanging a cliff rim to the rim, not the valley floor', () => {
        // A plateau (ground z=40) for x≤4 dropping to a valley floor (z=0) for
        // x≥5, and a tree rooted on the rim whose canopy spreads 5 m out over the
        // void: the canopy point sits at z=48 above a valley cell. Measured
        // straight down it would read a phantom 48 m; anchored to the rim it is
        // the true 8 m tree.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 4 ? 40 : 0);
                classes.push(2);
            }
        }
        positions.push(9, 5, 48); // crown point over the valley, 5 m past the rim
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);

        // Alone in its column over the void → stacked reads ~0 (floating).
        expect(computeVegHeightStacked(pos, cls, count, 3)[vegIndex]).toBe(0);

        const grid = buildVegGroundGrid(pos, count, cls);
        const hybrid = computeVegHeights(pos, cls, count, 3, grid, 12);
        // Anchored to the 40 m rim within crown reach → 48 − 40 = 8 m, not 48.
        expect(hybrid[vegIndex]).toBeCloseTo(8, 5);
    });

    it('does not anchor a floating point that sits below the cliff top — it is a falaise', () => {
        // Same plateau (z=40, x≤4) over a valley (z=0, x≥5), but the lone return
        // hangs over the void at z=38 — BELOW the rim top. A crown is only a
        // surplomb when it spreads ABOVE the cliff top (z > rimMax); a sub-rim
        // floater is cliff-face vegetation, so it must be flagged falaise (cliff)
        // and never pinned to the rim at a brown height-0.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 4 ? 40 : 0);
                classes.push(2);
            }
        }
        positions.push(9, 5, 38); // floats over the valley but 2 m below the rim
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        // It still floats over the void, but is NOT anchored to the rim — and it
        // renders as a full-stacked falaise (low blendW), not a brown height-0
        // surplomb. (Old behaviour: z ≥ rimMax − dropM anchored it, blendW 255.)
        expect(diagOf(diag, vegIndex).flags & DIAG_FLAG_FLOATING).not.toBe(0);
        expect(diagOf(diag, vegIndex).flags & DIAG_FLAG_CLIFF).toBe(0);
        expect(diagOf(diag, vegIndex).blendW).toBeLessThan(64);
    });

    it('sparse-cluster fallback lifts a lone cliff flyer off a brown height-0', () => {
        // Plateau (z=40, x≤4) over a valley (z=0, x≥5); a single class-5 return
        // hangs over the void at z=38. Alone in its vertical column, the stacked
        // metric pins it to height 0 (a dark brown speck). With the sparse-cluster
        // fallback armed, that lone return (cluster size 1) switches to the
        // horizontal wall distance instead, lifting it off zero. Default 0 = off.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 4 ? 40 : 0);
                classes.push(2);
            }
        }
        positions.push(9, 5, 38); // lone flyer over the void
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const off = computeVegHeights(pos, cls, count, 3, grid, 12);
        const on = computeVegHeights(pos, cls, count, 3, grid, 12, { cliffSparseMaxPts: 1 });
        expect(off[vegIndex]).toBeLessThan(1); // pinned to ~0 (brown) by the stacked metric
        expect(on[vegIndex]).toBeGreaterThan(off[vegIndex]); // wall distance lifts it off zero
    });

    it('veg-span reddens a recessed wall column the crest test missed', () => {
        // A stepped/recessed wall: deep foot ground z=0 (x≤10), a low bench z=2
        // around the column (x=11..13), a mid ledge z=18 within the 8 m near-rim
        // reach (x=18..20), and the true plateau z=60 only reachable by the 24 m
        // far reach (x=30..36). The near rim under-reads (belowRim≈16) while the
        // far rim towers above → the crest test fails and the column would render
        // green. But its vegetation scatters from z=4 to z=38 (span 34 m > 30),
        // the signature of a near-vertical wall, so veg-span reddens it.
        const pts: number[] = [];
        const cls: number[] = [];
        for (let gx = 0; gx <= 40; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                let z = 0;
                if (gx >= 11 && gx <= 13) z = 2;        // low bench under the column
                else if (gx >= 18 && gx <= 20) z = 18;  // mid ledge (near rim)
                else if (gx >= 30) z = 60;              // true plateau (far rim only)
                pts.push(gx, gy, z); cls.push(2);
            }
        }
        // Wall vegetation clinging up the face inside the x=12 column.
        const wallVi = cls.length;
        for (const z of [4, 12, 20, 28, 38]) { pts.push(12, 5, z); cls.push(5); }
        const count = cls.length;
        const pos = Float32Array.from(pts);
        const classes = Uint8Array.from(cls);
        const grid = buildVegGroundGrid(pos, count, classes);

        const diagOff = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, classes, count, 3, grid, 12, { cliffSpanM: 0, diag: diagOff });
        const diagOn = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, classes, count, 3, grid, 12, { diag: diagOn });

        // The crest test alone greens the column (high blendW); veg-span reddens
        // it (low blendW) and denies it the overhang anchor (not surplomb).
        expect(diagOf(diagOff, wallVi).blendW).toBeGreaterThan(200);
        expect(diagOf(diagOn, wallVi).blendW).toBeLessThan(64);
        expect(diagOf(diagOn, wallVi).flags & DIAG_FLAG_CLIFF).toBe(0);
    });

    it('veg-span leaves a tall tree on flat ground green', () => {
        // A 34 m tree on flat ground spans more than the 30 m wall threshold, but
        // it sits AT a genuine crest (no rim towers above it) so it must stay
        // pente (green) — the belowRim/crest guards keep veg-span off the forest.
        const pts: number[] = [];
        const cls: number[] = [];
        for (let gx = 0; gx <= 20; gx++) {
            for (let gy = 0; gy <= 20; gy++) { pts.push(gx, gy, 0); cls.push(2); }
        }
        const treeVi = cls.length;
        for (const z of [2, 10, 18, 26, 34]) { pts.push(10, 10, z); cls.push(5); }
        const count = cls.length;
        const pos = Float32Array.from(pts);
        const classes = Uint8Array.from(cls);
        const grid = buildVegGroundGrid(pos, count, classes);

        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, classes, count, 3, grid, 12, { diag });
        // Stays green even with veg-span on (default): no rim above the tree.
        expect(diagOf(diag, treeVi).blendW).toBeGreaterThan(200);
    });

    it('cliff distance mode replaces only the falaise height, sparing pente', () => {
        // Recessed wall (cliff) at column x=12 + a green tree on the flat foot at
        // x=2. The wall is classified falaise; the tree stays pente. `rimDepth`
        // must rewrite the wall points (and decrease with altitude — rim − z) yet
        // leave the green tree byte-identical to the default `column` mode.
        const pts: number[] = [];
        const cls: number[] = [];
        for (let gx = 0; gx <= 40; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                let z = 0;
                if (gx >= 11 && gx <= 13) z = 2;
                else if (gx >= 18 && gx <= 20) z = 18;
                else if (gx >= 30) z = 60;
                pts.push(gx, gy, z); cls.push(2);
            }
        }
        const treeVi = cls.length;               // green tree on the flat foot
        for (const z of [2, 8, 14] as const) { pts.push(2, 5, z); cls.push(5); }
        const wallLo = cls.length;               // low wall return (z=4)
        const wallHi = wallLo + 4;               // high wall return (z=38)
        for (const z of [4, 12, 20, 28, 38] as const) { pts.push(12, 5, z); cls.push(5); }
        const count = cls.length;
        const pos = Float32Array.from(pts);
        const classes = Uint8Array.from(cls);
        const grid = buildVegGroundGrid(pos, count, classes);

        const column = computeVegHeights(pos, classes, count, 3, grid, 12, {});
        const rimDepth = computeVegHeights(pos, classes, count, 3, grid, 12, { cliffDistMode: 'rimDepth' });

        // The green tree is untouched by the cliff override.
        for (let j = 0; j < 3; j++) expect(rimDepth[treeVi + j]).toBe(column[treeVi + j]);
        // The wall (falaise) points are rewritten to a depth-below-rim ramp:
        // higher up the face → smaller depth, so wallHi ≤ wallLo and the low
        // point differs from the stacked column height.
        expect(rimDepth[wallHi]).toBeLessThanOrEqual(rimDepth[wallLo]);
        expect(rimDepth[wallLo]).not.toBe(column[wallLo]);
    });
});

/** Read the 4 diagnostic bytes of point `i`: [blendW, cluster, flags, rough·10]. */
function diagOf(diag: Uint8Array, i: number) {
    const o = i * VEG_DIAG_STRIDE;
    return { blendW: diag[o], cluster: diag[o + 1], flags: diag[o + 2], rough: diag[o + 3] };
}

/** Flat ground (class 2) over a 0..10 m square + one lone canopy point 12 m up. */
function flatGroundCrownDiag() {
    const positions: number[] = [];
    const classes: number[] = [];
    for (let gx = 0; gx <= 10; gx++) {
        for (let gy = 0; gy <= 10; gy++) {
            positions.push(gx, gy, 0);
            classes.push(2);
        }
    }
    positions.push(5.2, 5.2, 12);
    classes.push(5);
    return {
        positions: Float32Array.from(positions),
        classes: Uint8Array.from(classes),
        count: classes.length,
        vegIndex: classes.length - 1,
    };
}

describe('computeVegHeights — decision diagnostics (opts.diag)', () => {
    it('marks every vegetation point and records its stacked cluster id', () => {
        // One XY column with two clusters split by a > gap vertical void.
        const positions = Float32Array.from([
            0, 0, 0, 0, 0, 1, 0, 0, 2, // cluster A (z 0..2)
            0, 0, 10, 0, 0, 11,        // cluster B (z 10..11), gap 8 > 3
        ]);
        const classes = Uint8Array.from([5, 5, 5, 5, 5]);
        const diag = new Uint8Array(5 * VEG_DIAG_STRIDE);
        computeVegHeights(positions, classes, 5, 3, null, 12, { diag });
        for (let i = 0; i < 5; i++) {
            // No grid → init only: VEG flag set.
            expect(diagOf(diag, i).flags & DIAG_FLAG_VEG).toBe(DIAG_FLAG_VEG);
        }
        // The two clusters take different colour ids; within a cluster they match.
        const a = diagOf(diag, 0).cluster;
        const b = diagOf(diag, 4).cluster;
        expect(diagOf(diag, 2).cluster).toBe(a);
        expect(diagOf(diag, 3).cluster).toBe(b);
        expect(a).not.toBe(b);
    });

    it('flags a flat-ground crown as full vertical (pente), gap-independent', () => {
        const { positions, classes, count, vegIndex } = flatGroundCrownDiag();
        const grid = buildVegGroundGrid(positions, count, classes);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(positions, classes, count, 3, grid, 12, { diag });
        const d = diagOf(diag, vegIndex);
        // Flat ground (cell ground is the local rim) → full vertical-to-ground
        // weight, and NOT flagged floating: the étagement (gap) decision is
        // cliff-only, so flat-terrain diagnostics never depend on it.
        expect(d.blendW).toBe(255);
        expect(d.flags & DIAG_FLAG_GROUND).toBe(DIAG_FLAG_GROUND);
        expect(d.flags & DIAG_FLAG_FLOATING).toBe(0);
        expect(d.flags & DIAG_FLAG_CLIFF).toBe(0);
    });

    it('keeps flat-ground diagnostics independent of the étagement (gap) knob', () => {
        const { positions, classes, count, vegIndex } = flatGroundCrownDiag();
        const grid = buildVegGroundGrid(positions, count, classes);
        const diagA = new Uint8Array(count * VEG_DIAG_STRIDE);
        const diagB = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(positions, classes, count, 2, grid, 12, { diag: diagA });
        computeVegHeights(positions, classes, count, 6, grid, 12, { diag: diagB });
        const a = diagOf(diagA, vegIndex), b = diagOf(diagB, vegIndex);
        expect(a.blendW).toBe(b.blendW);
        expect(a.flags).toBe(b.flags);
    });

    it('reads a non-floating point on a cliff face as full stacked (falaise)', () => {
        // A continuous steep face dropping from a plateau (z=40) to a valley
        // (z=0). A short veg return sits ON the face with solid ground right
        // below it (NOT floating), but its cell ground is far below the rim.
        // High roughness alone used to keep it green; it must now read falaise.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                const z = gx <= 4 ? 40 : Math.max(0, 40 - (gx - 4) * 10);
                positions.push(gx, gy, z);
                classes.push(2);
            }
        }
        positions.push(7, 5, 12); // cell ground ≈ 10, rim (z=40) within reach
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const d = diagOf(diag, vegIndex);
        expect(d.blendW).toBeLessThan(64);            // full stacked (falaise)
        expect(d.flags & DIAG_FLAG_CLIFF).toBe(0);    // on the face, not anchored
    });

    it('flags a crown over a cliff cell as full stacked (falaise)', () => {
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 10; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx < 5 ? 0 : 40); // vertical face at x≈5
                classes.push(2);
            }
        }
        positions.push(5.2, 5.2, 12);
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const d = diagOf(diag, vegIndex);
        // High relief → weight on vertical ≈ 0 → stacked branch.
        expect(d.blendW).toBeLessThan(64);
        // It sits ~28 m below the rim, so the overhang anchor must NOT reach up
        // through the face to grab it (no false "surplomb" mid-cliff).
        expect(d.flags & DIAG_FLAG_CLIFF).toBe(0);
    });

    it('still reads a real cliff face as falaise at a low "relief sol max"', () => {
        // A real cliff whose plateau top rises further inland (z=50 beyond the
        // near reach, z=40 at the rim, valley z=0). The far window therefore
        // towers ~10 m over the near max, so the OLD crest test (overRise ≤
        // roughM) flipped to "slope" and GREENED the face once roughM dropped
        // below 10 — i.e. lowering "relief sol max" hid the real cliff. The crest
        // test is now relative to the below-rim drop (independent of roughM), so
        // the face must stay red (falaise) even at a very low roughM.
        const groundZ = (x: number) => {
            if (x <= 6) return 50;  // higher ground inland, only in the far window
            if (x <= 15) return 40; // rim / plateau
            return 0;               // valley
        };
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 40; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, groundZ(gx));
                classes.push(2);
            }
        }
        positions.push(17, 5, 12); // face return ~28 m below the rim, over the void
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const low = new Uint8Array(count * VEG_DIAG_STRIDE);
        const high = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 4, { diag: low });
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag: high });
        // Detected as falaise (full stacked, red) at BOTH a low and the default
        // roughM — the real cliff never disappears as the slider drops.
        expect(diagOf(low, vegIndex).blendW).toBeLessThan(64);
        expect(diagOf(high, vegIndex).blendW).toBeLessThan(64);
    });

    it('does not flag a face return well below the rim as cliff-anchored', () => {
        // Plateau ground z=40 for x≤4 dropping to a valley floor z=0; a lone
        // canopy return at z=12 is rooted mid-face, far below the rim. The
        // overhang anchor must stop at the top, leaving this point un-anchored.
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 4 ? 40 : 0);
                classes.push(2);
            }
        }
        positions.push(7, 5, 12); // mid-face return, ~28 m below the rim
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        expect(diagOf(diag, vegIndex).flags & DIAG_FLAG_CLIFF).toBe(0);
    });

    it('does not flag a tree on a continuous slope as cliff-anchored', () => {
        // A uniform moderate slope (no cliff, no void) rising ~0.55 m/m. Its 8 m
        // rise exceeds roughM so the cell looks "cliff", and the tree's narrow
        // stacked column reads ≈0 so it looks "floating" — yet the ground keeps
        // rising far past the near reach, so the crest gate (reachFar towers over
        // reachMax) must keep it un-anchored: it is a pente, not a surplomb.
        const slopeZ = (x: number) => x * 1.6;
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 40; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, slopeZ(gx));
                classes.push(2);
            }
        }
        // Lone canopy point 10 m above the slope ground at x=20 (no trunk in its
        // own column → stacked ≈ 0), with solid sloping ground right below.
        positions.push(20, 5, slopeZ(20) + 10);
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const ds = diagOf(diag, vegIndex);
        expect(ds.flags & DIAG_FLAG_CLIFF).toBe(0);
        // A pente (green in the Mode render) must NOT carry the floating flag —
        // otherwise the Drapeaux render paints it orange while Mode shows green.
        expect(ds.flags & DIAG_FLAG_FLOATING).toBe(0);
    });

    it('does not redden a continuous slope into falaise as the overhang reach widens', () => {
        // The "portée surplomb" reach only widens the overhang ANCHOR search; it
        // must not reclassify a continuous slope as a cliff. On a uniform slope a
        // wider reach lifts the in-window max ground (pushing belowRim past
        // roughM), but the ground keeps rising past the near reach (not a crest),
        // so the point must stay green (vertical-to-ground / pente) at every reach.
        const slopeZ = (x: number) => x * 1.6;
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 120; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, slopeZ(gx));
                classes.push(2);
            }
        }
        positions.push(60, 5, slopeZ(60) + 8); // a tree on the slope, ground below it
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const near = new Uint8Array(count * VEG_DIAG_STRIDE);
        const wide = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { overhangReachM: 4, diag: near });
        computeVegHeights(pos, cls, count, 3, grid, 12, { overhangReachM: 24, diag: wide });
        // Green (vertical-to-ground) at both the narrow and the wide reach.
        expect(diagOf(near, vegIndex).blendW).toBeGreaterThan(200);
        expect(diagOf(wide, vegIndex).blendW).toBeGreaterThan(200);
    });

    it('reads a non-floating tree on a high-relief rim as full vertical (pente)', () => {
        // A plateau (z=40) edge dropping to a valley (z=0). A short tree sits ON
        // the plateau one cell inside the rim: solid ground right below it, so it
        // is NOT floating — but its 3×3 ground relief is large. The decision must
        // trust the vertical height (green/pente), not fall to stacked (red).
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 8 ? 40 : 0); // rim between x=8 and x=9
                classes.push(2);
            }
        }
        // Trunk + canopy at x=7 (on the plateau, near the rim): a real 6 m tree.
        positions.push(7, 5, 41, 7, 5, 43, 7, 5, 46);
        classes.push(5, 5, 5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        const h = computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const d = diagOf(diag, vegIndex);
        expect(d.blendW).toBe(255);                       // full vertical (pente)
        expect(d.flags & DIAG_FLAG_FLOATING).toBe(0);     // ground is right below
        expect(d.flags & DIAG_FLAG_CLIFF).toBe(0);
        expect(h[vegIndex]).toBeCloseTo(6, 5);            // 46 − 40 = real height
    });

    it('flags a crown overhanging a cliff rim as cliff-anchored', () => {
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 16; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, gx <= 4 ? 40 : 0);
                classes.push(2);
            }
        }
        positions.push(9, 5, 48); // crown 5 m past the rim, over the valley
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const d = diagOf(diag, vegIndex);
        expect(d.flags & DIAG_FLAG_CLIFF).toBe(DIAG_FLAG_CLIFF);
        expect(d.flags & DIAG_FLAG_FLOATING).toBe(DIAG_FLAG_FLOATING);
    });

    it('does not flag a tall tree at the foot of a cliff as cliff-anchored', () => {
        // A long ramp face: plateau z=40 (x≤8) sloping down to a valley z=0
        // (x≥24). A tall tree stands at the foot (x=24). The near reach window
        // only climbs part-way up the face, so its local high ground (~17 m)
        // sits within `dropM` of the tree top — the old rule wrongly anchored it
        // ("surplomb en bas"). The far window catches the true rim (40 m)
        // towering above, so the crest gate now leaves it un-anchored.
        const rampZ = (x: number) => {
            if (x <= 8) return 40;
            if (x >= 24) return 0;
            return 40 - 2.5 * (x - 8);
        };
        const positions: number[] = [];
        const classes: number[] = [];
        for (let gx = 0; gx <= 40; gx++) {
            for (let gy = 0; gy <= 10; gy++) {
                positions.push(gx, gy, rampZ(gx));
                classes.push(2);
            }
        }
        positions.push(24, 5, 22); // 22 m tree at the cliff foot, over the valley
        classes.push(5);
        const count = classes.length;
        const vegIndex = count - 1;
        const pos = Float32Array.from(positions);
        const cls = Uint8Array.from(classes);
        const grid = buildVegGroundGrid(pos, count, cls);
        const diag = new Uint8Array(count * VEG_DIAG_STRIDE);
        computeVegHeights(pos, cls, count, 3, grid, 12, { diag });
        const df = diagOf(diag, vegIndex);
        expect(df.flags & DIAG_FLAG_CLIFF).toBe(0);
        // The cliff-foot tree shows green (pente) in the Mode render, so its
        // floating flag must be cleared too (Drapeaux/Mode consistency).
        expect(df.flags & DIAG_FLAG_FLOATING).toBe(0);
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
