import { describe, expect, it } from 'vitest';
import type { VegGroundGrid } from './groundHeight';
import { buildPoissonBase, buildPoissonBaseMask, POISSON_BASE_MARGIN_M, POISSON_WALL_PERIM_M, resolvePoissonBaseRect } from './poissonBase';

interface BasePoint { x: number; y: number; z: number; nx: number; ny: number; nz: number; }

function decode(arr: Float32Array): BasePoint[] {
    const pts: BasePoint[] = [];
    for (let i = 0; i < arr.length; i += 6) {
        pts.push({ x: arr[i], y: arr[i + 1], z: arr[i + 2], nx: arr[i + 3], ny: arr[i + 4], nz: arr[i + 5] });
    }
    return pts;
}

/** Grid whose `groundZ` is supplied cell-by-cell (row-major, NaN for holes). */
function makeGrid(cols: number, rows: number, z: (cx: number, cy: number) => number): VegGroundGrid {
    const groundZ = new Float32Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) groundZ[cy * cols + cx] = z(cx, cy);
    }
    return { minX: 0, minY: 0, cell: 1, cols, rows, groundZ, roughness: new Float32Array(cols * rows) };
}

const floors = (pts: BasePoint[]) => pts.filter((p) => p.nz === -1);
const walls = (pts: BasePoint[]) => pts.filter((p) => p.nz === 0);

/** True when the point lies on one of the outer footprint boundary planes. */
const onBoundary = (p: BasePoint, lo: number, hi: number) =>
    Math.abs(p.x - lo) < 1e-4 || Math.abs(p.x - hi) < 1e-4
    || Math.abs(p.y - lo) < 1e-4 || Math.abs(p.y - hi) < 1e-4;

/** Deterministic sample spacing so the tests don't depend on the octree heuristic. */
const UNIT_STEPS = { floorStepM: 1, wallHStepM: 1, wallVStepM: 1 };

describe('buildPoissonBase', () => {
    it('returns nothing for an all-empty grid', () => {
        const grid = makeGrid(4, 4, () => Number.NaN);
        expect(buildPoissonBase(grid).length).toBe(0);
    });

    it('lays a flat floor a fixed margin below the lowest ground, normals down', () => {
        const grid = makeGrid(4, 4, () => 10);
        const pts = decode(buildPoissonBase(grid, UNIT_STEPS));
        const baseZ = 10 - POISSON_BASE_MARGIN_M;
        const floor = floors(pts);
        // 5x5 grid of floor samples across the 4x4 m footprint at unit spacing.
        expect(floor).toHaveLength(25);
        for (const p of floor) {
            expect(p.z).toBeCloseTo(baseZ);
            expect(p.nx).toBe(0);
            expect(p.ny).toBe(0);
            expect(p.nz).toBe(-1);
        }
    });

    it('walls only the outer silhouette with axis-aligned outward unit normals', () => {
        const grid = makeGrid(4, 4, () => 10);
        const pts = decode(buildPoissonBase(grid, UNIT_STEPS));
        const wall = walls(pts);
        expect(wall.length).toBeGreaterThan(0);
        for (const p of wall) {
            expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1); // horizontal unit
            expect(p.nx === 0 || p.ny === 0).toBe(true); // axis-aligned
            expect(p.nz).toBe(0);
            expect(p.z).toBeGreaterThanOrEqual(10 - POISSON_BASE_MARGIN_M);
            expect(p.z).toBeLessThan(10);
            expect(onBoundary(p, 0, 4)).toBe(true); // never inside the footprint
        }
    });

    it('gives each corner two perpendicular faces', () => {
        const grid = makeGrid(4, 4, () => 10);
        const wall = walls(decode(buildPoissonBase(grid, UNIT_STEPS)));
        // The west edge (x = 0) faces (-1, 0); the south edge (y = 0) faces (0, -1).
        const west = wall.find((p) => Math.abs(p.x) < 1e-4 && p.nx === -1);
        const south = wall.find((p) => Math.abs(p.y) < 1e-4 && p.ny === -1);
        expect(west?.ny === 0).toBe(true);
        expect(south?.nx === 0).toBe(true);
    });

    it('samples walls more densely as the horizontal step shrinks', () => {
        const grid = makeGrid(4, 4, () => 10);
        const coarse = walls(decode(buildPoissonBase(grid, { ...UNIT_STEPS, wallHStepM: 1 })));
        const fine = walls(decode(buildPoissonBase(grid, { ...UNIT_STEPS, wallHStepM: 0.25 })));
        expect(fine.length).toBeGreaterThan(coarse.length * 3);
    });

    it('keeps an interior hole covered without walling it', () => {
        // 5x5 flat grid with a single NaN hole at the centre (2,2).
        const grid = makeGrid(5, 5, (cx, cy) => (cx === 2 && cy === 2 ? Number.NaN : 10));
        const pts = decode(buildPoissonBase(grid, UNIT_STEPS));
        // Floor still spans the hole cell [2,3]² (brick stays solid underneath).
        expect(floors(pts).some((p) => p.x >= 2 && p.x <= 3 && p.y >= 2 && p.y <= 3)).toBe(true);
        // Every wall sits on the outer boundary — the interior hole is never walled.
        for (const p of walls(pts)) expect(onBoundary(p, 0, 5)).toBe(true);
    });
});

describe('buildPoissonBase with an oriented rectangle', () => {
    it('walls an axis-aligned rect exactly on its four edges', () => {
        const grid = makeGrid(4, 4, () => 10);
        const rect = { ux: 1, uy: 0, halfLengthM: 2, halfWidthM: 2, centerX: 2, centerY: 2 };
        const wall = walls(decode(buildPoissonBase(grid, { ...UNIT_STEPS, rect })));
        expect(wall.length).toBeGreaterThan(0);
        for (const p of wall) {
            expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1); // horizontal unit normal
            expect(p.nx === 0 || p.ny === 0).toBe(true); // axis-aligned edges
            expect(onBoundary(p, 0, 4)).toBe(true); // on the rect boundary
        }
    });

    it('follows a rotated rect: diagonal wall normals and a tilted floor', () => {
        const grid = makeGrid(10, 10, () => 10);
        const s = Math.SQRT1_2; // cos/sin 45°
        const rect = { ux: s, uy: s, halfLengthM: 3, halfWidthM: 3, centerX: 5, centerY: 5 };
        const pts = decode(buildPoissonBase(grid, { ...UNIT_STEPS, rect }));
        const wall = walls(pts);
        expect(wall.length).toBeGreaterThan(0);
        for (const p of wall) {
            // Every side of a 45°-rotated square has a diagonal outward normal.
            expect(Math.abs(p.nx)).toBeCloseTo(s);
            expect(Math.abs(p.ny)).toBeCloseTo(s);
        }
        // Floor points stay inside the rotated rectangle (no axis-aligned overshoot).
        const ux = s, uy = s, wx = -s, wy = s;
        for (const p of floors(pts)) {
            const du = (p.x - 5) * ux + (p.y - 5) * uy;
            const dw = (p.x - 5) * wx + (p.y - 5) * wy;
            expect(Math.abs(du)).toBeLessThanOrEqual(3 + 1e-4);
            expect(Math.abs(dw)).toBeLessThanOrEqual(3 + 1e-4);
        }
    });
});

describe('resolvePoissonBaseRect', () => {
    it('returns the supplied rect with a resolved centre', () => {
        const grid = makeGrid(4, 4, () => 10);
        const rect = { ux: 0, uy: 1, halfLengthM: 3, halfWidthM: 2, centerX: 7, centerY: 9 };
        expect(resolvePoissonBaseRect(grid, rect)).toEqual(rect);
    });

    it('synthesises an un-rotated rect spanning the grid footprint', () => {
        const grid = makeGrid(4, 6, () => 10); // cols=4, rows=6, cell=1, origin (0,0)
        const r = resolvePoissonBaseRect(grid);
        expect(r.ux).toBe(1);
        expect(r.uy).toBe(0);
        expect(r.halfWidthM).toBe(2);  // cols * cell / 2
        expect(r.halfLengthM).toBe(3); // rows * cell / 2
        expect(r.centerX).toBe(2);
        expect(r.centerY).toBe(3);
    });
});

describe('buildPoissonBaseMask', () => {
    // rect spans x,y ∈ [-5, 5]; du = x, dw = y; perim = min(5-|x|, 5-|y|).
    const rect = { ux: 1, uy: 0, halfLengthM: 5, halfWidthM: 5, centerX: 0, centerY: 0 };
    const positions = new Float32Array([
        5, 0, 2,   // 0 wall exactly on the +x edge
        0, 0, 2,   // 1 interior cliff (near-vertical but far from the perimeter)
        1, 1, -3,  // 2 floor interior (down normal, far from the perimeter)
        4.9, 0, 5, // 3 terrain top near the edge (up normal)
        4.7, 0, 1, // 4 wall just inside the edge
    ]);
    const normals = new Float32Array([
        1, 0, 0,   // 0 vertical face
        1, 0, 0,   // 1 vertical face
        0, 0, -1,  // 2 floor (down)
        0, 0, 1,   // 3 terrain top (up)
        1, 0, 0,   // 4 vertical face
    ]);

    it('flags only near-vertical faces close to the rectangle perimeter', () => {
        const mask = buildPoissonBaseMask(positions, normals, rect, POISSON_WALL_PERIM_M);
        expect(Array.from(mask)).toEqual([1, 0, 0, 0, 1]);
    });

    it('never flags the terrain top, even at the very edge', () => {
        const mask = buildPoissonBaseMask(positions, normals, rect, POISSON_WALL_PERIM_M);
        expect(mask[3]).toBe(0);
    });
});

