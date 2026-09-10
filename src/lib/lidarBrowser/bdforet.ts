/**
 * IGN BD Forêt® v2 vegetation typing for LiDAR point clouds.
 *
 * BD Forêt v2 is a national vector layer of forest stands ("formations
 * végétales"), each polygon carrying a dominant species (`essence`) and a
 * coarse 11-class formation grouping (`tfv_g11`). We fetch the stands covering
 * a capture via WFS, then label every vegetation LiDAR point (LAS classes
 * 3/4/5) with the forest *category* of the stand it falls in — turning the raw
 * green canopy into a species-accurate forest.
 *
 * Coordinate frame: LiDAR positions are east/north/up meter offsets relative to
 * the capture's Lambert-93 origin `(x0, y0) = lngLatToL93(centerLng, centerLat)`
 * (the exact origin the extract pipeline uses). We therefore request the WFS
 * geometry directly in Lambert-93 (`srsname=EPSG:2154`) and translate it into
 * that same offset frame by subtracting the origin — no equirectangular
 * approximation, so stand boundaries stay metric-accurate to the tile edge.
 *
 * Two ID spaces drive the GPU rendering:
 *   • category id (0..FOREST_CATEGORY_COUNT-1, 255 = none) — stored per point.
 *     One per BD Forêt `essence` value, including the three *mix* essences
 *     ("Feuillus", "Conifères", "Mixte") that resolve to a candidate set.
 *   • legend id — what a point is finally colored by:
 *       - group mode  → the stand's coarse group (from `tfv_g11`), flat.
 *       - species mode → a concrete leaf species; mix stands pick one candidate
 *         per tree (driven by the treetop seed) so a mixed stand renders as a
 *         plausible salt-and-pepper of its species.
 */

import { lngLatToL93 } from './proj';

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TYPENAME = 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale';
/** Stands are silently truncated past this count; ~28/km² observed, so this
 *  covers the largest allowed capture (25 km²) with margin. */
const MAX_FEATURES = 3000;

/** LAS classes that carry vegetation returns (basse / moyenne / haute). */
const VEG_CLASSES = new Set([3, 4, 5]);

/** Per-point sentinel: not vegetation, or outside every forest stand. */
export const FOREST_NONE = 255;

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type ForestGrouping = 'group' | 'species';

export interface ForestLegendEntry {
    /** Stable id within its space (group id, or species id). */
    id: number;
    label: string;
    /** Display color, 0–255 RGB. */
    color: [number, number, number];
}

/**
 * Coarse groups, derived from BD Forêt `tfv_g11`. Index = group id.
 * Cool/warm split keeps broadleaf vs conifer instantly readable.
 */
export const FOREST_GROUPS: readonly ForestLegendEntry[] = [
    { id: 0, label: 'Feuillus', color: [120, 170, 72] },
    { id: 1, label: 'Conifères', color: [58, 124, 112] },
    { id: 2, label: 'Mixte', color: [104, 162, 116] },
    { id: 3, label: 'Peupleraie', color: [196, 212, 128] },
    { id: 4, label: 'Milieu ouvert', color: [196, 184, 112] },
    { id: 5, label: 'Autre', color: [150, 150, 142] },
];

interface ForestSpecies extends ForestLegendEntry {
    /** Group this species belongs to (index into FOREST_GROUPS). */
    group: number;
}

/**
 * Concrete leaf species. Index = species id. Warm yellow-greens for broadleaf,
 * cool teals for conifer, with a couple of stand-out hues (mélèze lime,
 * peuplier pale) so a mixed canopy reads as distinct trees.
 */
export const FOREST_SPECIES: readonly ForestSpecies[] = [
    { id: 0, label: 'Chêne', color: [108, 142, 52], group: 0 },
    { id: 1, label: 'Hêtre', color: [156, 196, 96], group: 0 },
    { id: 2, label: 'Châtaignier', color: [188, 200, 84], group: 0 },
    { id: 3, label: 'Robinier', color: [126, 158, 70], group: 0 },
    { id: 4, label: 'Feuillus divers', color: [138, 176, 82], group: 0 },
    { id: 5, label: 'Pin sylvestre', color: [86, 156, 150], group: 1 },
    { id: 6, label: 'Pin maritime', color: [70, 140, 124], group: 1 },
    { id: 7, label: 'Pin noir / laricio', color: [52, 116, 108], group: 1 },
    { id: 8, label: 'Pin à crochets / cembro', color: [120, 158, 160], group: 1 },
    { id: 9, label: 'Sapin / épicéa', color: [40, 98, 92], group: 1 },
    { id: 10, label: 'Mélèze', color: [150, 182, 108], group: 1 },
    { id: 11, label: 'Douglas', color: [48, 112, 82], group: 1 },
    { id: 12, label: 'Conifères divers', color: [62, 124, 108], group: 1 },
    { id: 13, label: 'Peuplier', color: [196, 212, 128], group: 3 },
    { id: 14, label: 'Lande / herbacé', color: [196, 184, 112], group: 4 },
    { id: 15, label: 'Autre', color: [150, 150, 142], group: 5 },
];

interface ForestCategory {
    /** Stable key for debugging / tests. */
    key: string;
    /** Coarse group id (index into FOREST_GROUPS). */
    group: number;
    /** Pure leaf species id, or -1 for a mix category. */
    species: number;
    /** Equal-weight candidate species ids for a mix category; [] when pure. */
    candidates: number[];
}

/**
 * BD Forêt `essence`-level categories. Index = category id (stored per point).
 * The three mix categories ("Feuillus", "Conifères", "Mixte") are the generic
 * `essence` values IGN assigns to stands without a single dominant species.
 */
export const FOREST_CATEGORIES: readonly ForestCategory[] = [
    { key: 'chene', group: 0, species: 0, candidates: [] },
    { key: 'hetre', group: 0, species: 1, candidates: [] },
    { key: 'chataignier', group: 0, species: 2, candidates: [] },
    { key: 'robinier', group: 0, species: 3, candidates: [] },
    { key: 'feuillus-mix', group: 0, species: -1, candidates: [0, 1, 2, 3, 4] },
    { key: 'pin-sylvestre', group: 1, species: 5, candidates: [] },
    { key: 'pin-maritime', group: 1, species: 6, candidates: [] },
    { key: 'pin-noir', group: 1, species: 7, candidates: [] },
    { key: 'pin-crochets', group: 1, species: 8, candidates: [] },
    { key: 'sapin-epicea', group: 1, species: 9, candidates: [] },
    { key: 'meleze', group: 1, species: 10, candidates: [] },
    { key: 'douglas', group: 1, species: 11, candidates: [] },
    { key: 'coniferes-mix', group: 1, species: -1, candidates: [5, 6, 7, 9, 10, 11, 12] },
    { key: 'mixte', group: 2, species: -1, candidates: [0, 1, 5, 9] },
    { key: 'peupleraie', group: 3, species: 13, candidates: [] },
    { key: 'lande', group: 4, species: 14, candidates: [] },
    { key: 'autre', group: 5, species: 15, candidates: [] },
];

export const FOREST_GROUP_COUNT = FOREST_GROUPS.length;
export const FOREST_SPECIES_COUNT = FOREST_SPECIES.length;
export const FOREST_CATEGORY_COUNT = FOREST_CATEGORIES.length;

// Category id constants used by the resolver / fallbacks.
const CAT_FEUILLUS_MIX = 4;
const CAT_CONIFERES_MIX = 12;
const CAT_MIXTE = 13;
const CAT_PEUPLERAIE = 14;
const CAT_LANDE = 15;
const CAT_AUTRE = 16;

/** Strip accents and lowercase so `essence` matching is robust. */
function norm(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Ordered `essence` → category rules; first substring hit wins. */
const ESSENCE_RULES: readonly [string, number][] = [
    ['chene', 0],
    ['hetre', 1],
    ['chataignier', 2],
    ['robinier', 3],
    ['sylvestre', 5],
    ['maritime', 6],
    ['laricio', 7],
    ['pin noir', 7],
    ['crochets', 8],
    ['cembro', 8],
    ['sapin', 9],
    ['epicea', 9],
    ['meleze', 10],
    ['douglas', 11],
    ['peupl', CAT_PEUPLERAIE],
    ['feuillus', CAT_FEUILLUS_MIX],
    // Generic / minor conifers (Pin d'Alep, autres pins…) → conifer mix.
    ['coniferes', CAT_CONIFERES_MIX],
    ['pin', CAT_CONIFERES_MIX],
    ['mixte', CAT_MIXTE],
];

/** Ordered `tfv_g11` → category fallback rules. */
const TFV_RULES: readonly [string, number][] = [
    ['feuillus', CAT_FEUILLUS_MIX],
    ['coniferes', CAT_CONIFERES_MIX],
    ['mixte', CAT_MIXTE],
    ['peupleraie', CAT_PEUPLERAIE],
    ['herbac', CAT_LANDE],
    ['lande', CAT_LANDE],
    ['ouverte', CAT_LANDE],
];

function matchRules(s: string, rules: readonly [string, number][]): number {
    for (const [needle, cat] of rules) {
        if (s.includes(needle)) return cat;
    }
    return -1;
}

/**
 * Map a BD Forêt `essence` (primary) and `tfv_g11` (fallback) to a category id.
 * Returns CAT_AUTRE for anything unrecognised so the point still gets a stand
 * color rather than dropping back to the generic vegetation ramp.
 */
export function resolveForestCategory(essence: string, tfvG11: string): number {
    const e = norm(essence);
    if (e && e !== 'nc') {
        const c = matchRules(e, ESSENCE_RULES);
        if (c >= 0) return c;
    }
    const g = matchRules(norm(tfvG11), TFV_RULES);
    return g >= 0 ? g : CAT_AUTRE;
}

/** Legend entries (groups or concrete species) for the given grouping mode. */
export function forestLegendEntries(grouping: ForestGrouping): readonly ForestLegendEntry[] {
    return grouping === 'group' ? FOREST_GROUPS : FOREST_SPECIES;
}

// ---------------------------------------------------------------------------
// WFS fetch
// ---------------------------------------------------------------------------

/** One forest stand simplified to its category + Lambert-93 polygon rings. */
export interface ForestPolygon {
    cat: number;
    /** rings[0] = outer boundary, rings[1..] = holes. Flattened L93 [x,y,…]. */
    rings: Float32Array[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

type Ring = number[][];
type PolygonCoords = Ring[];

function flattenRing(ring: Ring): Float32Array {
    const flat = new Float32Array(ring.length * 2);
    let k = 0;
    for (const [x, y] of ring) {
        flat[k++] = x;
        flat[k++] = y;
    }
    return flat;
}

function ringBbox(ring: Ring): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
}

function ringsToPolygon(cat: number, rings: PolygonCoords): ForestPolygon | null {
    if (rings.length === 0 || rings[0].length < 3) return null;
    // bbox from the outer ring only (holes lie inside it).
    const [minX, minY, maxX, maxY] = ringBbox(rings[0]);
    return { cat, rings: rings.map(flattenRing), minX, minY, maxX, maxY };
}

function featureToPolygons(
    cat: number,
    geometry: { type?: string; coordinates?: unknown },
    out: ForestPolygon[],
): void {
    if (geometry.type === 'Polygon') {
        const p = ringsToPolygon(cat, geometry.coordinates as PolygonCoords);
        if (p) out.push(p);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates as PolygonCoords[]) {
            const p = ringsToPolygon(cat, poly);
            if (p) out.push(p);
        }
    }
}

/**
 * Fetch the BD Forêt v2 stands covering the capture and return them as
 * category-tagged Lambert-93 polygons. The WFS is filtered with a WGS84 bbox
 * (lng,lat axis order, as the IGN endpoint expects) but the geometry is
 * requested in EPSG:2154 so it lands in the LiDAR coordinate frame directly.
 *
 * Returns `[]` on any failure — vegetation simply falls back to the generic
 * ramp, never blocking a capture.
 */
export async function fetchForestPolygons(
    centerLng: number,
    centerLat: number,
    radius: number,
    signal?: AbortSignal,
): Promise<ForestPolygon[]> {
    const dLat = (radius * 1.2) / 111_320;
    const dLng = (radius * 1.2) / (111_320 * Math.cos((centerLat * Math.PI) / 180));
    const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typenames: TYPENAME,
        srsname: 'EPSG:2154',
        bbox: `${centerLng - dLng},${centerLat - dLat},${centerLng + dLng},${centerLat + dLat},EPSG:4326`,
        outputFormat: 'application/json',
        count: String(MAX_FEATURES),
    });
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal,
    });
    if (!res.ok) {
        throw new Error(`BD Forêt WFS GetFeature failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json() as {
        features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[];
    };
    const features = Array.isArray(data.features) ? data.features : [];
    const polygons: ForestPolygon[] = [];
    for (const f of features) {
        if (!f.geometry) continue;
        const props = f.properties ?? {};
        const essence = typeof props.essence === 'string' ? props.essence : '';
        const tfvG11 = typeof props.tfv_g11 === 'string' ? props.tfv_g11 : '';
        const cat = resolveForestCategory(essence, tfvG11);
        featureToPolygons(cat, f.geometry, polygons);
    }
    return polygons;
}

// ---------------------------------------------------------------------------
// Stand rasterisation
// ---------------------------------------------------------------------------

function polygonsBbox(polygons: ForestPolygon[]): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygons) {
        if (p.minX < minX) minX = p.minX;
        if (p.minY < minY) minY = p.minY;
        if (p.maxX > maxX) maxX = p.maxX;
        if (p.maxY > maxY) maxY = p.maxY;
    }
    return [minX, minY, maxX, maxY];
}

/**
 * Label every vegetation point with the forest category of the stand it falls
 * in. Positions are east/north/up offsets from the capture's Lambert-93 origin;
 * we reconstruct that origin from `centerLng/centerLat` (identical to the
 * pipeline's `lngLatToL93`) and test points against the L93 polygons.
 *
 * Rather than ray-casting every one of the (millions of) vegetation points —
 * each against polygon rings that can carry thousands of vertices — we first
 * scanline-fill the stands into a coarse category grid ({@link RASTER_CELL_M}
 * per cell), then label each point with an O(1) grid lookup. That is
 * O(ring vertices + cells + points), independent of the capture's size.
 *
 * Output: `Uint8Array` of category ids, `FOREST_NONE` (255) for non-vegetation
 * points and vegetation outside every stand.
 */
export function classifyForest(
    positions: Float32Array,
    pointCount: number,
    classifications: Uint8Array,
    centerLng: number,
    centerLat: number,
    polygons: ForestPolygon[],
    edge: ForestEdgeOptions = SHARP_EDGE,
): Uint8Array {
    const raster = buildForestRaster(positions, pointCount, classifications, centerLng, centerLat, polygons);
    if (!raster) return new Uint8Array(pointCount).fill(FOREST_NONE);
    return labelForestPoints(positions, pointCount, classifications, centerLng, centerLat, raster, edge);
}

/**
 * Rasterise the BD Forêt stands covering a capture into a coarse category grid
 * (one category id per {@link RASTER_CELL_M} cell). This is the reusable,
 * geometry-independent part of {@link classifyForest}: kept on the cloud so the
 * per-point labelling — and its edge-blend — can be re-run live (changing the
 * blend mode/width) without re-fetching or re-ray-casting the polygons.
 */
export function buildForestRaster(
    positions: Float32Array,
    pointCount: number,
    classifications: Uint8Array,
    centerLng: number,
    centerLat: number,
    polygons: ForestPolygon[],
): ForestRaster | null {
    if (polygons.length === 0) return null;
    const [x0, y0] = lngLatToL93(centerLng, centerLat);
    // Bound the raster to the vegetation points' own extent: BD Forêt stands are
    // returned unclipped and can span kilometres well beyond the capture.
    const ext = vegPointsExtent(positions, pointCount, classifications, x0, y0);
    if (!ext) return null;
    const raster = rasterizeForest(polygons, ext);
    return raster.cols === 0 || raster.rows === 0 ? null : raster;
}

/**
 * How the per-point category lookup treats stand boundaries.
 *   • `sharp`   — hard polygon edges (ruler-straight demarcations).
 *   • `feather` — domain-warp the lookup by a smooth value-noise field, turning
 *     each boundary into one organic, coherent wiggly ecotone (whole crowns
 *     shift together, keeping every tree single-coloured).
 *   • `scatter` — displace each point by an independent random offset within a
 *     disc, so the two stands' species progressively interleave point-by-point
 *     across the transition band (densest at the boundary, fading outward).
 */
export type ForestEdgeBlend = 'sharp' | 'feather' | 'scatter';

export interface ForestEdgeOptions {
    blend: ForestEdgeBlend;
    /** Transition band width (m). Ignored when `blend === 'sharp'`. */
    bandM: number;
}

const SHARP_EDGE: ForestEdgeOptions = { blend: 'sharp', bandM: 0 };

/** Noise length scale (m) of the `feather` warp ≈ crown spacing (coherent crowns). */
const FOREST_FEATHER_CELL_M = 9;

/**
 * Label every vegetation point with the category of the stand it falls in,
 * applying the requested edge-blend. Membership is decided on the point's true
 * position (points genuinely outside every stand stay `FOREST_NONE`); only the
 * *category sampled* is warped/scattered, so boundaries soften without leaking
 * forest onto bare ground.
 */
export function labelForestPoints(
    positions: Float32Array,
    pointCount: number,
    classifications: Uint8Array,
    centerLng: number,
    centerLat: number,
    raster: ForestRaster,
    edge: ForestEdgeOptions = SHARP_EDGE,
): Uint8Array {
    const out = new Uint8Array(pointCount).fill(FOREST_NONE);
    const { minX, minY, cols, rows } = raster;
    if (cols === 0 || rows === 0) return out;
    const [x0, y0] = lngLatToL93(centerLng, centerLat);
    const maxX = minX + cols * RASTER_CELL_M;
    const maxY = minY + rows * RASTER_CELL_M;
    const blended = edge.blend !== 'sharp' && edge.bandM > 0;
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_CLASSES.has(classifications[i])) continue;
        const px = x0 + positions[i * 3];
        const py = y0 + positions[i * 3 + 1];
        if (px < minX || px >= maxX || py < minY || py >= maxY) continue;
        out[i] = blended ? sampleBlended(px, py, raster, edge) : rasterAt(px, py, raster);
    }
    return out;
}

/** Clamp `v` into the inclusive integer range [0, hi]. */
function clampIndex(v: number, hi: number): number {
    if (v < 0) return 0;
    if (v > hi) return hi;
    return v;
}

/** Raw category at absolute-L93 (px,py), clamped to the raster bounds. */
function rasterAt(px: number, py: number, raster: ForestRaster): number {
    const { minX, minY, cols, rows, cats } = raster;
    const cx = clampIndex(Math.floor((px - minX) / RASTER_CELL_M), cols - 1);
    const cy = clampIndex(Math.floor((py - minY) / RASTER_CELL_M), rows - 1);
    return cats[cy * cols + cx];
}

/** Category sampled at a blend-displaced position (feather = smooth, scatter = random). */
function sampleBlended(px: number, py: number, raster: ForestRaster, edge: ForestEdgeOptions): number {
    let dx: number;
    let dy: number;
    if (edge.blend === 'feather') {
        // Smooth, spatially-coherent warp: neighbouring points (and whole crowns)
        // shift together, so the boundary stays a single wiggly line.
        dx = (forestWarpNoise(px, py, 1.3) - 0.5) * (2 * edge.bandM);
        dy = (forestWarpNoise(px, py, 7.7) - 0.5) * (2 * edge.bandM);
    } else {
        // Per-point white-noise displacement inside a disc of radius bandM: an
        // independent draw per point makes the two stands intermingle (the
        // probability of crossing falls off with distance to the boundary, so
        // the interleave is densest at the edge and fades over the band).
        const ang = forestPointHash(px, py, 11.3) * (2 * Math.PI);
        const rad = Math.sqrt(forestPointHash(px, py, 27.1)) * edge.bandM;
        dx = Math.cos(ang) * rad;
        dy = Math.sin(ang) * rad;
    }
    return rasterAt(px + dx, py + dy, raster);
}

/** Stable per-grid-corner hash in [0,1). `salt` selects an independent field. */
function forestHash(ix: number, iy: number, salt: number): number {
    const s = Math.sin(ix * 127.1 + iy * 311.7 + salt * 53.7) * 43758.5453;
    return s - Math.floor(s);
}

/** Stable per-point white-noise hash in [0,1) from world-metre coords. */
function forestPointHash(px: number, py: number, salt: number): number {
    const s = Math.sin(px * 12.9898 + py * 78.233 + salt * 37.719) * 43758.5453;
    return s - Math.floor(s);
}

/** Smooth 2-D value noise in [0,1) at world-metre coords (bilinear + smoothstep). */
function forestWarpNoise(x: number, y: number, salt: number): number {
    const gx = x / FOREST_FEATHER_CELL_M;
    const gy = y / FOREST_FEATHER_CELL_M;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const n00 = forestHash(ix, iy, salt);
    const n10 = forestHash(ix + 1, iy, salt);
    const n01 = forestHash(ix, iy + 1, salt);
    const n11 = forestHash(ix + 1, iy + 1, salt);
    const nx0 = n00 + (n10 - n00) * ux;
    const nx1 = n01 + (n11 - n01) * ux;
    return nx0 + (nx1 - nx0) * uy;
}

/** Side length (m) of the category raster cell — sub-tree precision, plenty for coloring. */
const RASTER_CELL_M = 2;

export interface ForestRaster {
    minX: number;
    minY: number;
    cols: number;
    rows: number;
    /** Category id per cell (row-major), `FOREST_NONE` outside every stand. */
    cats: Uint8Array;
}

/** Absolute-L93 bbox of the vegetation points, or null when there are none. */
function vegPointsExtent(
    positions: Float32Array,
    pointCount: number,
    classifications: Uint8Array,
    x0: number,
    y0: number,
): [number, number, number, number] | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pointCount; i++) {
        if (!VEG_CLASSES.has(classifications[i])) continue;
        const px = x0 + positions[i * 3];
        const py = y0 + positions[i * 3 + 1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    }
    return minX > maxX ? null : [minX, minY, maxX, maxY];
}

/** First cell index whose centre lies at or after `v` along an axis from `origin`. */
function cellAtOrAfter(v: number, origin: number): number {
    return Math.ceil((v - origin) / RASTER_CELL_M - 0.5);
}

/**
 * Push, for every scanline the ring's edges cross, the x of the crossing. An
 * edge only visits the rows it actually spans, so a ring costs O(its vertices +
 * the crossings it produces) — horizontal edges produce none.
 */
function collectCrossings(
    ring: Float32Array, by0: number, cy0: number, cy1: number, out: number[][],
): void {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i * 2 + 1], yj = ring[j * 2 + 1];
        const from = Math.max(cy0, cellAtOrAfter(Math.min(yi, yj), by0));
        const to = Math.min(cy1, cellAtOrAfter(Math.max(yi, yj), by0) - 1);
        if (to < from) continue;
        const xi = ring[i * 2];
        const slope = (ring[j * 2] - xi) / (yj - yi);
        for (let cy = from; cy <= to; cy++) {
            out[cy - cy0].push(xi + (by0 + (cy + 0.5) * RASTER_CELL_M - yi) * slope);
        }
    }
}

/**
 * Even-odd scanline fill of one stand. Holes need no special case: their
 * crossings flip the parity like any other ring.
 */
function fillPolygon(
    poly: ForestPolygon, cats: Uint8Array,
    bx0: number, by0: number, cols: number, rows: number,
): void {
    const cy0 = Math.max(0, cellAtOrAfter(poly.minY, by0));
    const cy1 = Math.min(rows - 1, cellAtOrAfter(poly.maxY, by0) - 1);
    if (cy1 < cy0) return;
    const crossings: number[][] = Array.from({ length: cy1 - cy0 + 1 }, () => []);
    for (const ring of poly.rings) collectCrossings(ring, by0, cy0, cy1, crossings);
    for (let cy = cy0; cy <= cy1; cy++) {
        const xs = crossings[cy - cy0];
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        const rowBase = cy * cols;
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const cxa = Math.max(0, cellAtOrAfter(xs[k], bx0));
            const cxb = Math.min(cols - 1, cellAtOrAfter(xs[k + 1], bx0) - 1);
            for (let cx = cxa; cx <= cxb; cx++) cats[rowBase + cx] = poly.cat;
        }
    }
}

/** Burn the stands into a coarse category raster. */
function rasterizeForest(
    polygons: ForestPolygon[],
    ext: [number, number, number, number],
): ForestRaster {
    const [px0, py0, px1, py1] = polygonsBbox(polygons);
    // Intersect the stand bbox with the capture extent — only cells that can hold
    // a vegetation point are worth rasterising.
    const bx0 = Math.max(px0, ext[0]);
    const by0 = Math.max(py0, ext[1]);
    const bx1 = Math.min(px1, ext[2]);
    const by1 = Math.min(py1, ext[3]);
    if (bx1 < bx0 || by1 < by0) {
        return { minX: bx0, minY: by0, cols: 0, rows: 0, cats: new Uint8Array(0) };
    }
    const cols = Math.max(1, Math.ceil((bx1 - bx0) / RASTER_CELL_M) + 1);
    const rows = Math.max(1, Math.ceil((by1 - by0) / RASTER_CELL_M) + 1);
    const cats = new Uint8Array(cols * rows).fill(FOREST_NONE);
    // BD Forêt is a partition, so overlaps are degenerate; where they happen the
    // last stand drawn wins.
    for (const poly of polygons) fillPolygon(poly, cats, bx0, by0, cols, rows);
    return { minX: bx0, minY: by0, cols, rows, cats };
}

// ---------------------------------------------------------------------------
// GPU lookup tables & palettes
// ---------------------------------------------------------------------------

export interface ForestGpuTables {
    /** category id → group id (index into FOREST_GROUPS), 255 for none. */
    catGroup: Uint8Array;
    /** category id → pure species id, or 255 when the category is a mix. */
    catSpecies: Uint8Array;
    /** category id → offset into `mixSpecies` (start of its candidate list). */
    catMixBase: Uint8Array;
    /** category id → number of mix candidates (0 when pure). */
    catMixCount: Uint8Array;
    /** Flattened equal-weight candidate species ids for all mix categories. */
    mixSpecies: Uint8Array;
}

/**
 * Build the static category→species/group lookup tables consumed by the
 * shader. Sized to 256 categories (Uint8 index space); only the first
 * FOREST_CATEGORY_COUNT entries are meaningful, the rest stay `FOREST_NONE`.
 */
export function buildForestGpuTables(): ForestGpuTables {
    const catGroup = new Uint8Array(256).fill(FOREST_NONE);
    const catSpecies = new Uint8Array(256).fill(FOREST_NONE);
    const catMixBase = new Uint8Array(256);
    const catMixCount = new Uint8Array(256);
    const mix: number[] = [];
    for (let c = 0; c < FOREST_CATEGORY_COUNT; c++) {
        const cat = FOREST_CATEGORIES[c];
        catGroup[c] = cat.group;
        if (cat.species >= 0) {
            catSpecies[c] = cat.species;
        } else {
            catMixBase[c] = mix.length;
            catMixCount[c] = cat.candidates.length;
            for (const s of cat.candidates) mix.push(s);
        }
    }
    return {
        catGroup,
        catSpecies,
        catMixBase,
        catMixCount,
        mixSpecies: Uint8Array.from(mix),
    };
}

/**
 * Build the active legend palette as normalized RGB (0–1), indexed by legend
 * id. Length = group count in group mode, species count in species mode.
 */
export function buildForestPalette(grouping: ForestGrouping): Float32Array {
    const entries = forestLegendEntries(grouping);
    const palette = new Float32Array(entries.length * 3);
    for (let i = 0; i < entries.length; i++) {
        palette[i * 3] = entries[i].color[0] / 255;
        palette[i * 3 + 1] = entries[i].color[1] / 255;
        palette[i * 3 + 2] = entries[i].color[2] / 255;
    }
    return palette;
}
