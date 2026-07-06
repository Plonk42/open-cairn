/**
 * Synthetic "brick base" points for PoissonRecon.
 *
 * Fed a top-only oriented point set, the Poisson (Dirichlet) solver seals the
 * underside into a smooth bulging *cushion* — there is simply no geometry to
 * tell it where the bottom is. To carve the relief onto a flat-bottomed brick
 * instead, we synthesize a closed shell UNDER the terrain: a horizontal FLOOR a
 * few metres below the lowest ground point (normals pointing down) plus vertical
 * WALL columns around the footprint silhouette (normals pointing outward). Those
 * oriented points are appended to the ground point set before reconstruction, so
 * Poisson's watertight machinery produces vertical sides and a flat base.
 *
 * All coordinates are east/north/up meter offsets — the same frame as
 * {@link VegGroundGrid} and the rest of the browser pipeline.
 */

import type { VegGroundGrid } from './groundHeight';

/** Depth (m) of the flat base below the lowest ground point. A few metres of
 *  solid brick under the terrain so the socle reads as a deliberate plinth
 *  rather than skimming the relief. */
export const POISSON_BASE_MARGIN_M = 3;

/** Target spacing (m) of the synthesized floor grid and wall columns. Coarser
 *  than the octree resolution is plenty for flat planes and keeps the extra
 *  point budget small (a few tens of thousands at most). */
export const POISSON_BASE_STEP_M = 4;

export interface PoissonBaseOptions {
    /** Base depth below the lowest ground point (m). Default {@link POISSON_BASE_MARGIN_M}. */
    marginM?: number;
    /** Floor/wall point spacing (m). Default {@link POISSON_BASE_STEP_M}. */
    stepM?: number;
}

/** 4-neighbourhood (von Neumann) offsets used for silhouette detection. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
];

/** Lowest finite ground elevation in the grid, or `NaN` when it is all empty. */
function lowestGround(groundZ: Float32Array): number {
    let minZ = Infinity;
    for (const z of groundZ) {
        if (Number.isFinite(z) && z < minZ) minZ = z;
    }
    return Number.isFinite(minZ) ? minZ : Number.NaN;
}

/**
 * Flag every empty cell reachable from the grid border by 4-connected flood
 * fill. These are the cells *outside* the terrain silhouette; empty cells NOT
 * flagged are interior holes (e.g. a forest patch with no ground return) that
 * must stay covered by the brick rather than becoming an internal wall.
 */
function markExterior(groundZ: Float32Array, cols: number, rows: number): Uint8Array {
    const ext = new Uint8Array(cols * rows);
    const stack: number[] = [];
    const seed = (cx: number, cy: number): void => {
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
        const k = cy * cols + cx;
        if (ext[k] || Number.isFinite(groundZ[k])) return;
        ext[k] = 1;
        stack.push(k);
    };
    for (let cx = 0; cx < cols; cx++) { seed(cx, 0); seed(cx, rows - 1); }
    for (let cy = 0; cy < rows; cy++) { seed(0, cy); seed(cols - 1, cy); }
    while (stack.length) {
        const k = stack.pop() ?? 0;
        const cx = k % cols;
        const cy = (k - cx) / cols;
        seed(cx - 1, cy); seed(cx + 1, cy); seed(cx, cy - 1); seed(cx, cy + 1);
    }
    return ext;
}

/** True when cell (cx, cy) lies inside the terrain silhouette (covered ground
 *  or an interior hole — anything that is not exterior). */
function isInside(ext: Uint8Array, cols: number, rows: number, cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    return ext[cy * cols + cx] === 0;
}

/**
 * Outward horizontal unit normal for a silhouette-boundary cell: the normalized
 * sum of the offsets toward its exterior 4-neighbours. Returns `null` for an
 * interior cell (no exterior neighbour → no wall). Straight edges give an
 * axis-aligned normal, corners give a diagonal.
 */
function outwardNormal(
    ext: Uint8Array, cols: number, rows: number, cx: number, cy: number,
): readonly [number, number] | null {
    let ox = 0, oy = 0;
    for (const [dx, dy] of NEIGHBOURS) {
        if (!isInside(ext, cols, rows, cx + dx, cy + dy)) { ox += dx; oy += dy; }
    }
    if (ox === 0 && oy === 0) return null;
    const len = Math.hypot(ox, oy);
    return [ox / len, oy / len];
}

/** Wall-top elevation for a boundary cell: its own ground if known, else the
 *  highest finite ground among its 3×3 neighbours (edge holes), else `baseZ`. */
function wallTop(
    groundZ: Float32Array, cols: number, rows: number, cx: number, cy: number, baseZ: number,
): number {
    const own = groundZ[cy * cols + cx];
    if (Number.isFinite(own)) return own;
    let best = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const v = groundZ[ny * cols + nx];
            if (Number.isFinite(v) && v > best) best = v;
        }
    }
    return best > -Infinity ? best : baseZ;
}

/** Emit one downward floor point per strided interior cell, so the brick stays
 *  solid even under forest gaps (interior holes). */
function emitFloor(grid: VegGroundGrid, ext: Uint8Array, baseZ: number, stride: number, out: number[]): void {
    const { minX, minY, cell, cols, rows } = grid;
    for (let cy = 0; cy < rows; cy += stride) {
        for (let cx = 0; cx < cols; cx += stride) {
            if (!isInside(ext, cols, rows, cx, cy)) continue;
            out.push(minX + (cx + 0.5) * cell, minY + (cy + 0.5) * cell, baseZ, 0, 0, -1);
        }
    }
}

/** Emit a vertical wall column at every interior cell touching the exterior,
 *  from the base up to the local ground, normal pointing outward. */
function emitWalls(grid: VegGroundGrid, ext: Uint8Array, baseZ: number, stepM: number, out: number[]): void {
    const { minX, minY, cell, cols, rows, groundZ } = grid;
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            if (!isInside(ext, cols, rows, cx, cy)) continue;
            const normal = outwardNormal(ext, cols, rows, cx, cy);
            if (!normal) continue;
            const top = wallTop(groundZ, cols, rows, cx, cy, baseZ);
            const x = minX + (cx + 0.5) * cell;
            const y = minY + (cy + 0.5) * cell;
            for (let z = baseZ; z < top; z += stepM) {
                out.push(x, y, z, normal[0], normal[1], 0);
            }
        }
    }
}

/**
 * Build the oriented floor + wall points that close the terrain into a
 * flat-bottomed brick.
 *
 * @returns interleaved `[x, y, z, nx, ny, nz]` (6 floats per point) in the
 * grid's east/north/up meter frame. Empty when the grid has no finite cell.
 */
export function buildPoissonBase(grid: VegGroundGrid, opts: PoissonBaseOptions = {}): Float32Array {
    const marginM = opts.marginM ?? POISSON_BASE_MARGIN_M;
    const stepM = opts.stepM ?? POISSON_BASE_STEP_M;

    const minZ = lowestGround(grid.groundZ);
    if (!Number.isFinite(minZ)) return new Float32Array(0);
    const baseZ = minZ - marginM;

    const ext = markExterior(grid.groundZ, grid.cols, grid.rows);
    const stride = Math.max(1, Math.round(stepM / grid.cell));
    const out: number[] = [];
    emitFloor(grid, ext, baseZ, stride, out);
    emitWalls(grid, ext, baseZ, stepM, out);
    return Float32Array.from(out);
}
