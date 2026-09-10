/**
 * Synthetic "brick base" points for PoissonRecon.
 *
 * Fed a top-only oriented point set, the Poisson (Dirichlet) solver seals the
 * underside into a smooth bulging *cushion* — there is simply no geometry to
 * tell it where the bottom is. To carve the relief onto a flat-bottomed brick
 * instead, we synthesize a closed shell UNDER the terrain: a horizontal FLOOR a
 * few metres below the lowest ground point (normals pointing down) plus four
 * straight vertical WALLS at the footprint bounding box (normals pointing
 * outward). Those oriented points are appended to the ground point set before
 * reconstruction, so Poisson's watertight machinery produces vertical sides and
 * a flat base.
 *
 * ## Flat, coplanar walls
 * Following the rasterised per-cell silhouette made the wall wobble in and out
 * by one cell wherever the capture-edge coverage was ragged, and Poisson turned
 * those steps into vertical grooves. Instead each of the four sides is a single
 * straight plane along the capture rectangle's edge; only the column height
 * follows the terrain. Every point on a side is coplanar, so the wall
 * reconstructs flat — and cheaply, since a flat plane needs no dense anti-alias
 * sampling. The rectangle is the rotated capture footprint (see
 * {@link PoissonBaseRect}); a default square capture is just the same rectangle
 * at bearing 0, so there is a single code path for both.
 *
 * All coordinates are east/north/up meter offsets — the same frame as
 * {@link VegGroundGrid} and the rest of the browser pipeline.
 */

import type { VegGroundGrid } from './groundHeight';

/** Depth (m) of the flat base below the lowest ground point. A few metres of
 *  solid brick under the terrain so the socle reads as a deliberate plinth
 *  rather than skimming the relief. Only a floor: the effective depth also has
 *  to clear {@link POISSON_BASE_MARGIN_CELLS} octree cells. */
export const POISSON_BASE_MARGIN_M = 3;

/**
 * Minimum plinth depth expressed in octree cells. A plinth thinner than the
 * solver's own resolution simply does not exist for it: the wall columns get
 * one or two samples, nothing constrains the underside, and Poisson closes it
 * back into the bulging cushion the socle exists to prevent. The absolute 3 m
 * above is 5 cells on a 300 m capture but half a cell on a 3 km one — hence a
 * second, scale-relative floor.
 */
export const POISSON_BASE_MARGIN_CELLS = 6;

/** Floor sampling step, in octree cells. See the cliff measured in {@link buildPoissonBase}. */
export const FLOOR_STEP_CELLS = 1.5;

/** Octree depth assumed when none is supplied (matches the pipeline default). */
const DEFAULT_POISSON_DEPTH = 9;

/**
 * Cap on the octree depth used to size the socle's floor/wall sample spacing.
 * The floor and walls are perfectly flat/coplanar — unlike the terrain they
 * carry no high-frequency detail, so sampling them at the FULL requested
 * Poisson depth buys no reconstruction quality while `octreeCell` (and thus
 * the point count) shrinks as `1 / 2^depth` per axis. That is a ~4x-per-step
 * blow-up for the wall step (linear in depth) and up to ~16x for the floor
 * (quadratic, area / step²) — plus tall walls (a capture spanning a big
 * elevation range down to one shared base level) multiply the effect further.
 * Depths beyond this cap only make the *terrain* mesh finer; the base keeps
 * sampling as if reconstructed at this depth.
 */
export const POISSON_BASE_MAX_SAMPLE_DEPTH = 9;

/**
 * The oriented capture rectangle in the east/north meter frame. When supplied,
 * the four walls follow these rotated edges exactly (instead of the axis-aligned
 * bounding box), so a tilted capture gets clean sides with no corner overshoot.
 */
export interface PoissonBaseRect {
    /** Unit length-axis direction (east, north). The width axis is `(-uy, ux)`. */
    ux: number;
    uy: number;
    /** Half-extent along the length and width axes (m). */
    halfLengthM: number;
    halfWidthM: number;
    /** Rectangle centre in the meter frame. Defaults to the capture origin (0, 0). */
    centerX?: number;
    centerY?: number;
}

export interface PoissonBaseOptions {
    /** PoissonRecon octree depth the base will be reconstructed at. Drives the
     *  wall/floor sample spacing so it stays below the solver's resolution and
     *  the walls reconstruct flat instead of corrugated. Default 9. */
    depth?: number;
    /** Base depth below the lowest ground point (m). Default {@link POISSON_BASE_MARGIN_M}. */
    marginM?: number;
    /** Oriented capture rectangle. When set, walls follow the rotated edges;
     *  otherwise a default un-rotated rectangle spanning the grid footprint is
     *  used (the axis-aligned square capture). */
    rect?: PoissonBaseRect;
    /** Override the horizontal wall sample spacing (m). Defaults to ≈ half the
     *  octree cell. Mainly for tests. */
    wallHStepM?: number;
    /** Override the vertical wall sample spacing (m). Mainly for tests. */
    wallVStepM?: number;
    /** Override the floor grid spacing (m). Mainly for tests. */
    floorStepM?: number;
}

/** Min/max finite ground elevation, or `null` when the grid is all empty. */
function groundRange(groundZ: Float32Array): { min: number; max: number } | null {
    let min = Infinity, max = -Infinity;
    for (const z of groundZ) {
        if (!Number.isFinite(z)) continue;
        if (z < min) min = z;
        if (z > max) max = z;
    }
    return min <= max ? { min, max } : null;
}

/** Clamp a world offset to a valid cell index. */
function cellIndex(worldOffset: number, cell: number, n: number): number {
    return Math.min(n - 1, Math.max(0, Math.floor(worldOffset / cell)));
}

/**
 * Side (m) of the solver's finest octree cell: PoissonRecon cubes the sample
 * bounding box and subdivides it `depth` times, so the cell is the largest bbox
 * side over 2^depth. Everything the socle emits is sized in these units — a
 * feature smaller than one cell does not exist for the solver. Measured on the
 * un-margined Z range: the margin derives from the cell, so feeding it back in
 * would be circular.
 */
function octreeCellM(grid: VegGroundGrid, range: { min: number; max: number }, depth: number): number {
    const extentXY = Math.max(grid.cols, grid.rows) * grid.cell;
    return Math.max(extentXY, range.max - range.min) / 2 ** depth;
}

/** {@link PoissonBaseRect} with its centre resolved to concrete coordinates. */
export interface ResolvedRect extends PoissonBaseRect { centerX: number; centerY: number; }

/** Shared context for the oriented (rotation-following) emit helpers. */
interface OrientedContext {
    grid: VegGroundGrid;
    baseZ: number;
    hStep: number;
    vStep: number;
    floorStep: number;
    out: number[];
    rect: ResolvedRect;
}

/** Terrain elevation at meter position (x, y), or `NaN` when that cell is empty. */
function groundAt(grid: VegGroundGrid, x: number, y: number): number {
    const cx = cellIndex(x - grid.minX, grid.cell, grid.cols);
    const cy = cellIndex(y - grid.minY, grid.cell, grid.rows);
    return grid.groundZ[cy * grid.cols + cx];
}

/** Fill the rotated rectangle interior with downward floor points at `baseZ`. */
function emitOrientedFloor(ctx: OrientedContext): void {
    const { rect, floorStep, baseZ, out } = ctx;
    const { ux, uy, halfLengthM: L, halfWidthM: W, centerX, centerY } = rect;
    const wx = -uy, wy = ux; // width axis (left-perpendicular of the length axis)
    for (let su = -L; su <= L; su += floorStep) {
        for (let sw = -W; sw <= W; sw += floorStep) {
            out.push(centerX + ux * su + wx * sw, centerY + uy * su + wy * sw, baseZ, 0, 0, -1);
        }
    }
}

/**
 * One straight wall along a rectangle edge. Points are laid on the exact edge
 * line (outward normal `n`), spanning `±halfSpan` along tangent `t`, so every
 * point is coplanar and the wall reconstructs flat. Each column's top follows
 * the terrain, sampled a cell inside the edge to reliably land on covered ground.
 */
function emitEdge(
    ctx: OrientedContext,
    nx: number, ny: number, extent: number,
    tx: number, ty: number, halfSpan: number,
): void {
    const { rect, grid, baseZ, vStep, hStep, out } = ctx;
    const inset = grid.cell;
    for (let s = -halfSpan; s <= halfSpan; s += hStep) {
        const px = rect.centerX + nx * extent + tx * s;
        const py = rect.centerY + ny * extent + ty * s;
        const top = groundAt(grid, px - nx * inset, py - ny * inset);
        if (Number.isNaN(top) || top <= baseZ) continue;
        for (let z = baseZ; z < top; z += vStep) out.push(px, py, z, nx, ny, 0);
    }
}

/** The four straight walls of the rotated rectangle (two long sides, two ends). */
function emitOrientedWalls(ctx: OrientedContext): void {
    const { ux, uy, halfLengthM: L, halfWidthM: W } = ctx.rect;
    const wx = -uy, wy = ux;
    emitEdge(ctx, wx, wy, W, ux, uy, L);   // +width side
    emitEdge(ctx, -wx, -wy, W, ux, uy, L); // -width side
    emitEdge(ctx, ux, uy, L, wx, wy, W);   // +length end
    emitEdge(ctx, -ux, -uy, L, wx, wy, W); // -length end
}

/** The oriented rectangle to wall: the caller's rotated rect, or a default
 *  un-rotated one spanning the grid's axis-aligned footprint. A square capture
 *  is just a rectangle at bearing 0, so it needs no special path. */
export function resolvePoissonBaseRect(grid: VegGroundGrid, rect?: PoissonBaseRect): ResolvedRect {
    if (rect) return { ...rect, centerX: rect.centerX ?? 0, centerY: rect.centerY ?? 0 };
    const halfW = (grid.cols * grid.cell) / 2;
    const halfL = (grid.rows * grid.cell) / 2;
    return {
        ux: 1, uy: 0,
        halfLengthM: halfL,
        halfWidthM: halfW,
        centerX: grid.minX + halfW,
        centerY: grid.minY + halfL,
    };
}

/** Minimum distance (m) from the rectangle edge within which a near-vertical
 *  vertex is treated as a base wall. The effective band grows with the octree
 *  cell (see {@link poissonBaseWallPerimM}) so it always spans at least the
 *  solver's sampling resolution — a fixed sub-metre band catches nothing on
 *  large captures, where reconstructed wall vertices sit a cell or two off the
 *  ideal boundary plane. */
export const POISSON_WALL_PERIM_M = 0.6;

/**
 * Recommended {@link buildPoissonBaseMask} `perimM` for a grid: reconstructed
 * wall vertices land within roughly one octree cell of the ideal boundary
 * plane, so the capture band must scale with the solver resolution rather than
 * stay a fixed sub-metre value.
 */
export function poissonBaseWallPerimM(grid: VegGroundGrid, depth = DEFAULT_POISSON_DEPTH): number {
    const range = groundRange(grid.groundZ);
    if (!range) return POISSON_WALL_PERIM_M;
    return Math.max(POISSON_WALL_PERIM_M, octreeCellM(grid, range, depth) * 1.5);
}

/** A near-vertical vertex is a wall when its normal's up-component is below this
 *  (walls ≈ 0, floor ≈ -1); larger values are the terrain top. */
const WALL_MAX_NZ = 0.35;

/**
 * Per-vertex mask flagging the synthetic base *walls* on a reconstructed mesh:
 * near-vertical faces within `perimM` of the capture rectangle's perimeter. The
 * terrain top (normal pointing up) and interior cliffs (far from the perimeter)
 * are excluded, so the renderer can texture only the plinth sides. `1` = wall.
 */
export function buildPoissonBaseMask(
    positions: Float32Array, normals: Float32Array, rect: ResolvedRect, perimM: number,
): Uint8Array {
    const n = positions.length / 3;
    const mask = new Uint8Array(n);
    const { ux, uy, halfLengthM, halfWidthM, centerX, centerY } = rect;
    const wx = -uy, wy = ux;
    for (let i = 0; i < n; i++) {
        if (normals[i * 3 + 2] > WALL_MAX_NZ) continue; // terrain top, not a wall
        const dx = positions[i * 3] - centerX;
        const dy = positions[i * 3 + 1] - centerY;
        const du = dx * ux + dy * uy;
        const dw = dx * wx + dy * wy;
        const perim = Math.min(halfLengthM - Math.abs(du), halfWidthM - Math.abs(dw));
        if (perim <= perimM) mask[i] = 1; // on (or just outside) the rectangle edge
    }
    return mask;
}

/** Elevation of the socle's flat underside; `null` when the grid has no finite cell. */
function poissonBaseZ(grid: VegGroundGrid, opts: PoissonBaseOptions = {}): number | null {
    const range = groundRange(grid.groundZ);
    if (!range) return null;
    const sampleDepth = Math.min(opts.depth ?? DEFAULT_POISSON_DEPTH, POISSON_BASE_MAX_SAMPLE_DEPTH);
    const marginM = opts.marginM
        ?? Math.max(POISSON_BASE_MARGIN_M, octreeCellM(grid, range, sampleDepth) * POISSON_BASE_MARGIN_CELLS);
    return range.min - marginM;
}

/**
 * Build the oriented floor + wall points that close the terrain into a
 * flat-bottomed brick.
 *
 * @returns interleaved `[x, y, z, nx, ny, nz]` (6 floats per point) in the
 * grid's east/north/up meter frame. Empty when the grid has no finite cell.
 */
export function buildPoissonBase(grid: VegGroundGrid, opts: PoissonBaseOptions = {}): Float32Array {
    const range = groundRange(grid.groundZ);
    const baseZ = poissonBaseZ(grid, opts);
    if (!range || baseZ === null) return new Float32Array(0);

    // Octree cell ≈ largest bbox side / 2^depth. Coplanar walls no longer alias,
    // so the spacing only needs to stay near the solver resolution — capped at
    // POISSON_BASE_MAX_SAMPLE_DEPTH so a high terrain-detail depth doesn't also
    // force a needlessly dense (and, on tall walls, hugely inflated) socle.
    const depth = opts.depth ?? DEFAULT_POISSON_DEPTH;
    const sampleDepth = Math.min(depth, POISSON_BASE_MAX_SAMPLE_DEPTH);
    const octreeCell = octreeCellM(grid, range, sampleDepth);

    // The steps are multiples of the octree cell and must stay so: the solver
    // works in cell units, so an absolute metre ceiling here freezes the socle's
    // density in metres while the capture grows — a 3 km footprint emitted 1.6 M
    // base points for 383 k ground points.
    // The wall is sampled every cell, not every other one: combined with the
    // margin above it guarantees POISSON_BASE_MARGIN_CELLS samples on even the
    // shortest column, which is what actually holds the underside flat.
    const hStep = opts.wallHStepM ?? Math.max(0.25, octreeCell);
    const vStep = opts.wallVStepM ?? Math.max(0.5, octreeCell);
    // The floor step has a cliff, measured on the production solver over a 3 km
    // capture: 2 cells overshoots the floor by 0.9 cell, 2.75 by 6.9 and 3 by
    // 50 — past ~2.5 cells the plane carries too few samples per finest node to
    // exist for the solver, and the underside sags hundreds of metres through
    // it. No absolute floor here: a metre clamp is 2.6 cells on a 300 m capture.
    const floorStep = opts.floorStepM ?? octreeCell * FLOOR_STEP_CELLS;

    const rect = resolvePoissonBaseRect(grid, opts.rect);
    const ctx: OrientedContext = { grid, baseZ, hStep, vStep, floorStep, out: [], rect };
    emitOrientedFloor(ctx);
    emitOrientedWalls(ctx);
    return Float32Array.from(ctx.out);
}
