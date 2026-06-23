/**
 * Treetop detection for coherent per-tree vegetation coloring.
 *
 * BD Forêt tags a *stand* with its dominant species, but a "mixed" stand has no
 * per-point ground truth. To render such stands as a plausible forest rather
 * than random noise, we want every point of one tree to share a color. This
 * module derives a per-point *tree seed*: points belonging to the same canopy
 * crown get the same seed, so the GPU can pick one species per tree.
 *
 * Pipeline (Popescu & Wynne variable-window local maxima):
 *   1. Build a Canopy Height Model (CHM) — max height-above-ground per ~1 m cell
 *      over the vegetation points.
 *   2. Find treetops = CHM cells that are the local maximum within a window
 *      whose radius grows with tree height (taller crowns are wider).
 *   3. Grow each treetop's crown disk into a seed grid (nearest treetop wins),
 *      then every point inherits its CHM cell's seed.
 *
 * Pure and deterministic: re-runnable client-side when the user tunes the
 * detection sensitivity, with no re-fetch. Positions are east/north/up meter
 * offsets, the standard browser-pipeline frame.
 */

const VEG_CLASSES = new Set([3, 4, 5]);
const EMPTY = -1;
/** Per-point sentinel: no treetop assigned (low veg / outside any crown). */
export const TREE_SEED_NONE = 255;

export interface TreetopOptions {
    /** CHM cell size in meters. */
    chmCell?: number;
    /** Minimum height-above-ground for a cell to be a treetop (m). */
    minHeight?: number;
    /** Crown radius model: radius = crownA + crownB · height (meters). */
    crownA?: number;
    crownB?: number;
    /** 0–1 detection sensitivity; higher → smaller window → more treetops. */
    sensitivity?: number;
}

const DEFAULTS = {
    chmCell: 1,
    minHeight: 2,
    crownA: 1.2,
    crownB: 0.1,
    sensitivity: 0.5,
};

interface ChmGrid {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Max height-above-ground per cell; `EMPTY` where no vegetation. */
    heights: Float32Array;
}

interface Bounds {
    minX: number; minY: number; maxX: number; maxY: number; count: number;
}

function vegBounds(
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
): Bounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
    }
    return { minX, minY, maxX, maxY, count };
}

function cellX(grid: ChmGrid, x: number): number {
    return Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cell)));
}
function cellY(grid: ChmGrid, y: number): number {
    return Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cell)));
}

function buildChm(
    positions: Float32Array,
    classifications: Uint8Array,
    heightAboveGround: Float32Array,
    pointCount: number,
    cell: number,
): ChmGrid | null {
    const b = vegBounds(positions, classifications, pointCount);
    if (b.count === 0) return null;
    const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell) + 1);
    const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell) + 1);
    const heights = new Float32Array(cols * rows).fill(EMPTY);
    const grid: ChmGrid = { minX: b.minX, minY: b.minY, cell, cols, rows, heights };
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_CLASSES.has(classifications[i])) continue;
        const idx = cellY(grid, positions[i * 3 + 1]) * cols + cellX(grid, positions[i * 3]);
        const h = heightAboveGround[i];
        if (h > heights[idx]) heights[idx] = h;
    }
    return grid;
}

interface Treetop {
    cx: number;
    cy: number;
    height: number;
}

/** Is cell (cx,cy) the strict local maximum of its variable-size window? */
function isLocalMax(
    grid: ChmGrid, cx: number, cy: number, h: number, windowScale: number,
): boolean {
    const { cols, rows, cell, heights } = grid;
    const radiusM = DEFAULTS.crownA + DEFAULTS.crownB * h;
    const r = Math.max(1, Math.round((radiusM * windowScale) / cell));
    const idx = cy * cols + cx;
    for (let dy = -r; dy <= r; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -r; dx <= r; dx++) {
            const nx = cx + dx;
            if ((dx === 0 && dy === 0) || nx < 0 || nx >= cols) continue;
            const nIdx = ny * cols + nx;
            const nh = heights[nIdx];
            // Strict max; ties broken by linear index so one cell wins a plateau.
            if (nh > h || (nh === h && nIdx < idx)) return false;
        }
    }
    return true;
}

function findTreetops(grid: ChmGrid, minHeight: number, windowScale: number): Treetop[] {
    const { cols, rows, heights } = grid;
    const tops: Treetop[] = [];
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const h = heights[cy * cols + cx];
            if (h < minHeight) continue;
            if (isLocalMax(grid, cx, cy, h, windowScale)) {
                tops.push({ cx, cy, height: h });
            }
        }
    }
    return tops;
}

/** Stable, well-distributed seed (0–254) for a treetop from its cell index. */
function treetopSeed(idx: number): number {
    const s = (Math.imul(idx + 1, 2654435761) >>> 24) & 0xff;
    return s === TREE_SEED_NONE ? 254 : s;
}

/** Stamp one treetop's crown disk into the seed/dist grids (nearest wins). */
function stampCrown(
    grid: ChmGrid, seedGrid: Uint8Array, distGrid: Float32Array,
    t: Treetop, crownA: number, crownB: number,
): void {
    const { cols, rows, cell } = grid;
    const cr = crownA + crownB * t.height;
    const cr2 = cr * cr;
    const rCells = Math.max(1, Math.ceil(cr / cell));
    const seed = treetopSeed(t.cy * cols + t.cx);
    for (let dy = -rCells; dy <= rCells; dy++) {
        const ny = t.cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -rCells; dx <= rCells; dx++) {
            const nx = t.cx + dx;
            if (nx < 0 || nx >= cols) continue;
            const d2 = (dx * cell) * (dx * cell) + (dy * cell) * (dy * cell);
            if (d2 > cr2) continue;
            const idx = ny * cols + nx;
            if (d2 < distGrid[idx]) {
                distGrid[idx] = d2;
                seedGrid[idx] = seed;
            }
        }
    }
}

/** Stamp each treetop's crown disk into a seed grid; nearest treetop wins. */
function growCrowns(grid: ChmGrid, tops: Treetop[], crownA: number, crownB: number): Uint8Array {
    const { cols, rows } = grid;
    const seedGrid = new Uint8Array(cols * rows).fill(TREE_SEED_NONE);
    const distGrid = new Float32Array(cols * rows).fill(Infinity);
    for (const t of tops) {
        stampCrown(grid, seedGrid, distGrid, t, crownA, crownB);
    }
    return seedGrid;
}

/**
 * Detect treetops and return a per-point tree seed (0–254), or `TREE_SEED_NONE`
 * (255) for points outside any detected crown. Returns `null` when the cloud
 * carries no vegetation points to seed.
 */
export function detectTreetops(
    positions: Float32Array,
    heightAboveGround: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    options?: TreetopOptions,
): Uint8Array | null {
    const chmCell = options?.chmCell ?? DEFAULTS.chmCell;
    const minHeight = options?.minHeight ?? DEFAULTS.minHeight;
    const crownA = options?.crownA ?? DEFAULTS.crownA;
    const crownB = options?.crownB ?? DEFAULTS.crownB;
    const sensitivity = Math.min(1, Math.max(0, options?.sensitivity ?? DEFAULTS.sensitivity));
    // High sensitivity shrinks the detection window → more, finer treetops.
    const windowScale = 1.4 - 0.9 * sensitivity;

    const grid = buildChm(positions, classifications, heightAboveGround, pointCount, chmCell);
    if (!grid) return null;
    const tops = findTreetops(grid, minHeight, windowScale);
    const seedGrid = growCrowns(grid, tops, crownA, crownB);

    const out = new Uint8Array(pointCount).fill(TREE_SEED_NONE);
    const { cols } = grid;
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_CLASSES.has(classifications[i])) continue;
        const idx = cellY(grid, positions[i * 3 + 1]) * cols + cellX(grid, positions[i * 3]);
        out[i] = seedGrid[idx];
    }
    return out;
}
