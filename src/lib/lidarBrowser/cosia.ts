/**
 * IGN CoSIA (Couverture du Sol par Intelligence Artificielle) land-cover typing
 * for LiDAR captures.
 *
 * The LiDAR palette paints the ground from slope and elevation alone, so a
 * conifer stand on a 40° slope comes out as rock and a pasture at 2400 m as
 * scree. CoSIA replaces that single guess — and *only* that one — by a
 * measurement: for every mesh vertex we bake the class of the ground below it,
 * reduced to the three states the palette can actually act on (see
 * {@link CoverClass}).
 *
 * Deliberately NOT used for two things CoSIA cannot say, both measured:
 *   • cliffs — the source is a nadir orthophoto, a vertical wall occupies
 *     almost no pixel (a tile over the Presles walls reads 54 % broadleaf) and
 *     there is no rock class at all ("Sol nu" lumps sand, scree, lapiaz and
 *     quarries together). Slope stays the cliff detector.
 *   • season — the "Neige" class is the snow of the survey flight, not a
 *     climatology: the Mer de Glace reads 80 % "Sol nu" and the Argentière
 *     glacier 99 %. The « Ligne de neige » slider stays in charge.
 *
 * The WMTS renders each class as one flat RGB colour, so the class is recovered
 * by an EXACT colour lookup, not a nearest-colour match: an unknown colour (a
 * class we never witnessed, or an antialiased pixel on a class boundary) yields
 * {@link COVER_NONE} and the palette falls back to its own guess, which is the
 * honest answer for an ambiguous pixel.
 */

import { IGN_LAYERS, ignLayerUrl } from '@/lib/ign';
import { fetchTileMosaic } from './orthoTexture';

/**
 * What the palette does with a vertex. CoSIA's 15 classes collapse to these:
 * the palette can only arbitrate between mineral ground, low vegetation and
 * woody cover — anything finer would have no pictorial consequence.
 */
export const COVER_BARE = 0;
export const COVER_GRASS = 1;
export const COVER_WOOD = 2;
/** Outside the mosaic, water, built-up, or an unrecognised colour. */
export const COVER_NONE = 255;

export type CoverClass = typeof COVER_BARE | typeof COVER_GRASS | typeof COVER_WOOD | typeof COVER_NONE;

interface CosiaClass {
    /** Colour the WMTS paints this class with, RGB 0–255. */
    rgb: readonly [number, number, number];
    label: string;
    cover: CoverClass;
}

/**
 * CoSIA render colours. Derived empirically — `GetLegendGraphic` on
 * `data.geopf.fr/wms-r` answers `OperationNotSupported` — by histogramming
 * `IGNF_COSIA_2021-2023` tiles over sites whose ground truth is known; the
 * witness site of each entry is given below. Every colour listed here was the
 * dominant one of at least one such tile.
 *
 * Missing on purpose: "Piscine", "Coupe" and "Autre", never observed as a
 * dominant colour anywhere we probed. They fall to COVER_NONE, which is what
 * they would have been mapped to anyway.
 */
export const COSIA_CLASSES: readonly CosiaClass[] = [
    { rgb: [187, 176, 150], label: 'Sol nu', cover: COVER_BARE },          // Dune du Pilat 64 %
    { rgb: [233, 239, 254], label: 'Neige', cover: COVER_BARE },           // sommet du Mont Blanc 84 %
    { rgb: [140, 215, 106], label: 'Pelouse', cover: COVER_GRASS },        // La Meije 45 %
    { rgb: [222, 207, 85], label: 'Culture', cover: COVER_GRASS },         // Beauce 47 %
    { rgb: [208, 163, 73], label: 'Terre labourée', cover: COVER_GRASS },  // plaine de Bièvre 17 %
    { rgb: [176, 130, 144], label: 'Vigne', cover: COVER_GRASS },          // Tain-l'Hermitage 8 %
    { rgb: [76, 145, 41], label: 'Feuillu', cover: COVER_WOOD },           // forêt de Lente 57 %
    { rgb: [18, 100, 33], label: 'Conifère', cover: COVER_WOOD },          // Landes de Gascogne 54 %
    { rgb: [181, 195, 53], label: 'Broussaille', cover: COVER_WOOD },      // garrigue des Calanques 70 %
    { rgb: [51, 117, 161], label: 'Surface d’eau', cover: COVER_NONE },    // lac du Bourget 75 %
    { rgb: [206, 112, 121], label: 'Bâtiment', cover: COVER_NONE },        // Grenoble centre 43 %
    { rgb: [166, 170, 183], label: 'Zone imperméable', cover: COVER_NONE },// Grenoble centre 33 %
    { rgb: [152, 119, 82], label: 'Zone perméable', cover: COVER_NONE },   // aéroport de Lyon 18 %
];

const COVER_BY_RGB = new Map<number, CoverClass>(
    COSIA_CLASSES.map((c) => [(c.rgb[0] << 16) | (c.rgb[1] << 8) | c.rgb[2], c.cover]),
);

/** Exact colour → cover class. Any unlisted colour, or a non-opaque pixel
 *  (uncovered area, class boundary), is COVER_NONE. */
export function coverFromRgb(r: number, g: number, b: number, a: number): CoverClass {
    if (a < 255) return COVER_NONE;
    return COVER_BY_RGB.get((r << 16) | (g << 8) | b) ?? COVER_NONE;
}

/**
 * Cover classes of a capture's footprint, on a Web-Mercator-aligned grid — the
 * frame the tiles come in, so the lookup stays a plain affine map with no
 * reprojection per vertex.
 */
export interface CoverGrid {
    cols: number;
    rows: number;
    /** Mercator extent in [0,1], tile-aligned (north < south, Y grows south). */
    west: number;
    north: number;
    east: number;
    south: number;
    /** One cover id per cell, row-major from the north-west corner. */
    data: Uint8Array;
}

/**
 * Pixel cap of the cover mosaic. Much smaller than the drape's 4096: a cover
 * class has no use for the native 20 cm of CoSIA, and this is read back through
 * `getImageData` (4 bytes per pixel, on the main thread). 2048 gives ~0.8 m per
 * cell on a 500 m capture and ~7 m on the largest allowed one.
 */
const MAX_COVER_PX = 2048;

/** Metres per Mercator unit at the equator (WGS84 equatorial circumference). */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

function mercatorX(lng: number): number {
    return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
    return (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
}

/**
 * Fetch the CoSIA mosaic covering the capture and turn it into a cover grid.
 * Returns null when no tile could be loaded (outside coverage, network error),
 * in which case the palette keeps guessing — a capture is never blocked by it.
 */
export async function fetchCoverGrid(opts: {
    lng: number;
    lat: number;
    radiusMeters: number;
    signal?: AbortSignal;
}): Promise<CoverGrid | null> {
    const mosaic = await fetchTileMosaic({
        template: ignLayerUrl('cosia'),
        maxZoom: IGN_LAYERS.cosia.maxZoom,
        lng: opts.lng,
        lat: opts.lat,
        radiusMeters: opts.radiusMeters,
        maxPx: MAX_COVER_PX,
        signal: opts.signal,
    });
    if (!mosaic) return null;
    const { width, height } = mosaic.image;
    // Returns the context the mosaic was drawn with, already created with
    // `willReadFrequently` (the options of a second `getContext` are ignored).
    const ctx = mosaic.image.getContext('2d');
    if (!ctx) return null;
    const px = ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
        const o = i * 4;
        data[i] = coverFromRgb(px[o], px[o + 1], px[o + 2], px[o + 3]);
    }
    const { west, north, east, south } = mosaic.lngLatRect;
    return {
        cols: width,
        rows: height,
        west: mercatorX(west),
        east: mercatorX(east),
        north: mercatorY(north),
        south: mercatorY(south),
        data,
    };
}

/** Cover class at a Mercator position, COVER_NONE outside the grid. */
export function coverAtMercator(grid: CoverGrid, x: number, y: number): CoverClass {
    const col = Math.floor(((x - grid.west) / (grid.east - grid.west)) * grid.cols);
    const row = Math.floor(((y - grid.north) / (grid.south - grid.north)) * grid.rows);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return COVER_NONE;
    return grid.data[row * grid.cols + col] as CoverClass;
}

/**
 * Label every vertex/point with the cover class of the ground below it.
 *
 * `positions` are east/north/up metre offsets from (centerLng, centerLat) — the
 * same frame the renderer maps onto the draped mosaic, hence the same Mercator
 * conversion: the metre is a Mercator metre at the capture's latitude, so a
 * plain scale factor takes a position back to a tile coordinate.
 */
export function labelCover(
    positions: Float32Array,
    count: number,
    centerLng: number,
    centerLat: number,
    grid: CoverGrid,
): Uint8Array {
    const out = new Uint8Array(count);
    const perMetre = 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((centerLat * Math.PI) / 180));
    const x0 = mercatorX(centerLng);
    const y0 = mercatorY(centerLat);
    for (let i = 0; i < count; i++) {
        const x = x0 + positions[i * 3] * perMetre;
        const y = y0 - positions[i * 3 + 1] * perMetre;
        out[i] = coverAtMercator(grid, x, y);
    }
    return out;
}
