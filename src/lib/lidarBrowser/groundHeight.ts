/**
 * Height-above-ground estimation for LiDAR point clouds.
 *
 * Builds a coarse XY height-field from the ground points (LAS class 2 = sol,
 * class 9 = eau, both lie on the terrain surface) by taking the minimum Z per
 * grid cell, then fills small holes so every cell near ground has a value.
 * Sampling that field at any point gives `z - groundZ`, i.e. the height of the
 * point above the local terrain — the natural driver for vegetation coloring
 * (trunk ≈ 0, canopy top = full tree height).
 *
 * All positions are east/north/up meter offsets (the same frame used
 * throughout the browser pipeline).
 */

const GROUND_CLASSES = new Set([2, 9]);
/** Sentinel for an empty grid cell (no ground point yet). */
const EMPTY = Number.POSITIVE_INFINITY;

export interface GroundHeightGrid {
    minX: number;
    minY: number;
    cellSize: number;
    cols: number;
    rows: number;
    /** Min ground Z per cell; `EMPTY` where no ground was found after hole-fill. */
    heights: Float32Array;
}

interface Bounds {
    minX: number; minY: number; maxX: number; maxY: number; groundCount: number;
}

/** Grid geometry shared by the accumulation and sampling passes. */
interface GridGeom {
    minX: number; minY: number; cellSize: number; cols: number; rows: number;
}

function groundBounds(
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
): Bounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, groundCount = 0;
    for (let i = 0; i < pointCount; i++) {
        if (!GROUND_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        groundCount++;
    }
    return { minX, minY, maxX, maxY, groundCount };
}

function accumulateMinZ(
    heights: Float32Array, geom: GridGeom,
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
): void {
    const { minX, minY, cellSize, cols, rows } = geom;
    for (let i = 0; i < pointCount; i++) {
        if (!GROUND_CLASSES.has(classifications[i])) continue;
        const cx = Math.min(cols - 1, Math.floor((positions[i * 3] - minX) / cellSize));
        const cy = Math.min(rows - 1, Math.floor((positions[i * 3 + 1] - minY) / cellSize));
        const idx = cy * cols + cx;
        const z = positions[i * 3 + 2];
        if (z < heights[idx]) heights[idx] = z;
    }
}

/**
 * Build a min-Z ground height-field from the class 2/9 points of a cloud.
 * Returns `null` when the cloud carries no ground points (nothing to sample
 * against — callers then treat every height as unknown / 0).
 */
export function buildGroundHeightGrid(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    cellSize = 3,
): GroundHeightGrid | null {
    const { minX, minY, maxX, maxY, groundCount } = groundBounds(positions, classifications, pointCount);
    if (groundCount === 0) return null;

    const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
    const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);
    const heights = new Float32Array(cols * rows).fill(EMPTY);

    accumulateMinZ(heights, { minX, minY, cellSize, cols, rows }, positions, classifications, pointCount);
    fillHoles(heights, cols, rows);
    return { minX, minY, cellSize, cols, rows, heights };
}

/** Mean of the filled 8-neighbours of cell (cx,cy), or `EMPTY` if all empty. */
function neighbourMean(src: Float32Array, cols: number, rows: number, cx: number, cy: number): number {
    let sum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            if ((dx === 0 && dy === 0) || nx < 0 || nx >= cols) continue;
            const v = src[ny * cols + nx];
            if (v !== EMPTY) { sum += v; count++; }
        }
    }
    return count > 0 ? sum / count : EMPTY;
}

/** One hole-fill pass; returns true if at least one empty cell was filled. */
function fillHolesPass(heights: Float32Array, cols: number, rows: number): boolean {
    const snapshot = heights.slice();
    let filledAny = false;
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const idx = cy * cols + cx;
            if (snapshot[idx] !== EMPTY) continue;
            const m = neighbourMean(snapshot, cols, rows, cx, cy);
            if (m !== EMPTY) { heights[idx] = m; filledAny = true; }
        }
    }
    return filledAny;
}

/**
 * Fill empty cells with the mean of their filled 8-neighbours, a few passes so
 * the values spread across small gaps (sparse ground under dense canopy).
 */
function fillHoles(heights: Float32Array, cols: number, rows: number): void {
    const PASSES = 4;
    for (let pass = 0; pass < PASSES; pass++) {
        if (!fillHolesPass(heights, cols, rows)) break;
    }
}

/**
 * Sample the ground height-field at every point and return `z - groundZ`
 * (clamped at 0; negative artefacts from a coarse grid collapse to ground).
 * Points over an unfilled cell get height 0 (treated as ground).
 */
export function sampleHeightAboveGround(
    grid: GroundHeightGrid,
    positions: Float32Array,
    pointCount: number,
): Float32Array {
    const { minX, minY, cellSize, cols, rows, heights } = grid;
    const out = new Float32Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
        const cx = Math.min(cols - 1, Math.max(0, Math.floor((positions[i * 3] - minX) / cellSize)));
        const cy = Math.min(rows - 1, Math.max(0, Math.floor((positions[i * 3 + 1] - minY) / cellSize)));
        const groundZ = heights[cy * cols + cx];
        out[i] = groundZ === EMPTY ? 0 : Math.max(0, positions[i * 3 + 2] - groundZ);
    }
    return out;
}

/**
 * Convenience for the shaded-cloud path where the queried points are the same
 * cloud the grid is built from. Returns `null` when there are no ground points.
 */
export function computeHeightAboveGround(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    cellSize = 3,
): Float32Array | null {
    const grid = buildGroundHeightGrid(positions, classifications, pointCount, cellSize);
    if (!grid) return null;
    return sampleHeightAboveGround(grid, positions, pointCount);
}
