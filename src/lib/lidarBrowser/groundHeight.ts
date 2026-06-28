/**
 * Vegetation height-above-ground for LiDAR point clouds.
 *
 * Drives the foliage colour ramp (trunk ≈ 0, canopy top = full tree height) and
 * the automatic "tallest tree" colour scale. A vegetation point's height is
 * measured **within its own vertical column of vegetation** rather than against
 * a single ground surface — see `computeVegHeightStacked` for why that is the
 * only metric that stays correct on cliffs.
 *
 * All positions are east/north/up meter offsets (the same frame used
 * throughout the browser pipeline).
 */

/** ASPRS vegetation classes (low/medium/high) whose height we colour. */
const VEG_HEIGHT_CLASSES = new Set([3, 4, 5]);

/** XY cell (m) used to gather a vertical column of vegetation points. ~1.5 m is
 *  about one tree footprint: small enough to keep neighbouring trees apart,
 *  large enough that a single trunk + canopy lands in the same column. The UI
 *  « Analyse hauteur » menu can override it live. */
export const DEFAULT_VEG_COLUMN_CELL_M = 1.5;

/** Default vertical gap (m) separating two stacked vegetation masses; the UI
 *  slider overrides it. Shared by the pipeline, the store and saved-scene decode
 *  so a cloud and its recompute agree by default. */
export const DEFAULT_VEG_GROUND_GAP = 3;

/** ASPRS classes that define the bare-earth reference surface (ground + water). */
const VEG_GROUND_REF_CLASSES = new Set([2, 9]);

/** XY cell (m) of the coarse min-Z ground field used by the hybrid metric.
 *  Fixed at 1 m (empirically the best result); not user-tunable. */
export const DEFAULT_VEG_GROUND_CELL_M = 1;

/** Bilinear ground sampling drops any corner more than this (m) below the
 *  highest corner: at a cliff top the over-the-rim corners carry the cliff-base
 *  ground and would otherwise drag a plateau-edge point's reference down into a
 *  height spike. Above a continuous slope's per-cell drop, below a cliff's. */
const GROUND_SAMPLE_DROP_TOL_M = 5;

/** Default local-relief ceiling (m) below which the hybrid trusts the
 *  vertical-to-ground height. On terrain whose 3×3 ground relief exceeds it the
 *  metric falls back to the cliff-correct stacked height. 0 disables the hybrid
 *  (pure stacked). Tuned on conifer + broadleaf clouds (see docs). */
export const DEFAULT_VEG_GROUND_ROUGH = 12;

/** The blend opens (full vertical) below `rough · this`, closes (full stacked)
 *  above `rough`. A finite transition avoids a visible seam at the threshold.
 *  Exposed live in the « Analyse hauteur » menu. */
export const DEFAULT_VEG_ROUGH_LOW_FRAC = 0.4;

/** How far (m) a spreading crown may overhang a cliff edge. A canopy point that
 *  floats over the void this far from the rim still belongs to the rim ground,
 *  so the metric looks this far for the higher cliff-top ground to anchor it
 *  against instead of the valley floor straight below. Exposed live in the
 *  « Analyse hauteur » menu. */
export const DEFAULT_VEG_OVERHANG_REACH_M = 8;

/** Vegetation **vertical span** (m) above which a cell is forced to "falaise"
 *  even when the crest test would call it slope. A near-vertical wall scatters
 *  returns at every altitude, so a single XY cell on the face spans the whole
 *  wall height (tens of metres); a tree, a replat/terrace or a cliff foot spans
 *  only a canopy height. This catches the descending green stripe inside a
 *  recessed couloir — where the face steps back so the fixed 8 m rim reach
 *  under-reads and the crest test wrongly greens it — using the vegetation's own
 *  vertical structure (which a 2.5-D heightfield discards) rather than any
 *  ground-field metric. Tuned offline with `tools/veg-tune/` (--cliff-span);
 *  internal constant, not a slider, to avoid knob overload. */
export const DEFAULT_VEG_CLIFF_SPAN_M = 30;

/** Altitude slack (m) for the overhang *reach* gate only: a rim counts as
 *  "within horizontal reach" when the tallest ground inside the reach window is
 *  at least `rimMax − this` high. (The anchor itself now requires the crown to
 *  sit strictly ABOVE the rim, `z > rimMax`, so this no longer controls how far
 *  DOWN the face a point may anchor — a sub-rim point is never a surplomb.)
 *  Kept an internal constant (not a slider) to avoid knob overload. */
export const DEFAULT_VEG_OVERHANG_DROP_M = 4;

/** Horizontal reach (m) the cliff/slope classification looks across to find the
 *  rim that a face cell sits below (`belowRim = rimMax − ground`). **Fixed and
 *  deliberately decoupled from the "Portée surplomb" slider** so changing the
 *  overhang reach can never move the red/green (falaise vs pente) boundary — the
 *  bug that made a real cliff read as bare ground at a low slider value. A cliff
 *  is near-vertical, so its rim sits within a few metres horizontally of any
 *  face return; 8 m catches it without bleeding across a gentle slope. The crest
 *  far window and the overhang anchor are derived from / gated separately. Can
 *  be tuned offline with `tools/veg-tune/`. Internal constant, not a slider. */
const CLIFF_RIM_REACH_M = 8;

/** Tolerance (m) for the spatial smoothing of the stacked column base. Two
 *  neighbouring columns whose bases differ by less than this are treated as the
 *  same surface and blended, dissolving the vertical seams a sparse cliff face
 *  showed at every `columnCellM` step. Wider than the ledge-splitting `gapM` (so
 *  it can bridge sparse-sampling base jumps) yet far below a real ledge height
 *  (so a tree on an upper ledge is not pulled down onto the one below). */
const VEG_BASE_SMOOTH_TOL_M = 8;

/** XY cell (m) of the cliff outlier-smoothing grid (see
 *  {@link VegHeightOptions.vegColorSmooth}). A few column-widths wide so the
 *  robust local reference pools several neighbouring columns. */
const VEG_COLOR_SMOOTH_CELL_M = 2;

/** Block radius (in cells) of the robust local reference: a 2 m cell × radius 2
 *  pools a ~10 m window, wide enough that an isolated speck is dwarfed by the
 *  surrounding genuine cliff vegetation and gets a stable comparison height. */
const VEG_COLOR_SMOOTH_RADIUS = 2;

/** Tolerance (m) below which a cliff veg point is left untouched by the outlier
 *  smoothing: genuine column-to-column steps (anything within this of the robust
 *  local reference) survive — only points "franchement différentes" (isolated
 *  absurd returns, typically the very-low brown specks) get pulled in. */
const VEG_COLOR_SMOOTH_TOL_M = 5;

/** Transition band (m) beyond the tolerance over which the correction ramps from
 *  none to full. A point just past the tolerance is barely touched (so column
 *  edges keep their colour even at full strength); a wildly absurd speck, far
 *  past tol+ramp, is pulled all the way onto the local reference. */
const VEG_COLOR_SMOOTH_RAMP_M = 6;

/** Cliff vegetation height mode. On points classified "falaise" the stacked
 *  column height can look noisy (each return at its own altitude-above-foot).
 *  These alternatives replace that height — only on cliff points — with a
 *  *distance*, so the user can compare them live:
 *   • `column`    — default: keep the stacked column height (byte-identical).
 *   • `rimDepth`   — vertical depth below the cliff-top rim (`rimMax − z`).
 *   • `surface3d`  — 3D distance to the nearest bare-earth/rock reference point.
 *   • `wallHoriz`  — horizontal distance to the rock face at the point's altitude. */
export type VegCliffDistMode = 'column' | 'surface3d' | 'rimDepth' | 'wallHoriz';

/** Cap (m) on the cliff distance metrics (`surface3d` / `wallHoriz`): the search
 *  never reaches past this, and a point with no reference within reach reports
 *  this distance. Also the rendered ceiling of the resulting colour ramp. */
export const DEFAULT_VEG_CLIFF_DIST_MAX_M = 12;

/** Altitude tolerance (m) for the `wallHoriz` mode: a ground cell counts as the
 *  rock face at the point's altitude when its bare-earth elevation is within this
 *  of the point's z. */
const CLIFF_DIST_Z_TOL_M = 1.5;

/** Multiple of the rim reach used for the **crest** check. A genuine rim
 *  overhang hangs from a true crest: the high ground that would anchor it is a
 *  plateau top, so it is no higher when sampled over a window this many times
 *  wider. At the *foot* of a cliff the near (rim-sized) window only sees a few
 *  metres up the face and badly under-reads the real rim towering above — this
 *  wider window catches that, so a tall tree at the base is no longer mistaken
 *  for a crown sitting at the top. Internal constant, not a slider. */
const VEG_RIM_FAR_FACTOR = 3;

/** Crest discriminant, expressed as a fraction of the below-rim drop and
 *  **deliberately independent of `roughM`**. The near high ground counts as a
 *  genuine crest only when the far window rises past it by no more than this
 *  fraction of how far the cell already sits below it (`rimFar − rimMax ≤
 *  belowRim · this`). On a continuous slope the far window towers ≈2× the near
 *  drop (overRise ≫ 0.5·belowRim) so it fails → the point stays "pente"; on a
 *  real cliff the plateau above is flat (overRise ≈ 0 ≪ belowRim) so it holds at
 *  ANY `roughM`. This is why lowering "relief sol max" can no longer hide a real
 *  cliff face behind a false "slope" verdict. Internal constant, not a slider. */
const VEG_CREST_FRAC = 0.5;

/** Half-width (degrees) of the soft transition band of the "Falaise simple"
 *  slope mode: around the chosen slope threshold the falaise⇄pente blend ramps
 *  over `threshold ± this` instead of snapping, so the colour seam stays smooth.
 *  Internal constant — the mode exposes only the single slope-angle slider. */
const VEG_SLOPE_BAND_DEG = 5;

/** Default baseline (m) over which the "Falaise simple" mode measures ground
 *  slope. A larger baseline means the slope is read at a coarser scale, so a
 *  short steep bank (talus) — steep over one cell but flanked by flat ground —
 *  averages out to a gentle angle and stays "pente", while only drops that are
 *  steep over this whole distance (real cliffs) read as falaise. */
export const DEFAULT_VEG_SLOPE_SAMPLE_M = 4;

// ── Per-point decision diagnostics ───────────────────────────────────────────
// `computeVegHeights` can fill a compact RGBA-style buffer (4 bytes / point) so
// the GPU can paint a false-colour map of how each vegetation point's height was
// decided. Layout per point i (byte offset i·4):
//   [0] blendW  — round(wVertical·255): 255 = full vertical-to-ground (flat /
//                 "pente" branch), 0 = full per-column stacked ("falaise" branch)
//   [1] cluster — stacked cluster id, hashed to 0..255 so adjacent ledges/trees
//                 in a column take visibly different colours
//   [2] flags   — bitfield, see DIAG_FLAG_*
//   [3] rough   — round(local 3×3 ground relief · 10) clamped to 0..255 (→ 0..25.5 m)
/** Stride (bytes) of the per-point diagnostic buffer. */
export const VEG_DIAG_STRIDE = 4;
/** flags bit0: the point is vegetation (classes 3/4/5). */
export const DIAG_FLAG_VEG = 1;
/** flags bit1: a ground reference cell was available below the point. */
export const DIAG_FLAG_GROUND = 2;
/** flags bit2: the point floats over a vertical void (vertical ≫ stacked). */
export const DIAG_FLAG_FLOATING = 4;
/** flags bit3: an overhang was anchored to nearby higher cliff-top ground. */
export const DIAG_FLAG_CLIFF = 8;

/** Optional fine-tuning + diagnostics output for {@link computeVegHeights}. All
 *  fields fall back to the module defaults so the legacy positional call still
 *  behaves identically. */
export interface VegHeightOptions {
    /** XY column footprint (m) for the stacked clustering. */
    columnCellM?: number;
    /** Lower edge of the blend transition as a fraction of `roughM`. */
    roughLowFrac?: number;
    /** Crown overhang reach (m) used to find the cliff-top ground. */
    overhangReachM?: number;
    /** When provided (length ≥ 4·pointCount) it is filled with the per-point
     *  decision diagnostics described above. */
    diag?: Uint8Array | null;
    /** Vegetation vertical-span (m) override for the wall discriminant (see
     *  {@link DEFAULT_VEG_CLIFF_SPAN_M}). A cell whose veg returns span more than
     *  this is forced to falaise even when the crest test calls it slope, catching
     *  the descending green stripe inside a recessed couloir. Defaults to the
     *  module constant; harness-tunable via `--cliff-span`. ≤ 0 disables it. */
    cliffSpanM?: number;
    /** Cliff vegetation height mode (see {@link VegCliffDistMode}). Applies only
     *  to points classified "falaise" — pente/surplomb keep their normal height.
     *  Defaults to `'column'` (stacked height, byte-identical render). */
    cliffDistMode?: VegCliffDistMode;
    /** Cliff outlier-smoothing strength (0..1). Pulls isolated cliff-vegetation
     *  points whose height is markedly different from their robust local
     *  neighbourhood back toward it, killing the absurd "camouflage" specks of
     *  sparse cliff LiDAR while leaving normal column-to-column steps intact.
     *  0 (default) is off and byte-identical; 1 clamps every outlier to within a
     *  few metres of its neighbours. Affects only falaise vegetation. */
    vegColorSmooth?: number;
    /** Sparse-cluster fallback threshold (points). On falaise points whose own
     *  vertical cluster holds at most this many returns, the per-column stacked
     *  height (which pins a lone return to 0 — a dark brown speck, since it is
     *  its own cluster base) is replaced by the horizontal wall distance metric
     *  ({@link VegCliffDistMode} `wallHoriz`). A point that flew out over the
     *  void thus reads its true distance from the rock face instead of 0. 0
     *  (default) is off and byte-identical; only applies in `column` mode (the
     *  other modes already override every falaise point). Affects only falaise
     *  vegetation. */
    cliffSparseMaxPts?: number;
    /** **"Falaise simple" mode.** When > 0, the per-cell falaise⇄pente verdict is
     *  taken PURELY from the local ground slope (degrees), bypassing the crest /
     *  vegetation-span / rim machinery: a cell steeper than this renders as
     *  falaise (stacked height), gentler as pente (vertical-to-ground), with a
     *  `±VEG_SLOPE_BAND_DEG` soft transition. No surplomb anchoring. 0 (default)
     *  keeps the detailed classifier and is byte-identical. */
    cliffSlopeDeg?: number;
    /** Baseline (m) over which the "Falaise simple" mode measures the slope.
     *  Larger = coarser scale, so short steep banks read gentle and only tall
     *  drops stay falaise. Defaults to {@link DEFAULT_VEG_SLOPE_SAMPLE_M}; only
     *  used when `cliffSlopeDeg > 0`. */
    cliffSlopeSampleM?: number;
    /** **Slope floor for the detailed classifier** (degrees). When > 0, any cell
     *  whose local ground slope (measured over {@link DEFAULT_VEG_SLOPE_SAMPLE_M})
     *  exceeds this is forced toward falaise even when the crest / belowRim
     *  machinery would green it — catching steep open faces and battered cliffs
     *  whose top sits beyond the fixed rim reach. It only lowers the
     *  vertical-to-ground weight (adds falaise, never removes it); surplomb stays
     *  surplomb. 0 (default) keeps the detailed classifier byte-identical.
     *  Ignored in "Falaise simple" mode (`cliffSlopeDeg > 0`). */
    cliffSlopeMinDeg?: number;
}

/**
 * Coarse bare-earth reference: a min-Z ground field plus its local relief,
 * cached so the per-column height can be re-blended live (slider) and across a
 * cloud reload without re-fetching the ground points. All cells are NaN where
 * no ground was observed (e.g. under a dense canopy or a vertical face).
 */
export interface VegGroundGrid {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Lowest reference-surface elevation per cell (m), NaN where none. */
    groundZ: Float32Array;
    /** Max−min `groundZ` over the 3×3 neighbourhood (m), NaN where unknown. */
    roughness: Float32Array;
}

/** Min/max/mean of the finite 3×3 neighbourhood of cell (cx, cy). */
interface NeighbourStats { min: number; max: number; mean: number; count: number; }

function neighbourStats(
    field: Float32Array, cols: number, rows: number, cx: number, cy: number,
): NeighbourStats {
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= cols) continue;
            const v = field[ny * cols + nx];
            if (!Number.isFinite(v)) continue;
            min = Math.min(min, v);
            max = Math.max(max, v);
            sum += v;
            count++;
        }
    }
    return { min, max, mean: count ? sum / count : Number.NaN, count };
}

/** XY bounds of the reference points (those in {@link VEG_GROUND_REF_CLASSES}
 *  when `classifications` is given, else all points). */
function referenceBounds(
    positions: Float32Array, pointCount: number, classifications?: Uint8Array,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (let i = 0; i < pointCount; i++) {
        if (classifications && !VEG_GROUND_REF_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        any = true;
    }
    return any ? { minX, minY, maxX, maxY } : null;
}

/**
 * Build the coarse {@link VegGroundGrid} from reference-surface points.
 *
 * When `classifications` is supplied only ground/water points feed the field
 * (the caller passes the full cloud); otherwise every point counts (the caller
 * already isolated the ground subset). Holes left by missing returns are filled
 * once from their neighbours so the grid stays usable under sparse canopy.
 *
 * Returns `null` when there are no points to anchor a surface.
 */
export function buildVegGroundGrid(
    positions: Float32Array,
    pointCount: number,
    classifications?: Uint8Array,
    cell = DEFAULT_VEG_GROUND_CELL_M,
): VegGroundGrid | null {
    const b = referenceBounds(positions, pointCount, classifications);
    if (!b) return null;
    const cols = Math.floor((b.maxX - b.minX) / cell) + 1;
    const rows = Math.floor((b.maxY - b.minY) / cell) + 1;
    const groundZ = new Float32Array(cols * rows).fill(Infinity);
    for (let i = 0; i < pointCount; i++) {
        if (classifications && !VEG_GROUND_REF_CLASSES.has(classifications[i])) continue;
        const cx = Math.floor((positions[i * 3] - b.minX) / cell);
        const cy = Math.floor((positions[i * 3 + 1] - b.minY) / cell);
        const k = cy * cols + cx;
        const z = positions[i * 3 + 2];
        if (z < groundZ[k]) groundZ[k] = z;
    }
    fillGroundHoles(groundZ, cols, rows);
    return {
        minX: b.minX, minY: b.minY, cell, cols, rows,
        groundZ, roughness: groundRoughness(groundZ, cols, rows),
    };
}

/** Replace each empty cell (still +Inf) by the mean of its filled neighbours,
 *  then mark any cell that stayed empty as NaN. One pass keeps it cheap. */
function fillGroundHoles(groundZ: Float32Array, cols: number, rows: number): void {
    const src = groundZ.slice();
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const k = cy * cols + cx;
            if (Number.isFinite(src[k])) continue;
            groundZ[k] = neighbourStats(src, cols, rows, cx, cy).mean;
        }
    }
}

/** Per-cell local relief: max−min ground over the 3×3 neighbourhood (m). */
function groundRoughness(groundZ: Float32Array, cols: number, rows: number): Float32Array {
    const out = new Float32Array(cols * rows).fill(Number.NaN);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const s = neighbourStats(groundZ, cols, rows, cx, cy);
            if (s.count) out[cy * cols + cx] = s.max - s.min;
        }
    }
    return out;
}

/** Index of the grid cell holding (x, y), or −1 outside the grid. */
function gridCell(grid: VegGroundGrid, x: number, y: number): number {
    const cx = Math.floor((x - grid.minX) / grid.cell);
    const cy = Math.floor((y - grid.minY) / grid.cell);
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return -1;
    return cy * grid.cols + cx;
}

/**
 * Bilinearly sample a per-cell ground field at world (x, y), treating each cell
 * value as a sample at the cell **centre**. This turns the piecewise-constant
 * per-cell ground reference into a continuous surface, so the rendered
 * vertical-to-ground vegetation height no longer steps by a full cell at every
 * grid boundary (the dominant source of the rectilinear colour banding on
 * canopy over moderate terrain). NaN corners are dropped and the remaining
 * weights renormalised; returns NaN only when all four corners are NaN.
 *
 * **Edge-aware at a cliff top.** A plateau-edge cell's bilinear neighbourhood
 * includes one or two corners that already lie *over* the rim, whose ground is
 * the cliff **base** (tens of m below). Left in, they drag the interpolated
 * reference down and inflate the last pente points into a spike right before
 * they switch to surplomb. So any corner more than
 * {@link GROUND_SAMPLE_DROP_TOL_M} below the highest corner is dropped: a rim
 * point references the plateau it stands on, not the void. A continuous slope
 * (corners within a couple of metres) keeps all four and stays smooth.
 */
export function sampleGroundBilinear(grid: VegGroundGrid, x: number, y: number): number {
    const fx = (x - grid.minX) / grid.cell - 0.5;
    const fy = (y - grid.minY) / grid.cell - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const v00 = cornerGround(grid, x0, y0);
    const v10 = cornerGround(grid, x0 + 1, y0);
    const v01 = cornerGround(grid, x0, y0 + 1);
    const v11 = cornerGround(grid, x0 + 1, y0 + 1);
    // Highest finite corner = the surface the point actually stands on (NaN fails
    // every `>` so it is ignored here).
    let top = -Infinity;
    if (v00 > top) top = v00;
    if (v10 > top) top = v10;
    if (v01 > top) top = v01;
    if (v11 > top) top = v11;
    const acc = { sum: 0, wsum: 0 };
    addGroundCorner(v00, (1 - tx) * (1 - ty), top, acc);
    addGroundCorner(v10, tx * (1 - ty), top, acc);
    addGroundCorner(v01, (1 - tx) * ty, top, acc);
    addGroundCorner(v11, tx * ty, top, acc);
    return acc.wsum > 0 ? acc.sum / acc.wsum : Number.NaN;
}

/** Read one ground cell, or NaN when outside the grid. */
function cornerGround(grid: VegGroundGrid, cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return Number.NaN;
    return grid.groundZ[cy * grid.cols + cx];
}

/** Add one bilinear corner to the accumulator, skipping NaN cells and any corner
 *  that sits a cliff-drop below `top` so the weights renormalise over the
 *  same-surface corners only. */
function addGroundCorner(
    v: number, w: number, top: number, acc: { sum: number; wsum: number },
): void {
    if (!Number.isFinite(v)) return;
    if (top - v > GROUND_SAMPLE_DROP_TOL_M) return;
    acc.sum += w * v;
    acc.wsum += w;
}

/** Smooth Hermite ramp; 0 at/below `e0`, 1 at/above `e1`. */
function smoothstep(e0: number, e1: number, x: number): number {
    if (e1 <= e0) return x >= e1 ? 1 : 0;
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Max finite value over the square window of `radius` cells around (cx, cy),
 *  or −Infinity when the window holds no finite value. */
function windowMax(
    field: Float32Array, cols: number, rows: number, cx: number, cy: number, radius: number,
): number {
    let max = -Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -radius; dx <= radius; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= cols) continue;
            const v = field[ny * cols + nx];
            if (v > max && Number.isFinite(v)) max = v;
        }
    }
    return max;
}

/** Per-cell max ground over a `reachCells`-radius window (m), NaN where the
 *  window holds no finite ground. An overhanging canopy reads its height against
 *  this nearby cliff-top ground rather than the void straight below it. */
function dilateGroundMax(
    groundZ: Float32Array, cols: number, rows: number, reachCells: number,
): Float32Array {
    const out = new Float32Array(cols * rows).fill(Number.NaN);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const m = windowMax(groundZ, cols, rows, cx, cy, reachCells);
            if (m > -Infinity) out[cy * cols + cx] = m;
        }
    }
    return out;
}

/** One axis of the ground gradient at cell (cx, cy), measured over a `radius`-
 *  cell baseline: a central difference when both neighbours along (dx, dy) are
 *  finite, a one-sided difference when only one is, 0 when neither — so borders
 *  and grid holes degrade gracefully. A larger radius reads the slope at a
 *  coarser scale, so a short steep bank flattens out. */
function slopeComponent(
    grid: VegGroundGrid, cx: number, cy: number, dx: number, dy: number, radius: number,
): number {
    const fwd = cornerGround(grid, cx + dx * radius, cy + dy * radius);
    const back = cornerGround(grid, cx - dx * radius, cy - dy * radius);
    const run = radius * grid.cell;
    if (Number.isFinite(fwd) && Number.isFinite(back)) return (fwd - back) / (2 * run);
    const here = grid.groundZ[cy * grid.cols + cx];
    if (Number.isFinite(fwd)) return (fwd - here) / run;
    if (Number.isFinite(back)) return (here - back) / run;
    return 0;
}

/** Per-cell ground slope (degrees) from the min-Z field, measured over a
 *  `radius`-cell baseline, NaN where the cell has no finite ground. The
 *  magnitude of the gradient turned into an angle: the single signal behind the
 *  "Falaise simple" mode. */
function groundSlopeField(grid: VegGroundGrid, radius: number): Float32Array {
    const { groundZ, cols, rows } = grid;
    const out = new Float32Array(cols * rows).fill(Number.NaN);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const k = cy * cols + cx;
            if (!Number.isFinite(groundZ[k])) continue;
            const gx = slopeComponent(grid, cx, cy, 1, 0, radius);
            const gy = slopeComponent(grid, cx, cy, 0, 1, radius);
            out[k] = Math.atan(Math.hypot(gx, gy)) * (180 / Math.PI);
        }
    }
    return out;
}

/** Per-cell **vegetation vertical span** (m): the highest minus the lowest
 *  vegetation return seen in the cell, 0 where the cell has none. A near-vertical
 *  wall scatters returns at every altitude so its cells span the whole face;
 *  trees, terraces and cliff feet span only a canopy height. This is the wall
 *  discriminant that the 2.5-D ground heightfield cannot provide — it reads the
 *  vegetation's own vertical structure. See {@link DEFAULT_VEG_CLIFF_SPAN_M}. */
function vegSpanField(
    grid: VegGroundGrid, positions: Float32Array, classifications: Uint8Array, pointCount: number,
): Float32Array {
    const { minX, minY, cell, cols, rows } = grid;
    const n = cols * rows;
    const lo = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
    const hi = new Float32Array(n).fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const cx = Math.floor((positions[i * 3] - minX) / cell);
        const cy = Math.floor((positions[i * 3 + 1] - minY) / cell);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        const k = cy * cols + cx;
        const z = positions[i * 3 + 2];
        if (z < lo[k]) lo[k] = z;
        if (z > hi[k]) hi[k] = z;
    }
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = hi[k] > lo[k] ? hi[k] - lo[k] : 0;
    return out;
}

/**
 * Per-point blend decision, evaluated as an ordered terrain decision tree:
 * first separate flat/slope from cliff, then — on cliffs only — overhang vs face.
 *
 * The cliff discriminant is **how far the cell's own ground sits below the
 * highest ground within the fixed rim reach** (`belowRim = rimMax − ground`),
 * *not* the raw 3×3 relief and *not* anything derived from the "Portée surplomb"
 * slider. Relief bleeds across a rim: a tree on the flat plateau edge has solid
 * ground right below it yet a rough 3×3 neighbourhood, so a relief gate
 * mislabels it a "falaise". `belowRim` is ≈0 there (the cell's ground *is* the
 * rim) and grows large only where the cell genuinely lies below a rim.
 *
 *  1. **Crest test first.** The near high ground is a true crest only when the
 *     far window rises past it by no more than `belowRim · VEG_CREST_FRAC`
 *     (a slope towers ≈2× the near drop and fails; a flat-topped cliff barely
 *     rises and passes). When it **fails** the cell is a continuous slope or a
 *     cliff foot: the ground sits right below, so trust the plain
 *     vertical-to-ground height (green "pente") and — crucially — do **not**
 *     flag it floating, keeping the `Drapeaux` and `Mode` renders consistent.
 *  2. **Under a crest** — `belowRim > roughM` is a cliff:
 *     a. **Overhang crown above the rim top** — anchor to the detected rim
 *        (`rimMax`, blue "surplomb") when it *floats* over a void
 *        (`(z − ground) − stacked > gapM`), its crown sits **strictly above the
 *        cliff top** (`z > rimMax`, so the anchored height `z − rimMax` is always
 *        positive — never the brown height-0) **and** that rim is within the
 *        user's horizontal overhang reach (`anchorMax ≥ rimMax − dropM`). A point
 *        that floats but sits *below* the rim is no overhang crown: it falls
 *        through to the falaise branch (red), not anchored to height 0. The
 *        reach gate is the **only**
 *        place "Portée surplomb" acts: a wider reach can only make more crowns
 *        eligible (more blue), never move the falaise/pente line, and the anchor
 *        target stays the fixed-reach rim so the height never drifts.
 *     b. **Cliff face / ledge** — keep the conservative stacked column height
 *        (red "falaise"); the vertical drop would invent a phantom-tall tree.
 *  3. Below `roughM` (still under a crest) a smooth `roughLow → roughM`
 *     transition blends the flat vertical height into the stacked cliff height
 *     to avoid a hard colour seam along the rim.
 */
interface VegBlendTuning { gapM: number; roughM: number; roughLow: number; dropM: number; spanM: number; slopeMin: number; }
interface VegBlend { groundRef: number; wVertical: number; floating: boolean; cliffAnchored: boolean; cliff: boolean; }
/** Per-point rim geometry plus the cell's vegetation vertical span and ground
 *  slope, precomputed in the loop and handed to {@link blendVegHeight}. */
interface RimInfo { belowRim: number; overRise: number; rimMax: number; anchorMax: number; vegSpan: number; slopeDeg: number; }

/** Assemble the {@link RimInfo} for cell `k` from the raw per-cell rim fields. */
function rimInfoFor(
    k: number, ground: number,
    rimMax: Float32Array, rimFar: Float32Array, anchorMax: Float32Array,
    vegSpan: Float32Array, slope: Float32Array | null,
): RimInfo {
    return {
        belowRim: Number.isFinite(rimMax[k]) ? rimMax[k] - ground : 0,
        overRise: Number.isFinite(rimFar[k]) ? rimFar[k] - rimMax[k] : 0,
        rimMax: rimMax[k],
        anchorMax: anchorMax[k],
        vegSpan: vegSpan[k],
        slopeDeg: slope ? slope[k] : Number.NaN,
    };
}

function blendVegHeight(
    z: number, ground: number, rim: RimInfo, stacked: number,
    t: VegBlendTuning,
): VegBlend {
    // How far this cell's ground sits below the nearby rim — the cliff signal,
    // measured over the FIXED rim reach (never the overhang slider).
    const { belowRim, overRise, rimMax, anchorMax, vegSpan, slopeDeg } = rim;
    // A near-vertical wall scatters returns at every altitude, so the cell spans
    // the whole face. In a recessed couloir the face steps back, the fixed 8 m
    // rim reach under-reads, and the crest test wrongly greens the stripe — this
    // catches it from the vegetation's own vertical structure. Disabled when
    // t.spanM ≤ 0. A tree, replat or cliff foot spans only a canopy height.
    const tallColumn = t.spanM > 0 && vegSpan > t.spanM;
    // Crest test FIRST, relative to the drop and independent of roughM: a slope's
    // far window towers proportionally higher than its near drop and fails it.
    const atCrest = overRise <= belowRim * VEG_CREST_FRAC;
    // Slope floor: a cell steeper than t.slopeMin is pushed toward falaise even
    // when the crest / belowRim machinery would green it — catching steep open
    // faces and battered cliffs whose top sits beyond the fixed rim reach. The
    // ONLY slope-angle input to the detailed classifier; t.slopeMin ≤ 0 or a cell
    // with no measured slope caps at 1 → no change. It only lowers wVertical, so
    // it can add falaise but never remove it.
    const wSlopeCap = t.slopeMin > 0 && Number.isFinite(slopeDeg)
        ? 1 - smoothstep(t.slopeMin - VEG_SLOPE_BAND_DEG, t.slopeMin + VEG_SLOPE_BAND_DEG, slopeDeg)
        : 1;
    const steep = wSlopeCap < 0.5;
    if (!atCrest && !tallColumn) {
        // Continuous slope / cliff foot: the ground sits right below the point,
        // so trust the vertical-to-ground height (pente) however steep it looks —
        // UNLESS the slope floor forces it to falaise. NOT floating — it is not
        // over a void — so the flag stays consistent with the decision render.
        return { groundRef: ground, wVertical: wSlopeCap, floating: false, cliffAnchored: false, cliff: steep };
    }
    // A recessed couloir wall: tall vegetation span, below an out-of-reach rim
    // (the crest test missed it AND it sits a full roughM below the near rim).
    // The overhang anchor would wrongly paint it blue, so deny it the anchor and
    // let it fall through to the stacked (red) falaise height — the visible bug
    // fix. The belowRim ≥ roughM guard keeps tall forest trees (no rim above
    // them) out, so only genuine wall cells are affected.
    const wallColumn = tallColumn && !atCrest && belowRim > t.roughM;
    const cliff = belowRim > t.roughM;
    const floating = cliff && (z - ground) - stacked > t.gapM;
    // 2a — overhang crown whose CROWN SITS ABOVE THE CLIFF TOP and spreads out
    // over a void → anchor to the (fixed-reach) rim, but only when that rim is
    // within the user's HORIZONTAL overhang reach. The anchor TARGET is rimMax
    // regardless of reach, so widening reach only adds eligible crowns (monotonic
    // blue) and never shifts heights. Requiring z > rimMax keeps the anchored
    // height (z − rimMax) strictly positive — a real canopy above the rim — and
    // sends any point that floats but sits BELOW the rim down to the falaise
    // branch instead of pinning it to a brown height-0. A recessed wall is not an
    // overhanging crown, so it never anchors.
    const rimWithinReach = Number.isFinite(anchorMax) && anchorMax >= rimMax - t.dropM;
    if (!wallColumn && floating && z > rimMax && rimWithinReach) {
        return { groundRef: rimMax, wVertical: 1, floating, cliffAnchored: true, cliff: true };
    }
    // 1 + 2b — under a genuine crest, blend vertical-to-ground (flat, trustworthy)
    // against the stacked column height (cliff, phantom-prone) by below-rim drop,
    // capped by the slope floor so a steep sub-crest face cannot stay green.
    const wVertical = Math.min(1 - smoothstep(t.roughLow, t.roughM, belowRim), wSlopeCap);
    return { groundRef: ground, wVertical, floating, cliffAnchored: false, cliff: cliff || steep };
}

/** Final rendered height for one vegetation point: surplomb keeps its
 *  fixed-reach rim anchor, pente samples a continuous bilinear ground, and the
 *  blend mixes that vertical-to-ground height with the stacked column height. */
function renderVegHeight(
    grid: VegGroundGrid, x: number, y: number, z: number, stacked: number, b: VegBlend,
): number {
    const groundRef = b.cliffAnchored ? b.groundRef : sampleGroundBilinear(grid, x, y);
    const hVertical = Math.max(0, z - groundRef);
    return b.wVertical * hVertical + (1 - b.wVertical) * stacked;
}

// ── Cliff distance modes (experimental, opt-in) ──────────────────────────────
// Replace the stacked column height with a distance, on cliff points only, so
// the noisy altitude-above-foot ramp can be A/B'd against smoother metrics.

/** Spatial hash of bare-earth reference points (classes 2/9) for the
 *  `surface3d` nearest-distance search, voxel-bucketed on a metric cell. */
interface GroundPointHash {
    cell: number;
    xs: Float32Array;
    ys: Float32Array;
    zs: Float32Array;
    buckets: Map<string, number[]>;
}

function buildGroundPointHash(
    positions: Float32Array, classifications: Uint8Array, pointCount: number, cell: number,
): GroundPointHash {
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_GROUND_REF_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        const idx = xs.length;
        xs.push(x); ys.push(y); zs.push(z);
        const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(idx); else buckets.set(key, [idx]);
    }
    return {
        cell, buckets,
        xs: Float32Array.from(xs), ys: Float32Array.from(ys), zs: Float32Array.from(zs),
    };
}

/** Min squared distance from (x,y,z) to the points in one voxel bucket. */
function scanGroundBucket(
    h: GroundPointHash, bucket: number[], x: number, y: number, z: number, best: number,
): number {
    let lowest = best;
    for (const j of bucket) {
        const ex = h.xs[j] - x, ey = h.ys[j] - y, ez = h.zs[j] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < lowest) lowest = d2;
    }
    return lowest;
}

/** 3D distance from (x,y,z) to the nearest hashed ground point, capped at maxR.
 *  Returns maxR where no reference sits within reach (a bare vertical face). */
function nearestGroundDist(h: GroundPointHash, x: number, y: number, z: number, maxR: number): number {
    const c = h.cell;
    const gx = Math.floor(x / c), gy = Math.floor(y / c), gz = Math.floor(z / c);
    const r = Math.max(1, Math.ceil(maxR / c));
    let best = maxR * maxR;
    for (let dz = -r; dz <= r; dz++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const bucket = h.buckets.get(`${gx + dx},${gy + dy},${gz + dz}`);
                if (bucket) best = scanGroundBucket(h, bucket, x, y, z, best);
            }
        }
    }
    return Math.sqrt(best);
}

/** Horizontal distance from (x,y) to one ground cell, or +Inf when that cell is
 *  off-grid, empty, or not at the point's altitude (within {@link CLIFF_DIST_Z_TOL_M}). */
function wallCellDist(
    grid: VegGroundGrid, nx: number, ny: number, x: number, y: number, z: number,
): number {
    if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) return Infinity;
    const g = grid.groundZ[ny * grid.cols + nx];
    if (!Number.isFinite(g) || Math.abs(g - z) > CLIFF_DIST_Z_TOL_M) return Infinity;
    const ex = grid.minX + (nx + 0.5) * grid.cell - x;
    const ey = grid.minY + (ny + 0.5) * grid.cell - y;
    return Math.hypot(ex, ey);
}

/** Horizontal distance to the rock face at the point's own altitude: the nearest
 *  ground cell whose bare-earth elevation matches `z`. Capped at maxR. */
function wallHorizDist(grid: VegGroundGrid, x: number, y: number, z: number, maxR: number): number {
    const c = grid.cell;
    const cx = Math.floor((x - grid.minX) / c), cy = Math.floor((y - grid.minY) / c);
    const r = Math.max(1, Math.ceil(maxR / c));
    let best = maxR;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            best = Math.min(best, wallCellDist(grid, cx + dx, cy + dy, x, y, z));
        }
    }
    return best;
}

/** Precomputed context for the cliff distance override. */
interface CliffDistCtx {
    mode: VegCliffDistMode;
    grid: VegGroundGrid;
    rimMax: Float32Array;
    hash: GroundPointHash | null;
    maxR: number;
    /** Sparse-cluster fallback threshold (points); 0 = off. */
    sparseMaxPts: number;
    /** Per-point vertical-cluster size, or null when the fallback is off. */
    clusterCounts: Uint32Array | null;
}

/** Distance metric for one cliff vegetation point (see {@link VegCliffDistMode}). */
function cliffDistance(ctx: CliffDistCtx, k: number, x: number, y: number, z: number): number {
    switch (ctx.mode) {
        case 'rimDepth': {
            const rim = ctx.rimMax[k];
            return Number.isFinite(rim) ? Math.max(0, rim - z) : 0;
        }
        case 'surface3d':
            return ctx.hash ? nearestGroundDist(ctx.hash, x, y, z, ctx.maxR) : 0;
        case 'wallHoriz':
            return wallHorizDist(ctx.grid, x, y, z, ctx.maxR);
        default:
            return 0;
    }
}

/** Final rendered height for one vegetation point: the cliff distance override
 *  (red falaise points, opt-in mode) or the normal stacked/vertical blend. A
 *  falaise point alone in a tiny vertical cluster (≤ `sparseMaxPts`) falls back
 *  to the horizontal wall distance instead of its 0-pinned stacked height. */
function finalVegHeight(
    distCtx: CliffDistCtx, i: number, x: number, y: number, z: number, stacked: number, b: VegBlend,
): number {
    if (b.cliff && !b.cliffAnchored) {
        if (distCtx.mode !== 'column') {
            return cliffDistance(distCtx, gridCell(distCtx.grid, x, y), x, y, z);
        }
        const cc = distCtx.clusterCounts;
        if (distCtx.sparseMaxPts > 0 && cc && cc[i] > 0 && cc[i] <= distCtx.sparseMaxPts) {
            return wallHorizDist(distCtx.grid, x, y, z, distCtx.maxR);
        }
    }
    return renderVegHeight(distCtx.grid, x, y, z, stacked, b);
}

/** Assign every point in a sorted column the size of its gap-split vertical
 *  cluster: a run of returns broken wherever a vertical gap exceeds `gapM`. */
function fillClusterSizes(
    out: Uint32Array, positions: Float32Array, col: number[], gapM: number,
): void {
    let start = 0;
    let prev = positions[col[0] * 3 + 2];
    for (let j = 1; j < col.length; j++) {
        const z = positions[col[j] * 3 + 2];
        if (z - prev > gapM) {
            for (let m = start; m < j; m++) out[col[m]] = j - start;
            start = j;
        }
        prev = z;
    }
    for (let m = start; m < col.length; m++) out[col[m]] = col.length - start;
}

/** Per-point size of the vertical cluster it belongs to. Mirrors the column
 *  bucketing + gap-split of {@link clusterVegColumns}: a lone return flying over
 *  a void forms a 1-point cluster — exactly the speck the stacked metric pins to
 *  0. Only built when the sparse-cliff fallback is enabled. */
function vegClusterCounts(
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
    gapM: number, columnCellM: number,
): Uint32Array {
    const keyBias = 0x8000;
    const columns = new Map<number, number[]>();
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const cx = Math.floor(positions[i * 3] / columnCellM) + keyBias;
        const cy = Math.floor(positions[i * 3 + 1] / columnCellM) + keyBias;
        const key = cx * 0x10000 + cy;
        let col = columns.get(key);
        if (!col) { col = []; columns.set(key, col); }
        col.push(i);
    }
    const out = new Uint32Array(pointCount);
    for (const col of columns.values()) {
        col.sort((a, b) => positions[a * 3 + 2] - positions[b * 3 + 2]);
        fillClusterSizes(out, positions, col, gapM);
    }
    return out;
}

/** Per-point cluster size for the sparse-cliff fallback, or null when the
 *  threshold is off or a distance mode already overrides every falaise point. */
function sparseClusterCounts(
    sparseMaxPts: number, distMode: VegCliffDistMode,
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
    gapM: number, columnCellM: number,
): Uint32Array | null {
    if (sparseMaxPts <= 0 || distMode !== 'column') return null;
    return vegClusterCounts(positions, classifications, pointCount, gapM, columnCellM);
}

/**
 * Per-point vegetation height blending the **stacked** metric with the plain
 * **vertical-to-ground** height, gated by the local ground relief.
 *
 * Why blend — the stacked metric (see {@link computeVegHeightStacked}) is the
 * only one that survives cliffs, but it systematically *under-reads* spreading
 * crowns: a broadleaf's outer canopy points fall into 1.5 m columns with no
 * trunk return beneath, so each such column anchors its own base at the canopy
 * itself and reports ≈0 m. The plain vertical height `z − groundZ` recovers
 * those points — but only where there is a trustworthy ground return below,
 * i.e. where the cell's ground is not far below the nearby rim. On a cliff face
 * the vertical drop hits a void far below and invents phantom-tall trees, so we
 * keep the stacked height there. The discriminant is how far the cell sits below
 * the highest ground within the fixed rim reach (`rimMax − ground`), which —
 * unlike the raw 3×3 relief — does not mislabel flat plateau-edge cells (their
 * ground *is* the rim) as cliffs. See {@link blendVegHeight}.
 *
 * `roughM` is the below-rim drop (m) above which we fully trust stacked; below
 * `roughM · 0.4` we fully trust vertical, with a smooth transition between.
 * `roughM ≤ 0`, a missing grid, or a cell with no ground below all fall back to
 * the pure stacked height. Returns a height per point (0 for non-vegetation).
 *
 * A crown that overhangs a cliff rim is a special case of the vertical branch:
 * its outer points project straight down past the edge into a flat valley cell,
 * which on its own would read a phantom height as tall as the cliff. Those
 * points are detected as *floating* over a void and, when they sit at or above
 * the rim, anchored to the higher cliff-top ground within crown reach instead —
 * see {@link blendVegHeight}.
 *
 * When `opts.diag` is supplied it is filled with the per-point decision
 * diagnostics (see VEG_DIAG_STRIDE) so the GPU can paint a false-colour map of
 * which branch (pente vs falaise), which stacked cluster, and which flags drove
 * each point's height.
 */
export function computeVegHeights(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    gapM: number,
    grid?: VegGroundGrid | null,
    roughM = DEFAULT_VEG_GROUND_ROUGH,
    opts?: VegHeightOptions,
): Float32Array {
    const columnCellM = opts?.columnCellM ?? DEFAULT_VEG_COLUMN_CELL_M;
    const roughLowFrac = opts?.roughLowFrac ?? DEFAULT_VEG_ROUGH_LOW_FRAC;
    const overhangReachM = opts?.overhangReachM ?? DEFAULT_VEG_OVERHANG_REACH_M;
    const diag = opts?.diag ?? null;
    const cluster = diag ? new Uint8Array(pointCount) : null;
    const out = computeVegHeightStacked(positions, classifications, pointCount, gapM, columnCellM, cluster);
    if (diag) initVegDiag(diag, classifications, pointCount, cluster as Uint8Array);
    if (!grid || roughM <= 0) return out;
    // "Falaise simple" mode: when the slope-angle slider is set, classify
    // falaise vs pente PURELY from the local ground slope and skip the whole
    // crest / vegetation-span / rim machinery below. 0 = off (detailed path).
    const cliffSlopeDeg = opts?.cliffSlopeDeg ?? 0;
    if (cliffSlopeDeg > 0) {
        return computeVegHeightsBySlope(
            out, positions, classifications, pointCount, grid,
            {
                slopeDeg: cliffSlopeDeg,
                sampleM: opts?.cliffSlopeSampleM ?? DEFAULT_VEG_SLOPE_SAMPLE_M,
                colorSmooth: opts?.vegColorSmooth ?? 0,
            },
            diag,
        );
    }
    // Cliff/slope classification uses a FIXED rim reach, fully decoupled from the
    // "Portée surplomb" slider — so the overhang reach can never move the
    // falaise/pente boundary. The slider drives only the overhang-anchor window.
    const rimCells = Math.max(1, Math.round(CLIFF_RIM_REACH_M / grid.cell));
    const rimMax = dilateGroundMax(grid.groundZ, grid.cols, grid.rows, rimCells);
    const farCells = Math.max(rimCells + 1, rimCells * VEG_RIM_FAR_FACTOR);
    const rimFar = dilateGroundMax(grid.groundZ, grid.cols, grid.rows, farCells);
    const anchorCells = Math.max(1, Math.round(overhangReachM / grid.cell));
    const anchorMax = dilateGroundMax(grid.groundZ, grid.cols, grid.rows, anchorCells);
    // Per-cell vegetation vertical span: forces a recessed-couloir wall to
    // falaise from the foliage's own vertical structure where the crest test,
    // fooled by the stepped-back face, would wrongly green it.
    const cliffSpanM = opts?.cliffSpanM ?? DEFAULT_VEG_CLIFF_SPAN_M;
    const vegSpan = vegSpanField(grid, positions, classifications, pointCount);
    // Slope floor for the detailed classifier: a per-cell slope field on the same
    // 4 m baseline as "Falaise simple", built only when the slider is on so the
    // default path pays nothing and stays byte-identical.
    const cliffSlopeMinDeg = opts?.cliffSlopeMinDeg ?? 0;
    const slopeField = cliffSlopeMinDeg > 0
        ? groundSlopeField(grid, Math.max(1, Math.round(DEFAULT_VEG_SLOPE_SAMPLE_M / grid.cell)))
        : null;
    const tuning: VegBlendTuning = {
        gapM, roughM, roughLow: roughM * roughLowFrac, dropM: DEFAULT_VEG_OVERHANG_DROP_M,
        spanM: cliffSpanM, slopeMin: cliffSlopeMinDeg,
    };
    // Optional cliff distance override (experimental, falaise points only). The
    // surface3d hash is built only when that mode is active; `column` (default)
    // never touches the rendered stacked height → byte-identical.
    const distMode: VegCliffDistMode = opts?.cliffDistMode ?? 'column';
    // Sparse-cluster fallback: a falaise point alone in a tiny vertical cluster
    // gets its 0-pinned stacked height replaced by the wall distance. The
    // per-point cluster size is only computed when the threshold is on (and only
    // matters in `column` mode — the other modes already override every falaise
    // point), so the default path stays byte-identical and pays nothing.
    const sparseMaxPts = opts?.cliffSparseMaxPts ?? 0;
    const clusterCounts = sparseClusterCounts(
        sparseMaxPts, distMode, positions, classifications, pointCount, gapM, columnCellM,
    );
    const distCtx: CliffDistCtx = {
        mode: distMode, grid, rimMax, maxR: DEFAULT_VEG_CLIFF_DIST_MAX_M,
        sparseMaxPts, clusterCounts,
        // Voxel the bare-earth hash at the SEARCH RADIUS, not the ground grid
        // cell: nearestGroundDist scans a ±⌈maxR/cell⌉ window, so a fine cell
        // (~2 m) exploded into a 13³ = 2197-bucket Map probe per cliff point —
        // and on a bare face (no ground within reach, the common cliff case)
        // every query ran the full window, freezing the recompute. With
        // cell = maxR the window collapses to 3³ = 27 buckets; the nearest-point
        // distance is unchanged (any point within maxR is still within ±1 cell).
        hash: distMode === 'surface3d'
            ? buildGroundPointHash(positions, classifications, pointCount, DEFAULT_VEG_CLIFF_DIST_MAX_M)
            : null,
    };
    // Mark the falaise points so the optional outlier-smoothing pass can scope
    // itself to cliff vegetation only (flat-ground forest is left untouched).
    const isCliff = new Uint8Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        const k = gridCell(grid, x, y);
        if (k < 0) continue;
        const g = grid.groundZ[k], r = grid.roughness[k];
        if (!Number.isFinite(g) || !Number.isFinite(r)) continue;
        const z = positions[i * 3 + 2];
        const stacked = out[i];
        const rim = rimInfoFor(k, g, rimMax, rimFar, anchorMax, vegSpan, slopeField);
        const b = blendVegHeight(z, g, rim, stacked, tuning);
        isCliff[i] = Number(b.cliff);
        // Classification (above) stays on the stable per-cell ground, but the
        // rendered height is delegated to a helper: pente samples a CONTINUOUS
        // bilinear ground (no cell-step banding), surplomb keeps its fixed-reach
        // rim anchor, and a red falaise point may take an opt-in distance metric.
        out[i] = finalVegHeight(distCtx, i, x, y, z, stacked, b);
        if (diag) writeCellDiag(diag, i, b.wVertical, r, b.floating, b.cliffAnchored);
    }
    return smoothCliffOutliers(out, positions, isCliff, pointCount, opts?.vegColorSmooth ?? 0);
}

/**
 * "Falaise simple" mode (see {@link VegHeightOptions.cliffSlopeDeg}). Classify
 * each vegetation point from the local ground slope alone — steep → falaise
 * (stacked column height), gentle → pente (vertical-to-ground) — with a
 * `±VEG_SLOPE_BAND_DEG` smoothstep across the chosen threshold so the colour
 * seam stays soft. No crest test, no vegetation-span wall test, no surplomb
 * anchoring: one slider, one decision. The final outlier-smoothing pass still
 * runs so the "Lissage couleur" slider keeps working in this mode too.
 */
function computeVegHeightsBySlope(
    out: Float32Array, positions: Float32Array, classifications: Uint8Array,
    pointCount: number, grid: VegGroundGrid,
    cfg: { slopeDeg: number; sampleM: number; colorSmooth: number }, diag: Uint8Array | null,
): Float32Array {
    const radius = Math.max(1, Math.round(cfg.sampleM / grid.cell));
    const slope = groundSlopeField(grid, radius);
    const e0 = Math.max(0, cfg.slopeDeg - VEG_SLOPE_BAND_DEG);
    const e1 = cfg.slopeDeg + VEG_SLOPE_BAND_DEG;
    const isCliff = new Uint8Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        const k = gridCell(grid, x, y);
        if (k < 0) continue;
        const g = grid.groundZ[k];
        if (!Number.isFinite(g)) continue;
        const sd = slope[k];
        // Above the threshold the cell is falaise (wVertical→0, stacked height);
        // below it is pente (wVertical→1, vertical-to-ground). NaN slope (no
        // gradient) defaults to pente.
        const wVertical = Number.isFinite(sd) ? 1 - smoothstep(e0, e1, sd) : 1;
        const z = positions[i * 3 + 2];
        const b: VegBlend = {
            groundRef: g, wVertical, floating: false, cliffAnchored: false, cliff: wVertical < 0.5,
        };
        isCliff[i] = Number(b.cliff);
        out[i] = renderVegHeight(grid, x, y, z, out[i], b);
        if (diag) {
            const r = grid.roughness[k];
            writeCellDiag(diag, i, wVertical, Number.isFinite(r) ? r : 0, false, false);
        }
    }
    return smoothCliffOutliers(out, positions, isCliff, pointCount, cfg.colorSmooth);
}

/** Per-cell height totals over the cliff vegetation points, used to derive a
 *  count-weighted robust local reference for outlier rejection. */
interface CliffSmoothGrid {
    minX: number; minY: number; cell: number;
    cols: number; rows: number; sum: Float64Array; cnt: Uint32Array;
}

/** XY bounds over the cliff vegetation points, or null when there is none. */
function cliffBounds(
    positions: Float32Array, isCliff: Uint8Array, pointCount: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pointCount; i++) {
        if (!isCliff[i]) continue;
        const x = positions[i * 3], y = positions[i * 3 + 1];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Accumulate the rendered height of every cliff point into a coarse grid. */
function buildCliffSmoothGrid(
    out: Float32Array, positions: Float32Array, isCliff: Uint8Array,
    pointCount: number, cell: number,
): CliffSmoothGrid | null {
    const b = cliffBounds(positions, isCliff, pointCount);
    if (!b) return null;
    const cols = Math.floor((b.maxX - b.minX) / cell) + 1;
    const rows = Math.floor((b.maxY - b.minY) / cell) + 1;
    const sum = new Float64Array(cols * rows);
    const cnt = new Uint32Array(cols * rows);
    for (let i = 0; i < pointCount; i++) {
        if (!isCliff[i]) continue;
        const cx = Math.floor((positions[i * 3] - b.minX) / cell);
        const cy = Math.floor((positions[i * 3 + 1] - b.minY) / cell);
        const k = cy * cols + cx;
        sum[k] += out[i];
        cnt[k]++;
    }
    return { minX: b.minX, minY: b.minY, cell, cols, rows, sum, cnt };
}

/** Count-weighted mean height over a (2r+1)² cell block — robust to isolated
 *  absurd returns (a lone point carries count 1, so it barely moves the
 *  reference). NaN only when the whole block is empty. */
function blockMeanHeight(g: CliffSmoothGrid, cx: number, cy: number, radius: number): number {
    let s = 0, c = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        const gy = cy + dy;
        if (gy < 0 || gy >= g.rows) continue;
        for (let dx = -radius; dx <= radius; dx++) {
            const gx = cx + dx;
            if (gx < 0 || gx >= g.cols) continue;
            const k = gy * g.cols + gx;
            s += g.sum[k];
            c += g.cnt[k];
        }
    }
    return c > 0 ? s / c : Number.NaN;
}

/**
 * Attenuate isolated absurd cliff-vegetation heights.
 *
 * Sparse cliff LiDAR scatters the odd point at a height wildly different from
 * its neighbours — typically a very-low return painting a brown speck — and
 * those high-contrast specks are what reads as visual noise. For each cliff
 * point this compares its rendered height against a count-weighted mean of a
 * wide neighbourhood (so a lone speck barely contaminates its own reference) and
 * blends it toward that reference. The blend RAMPS in beyond
 * `VEG_COLOR_SMOOTH_TOL_M`: heights within the tolerance (genuine
 * column-to-column steps) are untouched, points just past it are barely moved
 * even at full strength (columns keep their colour), and only points far past
 * `tol + VEG_COLOR_SMOOTH_RAMP_M` — the absurd specks — are pulled all the way
 * onto the reference. `strength ≤ 0` returns the buffer unchanged. O(n) with a
 * small fixed neighbourhood scan.
 */
export function smoothCliffOutliers(
    out: Float32Array, positions: Float32Array, isCliff: Uint8Array,
    pointCount: number, strength: number,
): Float32Array {
    if (strength <= 0) return out;
    const g = buildCliffSmoothGrid(out, positions, isCliff, pointCount, VEG_COLOR_SMOOTH_CELL_M);
    if (!g) return out;
    const s = Math.min(1, strength);
    const tol = VEG_COLOR_SMOOTH_TOL_M;
    for (let i = 0; i < pointCount; i++) {
        if (!isCliff[i]) continue;
        const cx = Math.floor((positions[i * 3] - g.minX) / g.cell);
        const cy = Math.floor((positions[i * 3 + 1] - g.minY) / g.cell);
        const ref = blockMeanHeight(g, cx, cy, VEG_COLOR_SMOOTH_RADIUS);
        if (!Number.isFinite(ref)) continue;
        const adev = Math.abs(out[i] - ref);
        if (adev <= tol) continue;
        // Ramp the pull from 0 (at tol) to full over the transition band, then
        // blend the whole height toward the reference — so a strong outlier lands
        // ON the reference at full strength, not merely at the tolerance edge.
        const ramp = Math.min(1, (adev - tol) / VEG_COLOR_SMOOTH_RAMP_M);
        const blend = s * ramp;
        out[i] = out[i] * (1 - blend) + ref * blend;
    }
    return out;
}

/** Seed the diagnostic buffer for every vegetation point: mark it as vegetation
 *  and record its stacked cluster id. Points over a ground cell are refined
 *  later by {@link writeCellDiag}; those without ground keep blendW = 0 (full
 *  stacked) and no GROUND flag. */
function initVegDiag(
    diag: Uint8Array, classifications: Uint8Array, pointCount: number, cluster: Uint8Array,
): void {
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const o = i * VEG_DIAG_STRIDE;
        diag[o] = 0;
        diag[o + 1] = cluster[i];
        diag[o + 2] = DIAG_FLAG_VEG;
        diag[o + 3] = 0;
    }
}

/** Record a vegetation point's blend weight, relief and decision flags. */
function writeCellDiag(
    diag: Uint8Array, i: number, wVertical: number, rough: number,
    floating: boolean, cliffAnchored: boolean,
): void {
    const o = i * VEG_DIAG_STRIDE;
    diag[o] = Math.round(Math.min(1, Math.max(0, wVertical)) * 255);
    diag[o + 2] = DIAG_FLAG_VEG | DIAG_FLAG_GROUND
        | (floating ? DIAG_FLAG_FLOATING : 0)
        | (cliffAnchored ? DIAG_FLAG_CLIFF : 0);
    diag[o + 3] = Math.min(255, Math.round(Math.max(0, rough) * 10));
}

/**
 * Per-point vegetation height measured as a **stacked ground**: within each
 * small XY column the vegetation points are sorted by elevation and split into
 * clusters wherever a vertical gap exceeds `gapM`; a point's height is its
 * elevation above the base of its own cluster.
 *
 * Why not a single ground surface — on a cliff the LiDAR has no ground returns
 * under the trees, so every "height above the ground" is wrong: a vertical drop
 * hits the cliff base tens of metres below (phantom tall trees), while the
 * nearest-surface distance flattens a real tree leaning on the rock to the
 * couple of metres it sits from the face. Clustering the column instead recovers
 * the true structure:
 *   • a tall tree growing along the cliff is one tall cluster → full height;
 *   • trees rooted on different ledges of the same face are separate clusters
 *     (a vertical void splits them) → each keeps its own height;
 *   • on flat ground the whole column is a single cluster anchored at the lowest
 *     return ≈ the ground, so the height is the ordinary height-above-ground.
 *
 * `gapM` is the one knob: larger merges a sparse trunk with its canopy (safer in
 * dense forest) but can merge closely stacked ledges; smaller separates ledges
 * more eagerly but can clip a tree at an internal void. Tune it to the terrain.
 *
 * Returns a height per point (0 for non-vegetation and at each cluster base).
 */
export function computeVegHeightStacked(
    positions: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    gapM: number,
    columnCellM = DEFAULT_VEG_COLUMN_CELL_M,
    clusterOut?: Uint8Array | null,
): Float32Array {
    const out = new Float32Array(pointCount);
    const KEY_BIAS = 0x8000;
    // Pass 1 — vertical clustering per XY column. `selfBase` holds each point's
    // own cluster base; `columnBases` keeps the sorted cluster bases per column.
    const { selfBase, columnBases } = clusterVegColumns(
        positions, classifications, pointCount, gapM, columnCellM, KEY_BIAS, clusterOut,
    );
    // Pass 2 — smooth the cluster base spatially so the height ramp varies
    // continuously across columns instead of stepping at every cell edge. Hard
    // per-column bases produced visible vertical seams (width = columnCellM) all
    // over a cliff face; a distance-weighted average of neighbouring columns —
    // tolerant enough to bridge sparse-sampling base jumps but capped well below
    // a real ledge (`VEG_BASE_SMOOTH_TOL_M`) — makes the colouring organic.
    const inv = 1 / columnCellM;
    const tol = Math.max(gapM, VEG_BASE_SMOOTH_TOL_M);
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const z = positions[i * 3 + 2];
        const fx = positions[i * 3] * inv, fy = positions[i * 3 + 1] * inv;
        const base = smoothColumnBase(columnBases, fx, fy, selfBase[i], tol, KEY_BIAS);
        out[i] = Math.max(0, z - base);
    }
    return out;
}

/** Bucket vegetation points into XY columns and split each column into vertical
 *  clusters wherever a gap exceeds `gapM` (a ledge or a void between trees). The
 *  column key packs the two cell coordinates into one integer; the bias keeps
 *  both non-negative and the ×65536 stride is collision-free for our offsets
 *  (|x|,|y| ≤ ~1 km, cell ≥ 1 m). Optionally fills `clusterOut` with hue ids. */
function clusterVegColumns(
    positions: Float32Array, classifications: Uint8Array, pointCount: number,
    gapM: number, columnCellM: number, keyBias: number, clusterOut?: Uint8Array | null,
): { selfBase: Float32Array; columnBases: Map<number, number[]> } {
    const columns = new Map<number, number[]>();
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        const cx = Math.floor(positions[i * 3] / columnCellM) + keyBias;
        const cy = Math.floor(positions[i * 3 + 1] / columnCellM) + keyBias;
        const key = cx * 0x10000 + cy;
        let col = columns.get(key);
        if (!col) { col = []; columns.set(key, col); }
        col.push(i);
    }
    const selfBase = new Float32Array(pointCount);
    const columnBases = new Map<number, number[]>();
    for (const [key, col] of columns) {
        col.sort((a, b) => positions[a * 3 + 2] - positions[b * 3 + 2]);
        let base = positions[col[0] * 3 + 2];
        let prev = base;
        let clusterIdx = 0;
        const bases: number[] = [base];
        for (const idx of col) {
            const z = positions[idx * 3 + 2];
            if (z - prev > gapM) { base = z; clusterIdx++; bases.push(base); } // vertical void → next ledge / tree
            selfBase[idx] = base;
            if (clusterOut) clusterOut[idx] = clusterHash(key, clusterIdx);
            prev = z;
        }
        columnBases.set(key, bases);
    }
    return { selfBase, columnBases };
}

/** Closest cluster base to `target` within `tol`, else `target` itself. The
 *  guard keeps a neighbouring ledge (a different vertical band) from pulling the
 *  base across a genuine void. */
function pickColumnBase(bases: number[] | undefined, target: number, tol: number): number {
    if (!bases) return target;
    let best = target;
    let bestD = tol;
    for (const b of bases) {
        const d = Math.abs(b - target);
        if (d < bestD) { bestD = d; best = b; }
    }
    return best;
}

/** Distance-weighted average of the per-column cluster base over a small
 *  neighbourhood, evaluated at the point's exact position so the field stays
 *  continuous. Each cell contributes the base closest to the point's own base on
 *  the same ledge (`pickColumnBase`); cells with no compatible ledge fall back to
 *  the point's own base, so steps at real ledges survive while same-surface
 *  column seams are smoothed away. `fx`/`fy` are positions in cell units. */
function smoothColumnBase(
    columnBases: Map<number, number[]>, fx: number, fy: number, self: number, tol: number, bias: number,
): number {
    const SMOOTH_RADIUS = 1; // cells beyond the host cell → ~3-cell-wide kernel
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let sum = 0, wsum = 0;
    for (let dy = -SMOOTH_RADIUS; dy <= SMOOTH_RADIUS; dy++) {
        for (let dx = -SMOOTH_RADIUS; dx <= SMOOTH_RADIUS; dx++) {
            const ex = cx + dx + 0.5 - fx, ey = cy + dy + 0.5 - fy; // cell centre offset
            const w = 1 - Math.hypot(ex, ey) / (SMOOTH_RADIUS + 1);
            if (w <= 0) continue;
            const key = (cx + dx + bias) * 0x10000 + (cy + dy + bias);
            sum += w * pickColumnBase(columnBases.get(key), self, tol);
            wsum += w;
        }
    }
    return wsum > 0 ? sum / wsum : self;
}

function clusterHash(key: number, clusterIdx: number): number {
    const h = Math.imul(key * 0x10 + clusterIdx + 1, 2654435761);
    return (h >>> 24) & 0xff;
}

/** No real tree exceeds this (m); anything above is a cliff/void artefact. */
export const DEFAULT_VEG_HEIGHT_CEILING = 60;
/** Floor for the auto colour scale so sparse scrub keeps a usable ramp (m). */
export const DEFAULT_VEG_HEIGHT_FLOOR = 5;
/** Min blendW (= round(wVertical×255) in the vegDiag) for a point's height to
 *  count as a clean, ground-measured tree rather than a cliff/stacked estimate.
 *  128 ≈ wVertical ≥ 0.5 — the height already leans mostly on real low-relief
 *  ground, so its canopy top is trustworthy. */
const VEG_TRUST_MIN_BLENDW = 128;
/** Histogram bin width for the robust percentile (m). */
const HIST_BIN_M = 0.5;

/** Bin the positive vegetation heights into a fixed-width histogram. When
 *  `diag` is given, only points whose blendW reaches `minBlendW` are counted —
 *  letting the caller restrict the reference to trustworthy non-cliff trees. */
function vegHeightHistogram(
    heightAboveGround: Float32Array, classifications: Uint8Array, pointCount: number, ceiling: number,
    diag?: Uint8Array | null, minBlendW = 0,
): { bins: Uint32Array; total: number } {
    const bins = new Uint32Array(Math.ceil(ceiling / HIST_BIN_M) + 1);
    let total = 0;
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_HEIGHT_CLASSES.has(classifications[i])) continue;
        if (diag && diag[i * VEG_DIAG_STRIDE] < minBlendW) continue;
        const h = heightAboveGround[i];
        if (h <= 0) continue;
        bins[Math.min(bins.length - 1, Math.floor(h / HIST_BIN_M))]++;
        total++;
    }
    return { bins, total };
}

/** Upper edge (m) of the bin where the cumulative count first reaches `p·total`. */
function percentileHeight(bins: Uint32Array, total: number, p: number): number {
    const target = total * p;
    let cum = 0;
    for (let b = 0; b < bins.length; b++) {
        cum += bins[b];
        if (cum >= target) return (b + 1) * HIST_BIN_M;
    }
    return bins.length * HIST_BIN_M;
}

/**
 * Clamp absurd vegetation heights and derive the canopy's robust top height.
 *
 * Vegetation points near a cliff edge sit over a grid cell whose min-Z ground is
 * the *base* of the cliff (the void below), so `z - groundZ` balloons to tens of
 * phantom metres — which would both mis-colour those points and, worse, blow up
 * any height-derived colour scale.
 *
 * When the per-point `diag` is supplied we take the reference height from the
 * **trustworthy, ground-measured trees only** (blendW ≥ {@link VEG_TRUST_MIN_BLENDW},
 * i.e. not on a cliff) — their 99th-percentile canopy top is clean. Every
 * vegetation point (cliff trees included) is then clamped to it. A pure-cliff
 * capture has no such trees, so we fall back to the 99th percentile of the whole
 * population (robust to the <1 % phantom outliers).
 *
 * Mutates `heightAboveGround` in place. Returns the robust max height (m), or
 * `null` when there is no vegetation to measure.
 */
export function sanitizeVegHeights(
    heightAboveGround: Float32Array,
    classifications: Uint8Array,
    pointCount: number,
    diag?: Uint8Array | null,
    ceiling = DEFAULT_VEG_HEIGHT_CEILING,
    floor = DEFAULT_VEG_HEIGHT_FLOOR,
): number | null {
    const trusted = diag
        ? vegHeightHistogram(heightAboveGround, classifications, pointCount, ceiling, diag, VEG_TRUST_MIN_BLENDW)
        : { bins: new Uint32Array(0), total: 0 };
    const hist = trusted.total > 0
        ? trusted
        : vegHeightHistogram(heightAboveGround, classifications, pointCount, ceiling);
    if (hist.total === 0) return null;
    const robustMax = Math.min(
        ceiling,
        Math.max(floor, percentileHeight(hist.bins, hist.total, 0.99)),
    );
    for (let i = 0; i < pointCount; i++) {
        if (VEG_HEIGHT_CLASSES.has(classifications[i]) && heightAboveGround[i] > robustMax) {
            heightAboveGround[i] = robustMax;
        }
    }
    return robustMax;
}
