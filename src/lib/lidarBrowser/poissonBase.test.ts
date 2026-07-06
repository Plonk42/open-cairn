import { describe, expect, it } from 'vitest';
import type { VegGroundGrid } from './groundHeight';
import { buildPoissonBase, POISSON_BASE_MARGIN_M } from './poissonBase';

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

describe('buildPoissonBase', () => {
    it('returns nothing for an all-empty grid', () => {
        const grid = makeGrid(4, 4, () => Number.NaN);
        expect(buildPoissonBase(grid).length).toBe(0);
    });

    it('lays a flat floor a fixed margin below the lowest ground, normals down', () => {
        const grid = makeGrid(4, 4, () => 10);
        const pts = decode(buildPoissonBase(grid, { stepM: 1 }));
        const baseZ = 10 - POISSON_BASE_MARGIN_M;
        const floor = floors(pts);
        expect(floor).toHaveLength(16); // one per covered cell at stride 1
        for (const p of floor) {
            expect(p.z).toBeCloseTo(baseZ);
            expect(p.nx).toBe(0);
            expect(p.ny).toBe(0);
            expect(p.nz).toBe(-1);
        }
    });

    it('walls only the outer silhouette with outward unit normals', () => {
        const grid = makeGrid(4, 4, () => 10);
        const pts = decode(buildPoissonBase(grid, { stepM: 1 }));
        const wall = walls(pts);
        expect(wall.length).toBeGreaterThan(0);
        for (const p of wall) {
            expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1); // horizontal unit
            expect(p.nz).toBe(0);
            expect(p.z).toBeGreaterThanOrEqual(10 - POISSON_BASE_MARGIN_M);
            expect(p.z).toBeLessThan(10);
        }
        // Interior cells (cx,cy in 1..2) never carry a wall.
        const interior = wall.filter((p) => p.x > 1.4 && p.x < 2.6 && p.y > 1.4 && p.y < 2.6);
        expect(interior).toHaveLength(0);
    });

    it('gives corners a diagonal outward normal', () => {
        const grid = makeGrid(4, 4, () => 10);
        const pts = decode(buildPoissonBase(grid, { stepM: 1 }));
        // Bottom-left corner cell centre is (0.5, 0.5); its normal points (-,-).
        const corner = walls(pts).find((p) => p.x === 0.5 && p.y === 0.5);
        expect(corner).toBeDefined();
        expect(corner?.nx).toBeCloseTo(-Math.SQRT1_2);
        expect(corner?.ny).toBeCloseTo(-Math.SQRT1_2);
    });

    it('keeps an interior hole covered without walling it', () => {
        // 5x5 flat grid with a single NaN hole at the centre (2,2).
        const grid = makeGrid(5, 5, (cx, cy) => (cx === 2 && cy === 2 ? Number.NaN : 10));
        const pts = decode(buildPoissonBase(grid, { stepM: 1 }));
        // Floor still covers the hole centre (brick stays solid underneath).
        expect(floors(pts).some((p) => p.x === 2.5 && p.y === 2.5)).toBe(true);
        // None of the hole's orthogonal neighbours become walls.
        const holeNeighbours = walls(pts).filter((p) =>
            (p.x === 2.5 && (p.y === 1.5 || p.y === 3.5))
            || (p.y === 2.5 && (p.x === 1.5 || p.x === 3.5)));
        expect(holeNeighbours).toHaveLength(0);
    });
});
