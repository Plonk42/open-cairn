/**
 * Fetches a basemap mosaic covering a LiDAR cloud's footprint, to be draped
 * over the reconstructed ground mesh (Poisson / Delaunay modes) and over the
 * points themselves.
 *
 * Any of the app's flat basemaps can be draped — orthophoto, SCAN 25, Plan IGN
 * or OpenStreetMap (see {@link DrapeSource}) — since they are all nadir
 * (top-down) rasters: the UV mapping onto the mesh is a trivial planar
 * projection from the vertex east/north position, no server-baked UVs needed
 * (unlike Relief Maps' pre-textured 3D Tiles).
 *
 * We assemble standard WMTS/XYZ tiles (EPSG:3857 / IGN "PM" matrix set) into a
 * single canvas, and return that canvas together with the exact lng/lat extent
 * the mosaic covers (tile-aligned), which the WebGL layer converts to its
 * meter-offset frame for the planar UV mapping.
 *
 * Everything here goes through `OffscreenCanvas` and `createImageBitmap` rather
 * than `document.createElement('canvas')` and `new Image()`, because the same
 * code also runs inside the LiDAR worker (CoSIA cover baking), where there is
 * no `document`. `OffscreenCanvas` is a valid `TexImageSource`, so the drape
 * upload path is unchanged.
 */

import { BASE_LAYERS, type DrapeSource } from '@/lib/baseLayers';
import { IGN_LAYERS, ignLayerUrl, OSM_TILE_URL } from '@/lib/ign';
import { withTimeout } from './deadline';

export interface DrapeMosaic {
    /** Canvas holding the stitched basemap, ready for `texImage2D`. */
    image: OffscreenCanvas;
    /** Exact geographic extent covered by the mosaic (tile-aligned). */
    lngLatRect: { west: number; south: number; east: number; north: number };
}

const TILE_SIZE = 256;
/** Cap the mosaic on its PIXEL side, not on a tile count: the canvas becomes a
 *  single GPU texture, and 4096 is the smallest `MAX_TEXTURE_SIZE` we can count
 *  on. A tile cap gave every capture the same ~1500 px whatever its footprint,
 *  so the ground resolution collapsed as the zone grew (2.6 m/px on 3 km
 *  against 0.5 m/px on 300 m). */
const MAX_MOSAIC_PX = 4096;
const MIN_ZOOM = 12;
const MAX_ZOOM = 19;
// Past this a tile is left blank rather than holding the whole mosaic back.
const TILE_TIMEOUT_MS = 30_000;

/**
 * XYZ template + finest usable zoom for a drapable basemap. Each layer stops at
 * its own max zoom (SCAN 25 at z16, orthophotos at z19…), so we never request
 * tiles that don't exist; the private layers additionally need the user's IGN `apikey`.
 */
function drapeTileTemplate(source: DrapeSource, ignApiKey?: string): { template: string; maxZoom: number } {
    const key = BASE_LAYERS[source].source;
    if (key === 'osm') return { template: OSM_TILE_URL, maxZoom: MAX_ZOOM };
    const def = IGN_LAYERS[key];
    return {
        template: ignLayerUrl(key, def.private ? ignApiKey : undefined),
        maxZoom: Math.min(MAX_ZOOM, def.maxZoom),
    };
}

function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
    const n = 2 ** z;
    const x = Math.floor(((lng + 180) / 360) * n);
    const latR = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.asinh(Math.tan(latR)) / Math.PI) / 2) * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** North-west corner (lng/lat) of tile (x, y) at zoom z. */
function tileToLngLat(x: number, y: number, z: number): { lng: number; lat: number } {
    const n = 2 ** z;
    const lng = (x / n) * 360 - 180;
    const latR = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    return { lng, lat: (latR * 180) / Math.PI };
}

/** Fetch one tile as an `ImageBitmap`. Resolves null on abort, http error or
 *  decode failure: a missing tile just leaves a blank patch in the mosaic. */
async function loadTileImage(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
    try {
        const res = await fetch(url, { signal: withTimeout(signal, TILE_TIMEOUT_MS), mode: 'cors', credentials: 'omit' });
        if (!res.ok) return null;
        return await createImageBitmap(await res.blob());
    } catch {
        return null;
    }
}

/**
 * Quantize a *detail* mosaic request so that a small camera move does not
 * re-download it: the radius is rounded up to the next power of two and the
 * centre snaps to a grid of a quarter of that radius. Two camera positions that
 * quantize to the same triple share the same mosaic, and the caller can skip
 * the fetch altogether.
 *
 * The returned radius is inflated by 25 % to absorb the (up to an eighth of the
 * radius) shift the centre snapping introduces — otherwise the requested disc
 * would poke out of the mosaic on one side, and the drape would show a
 * sharpness seam right in the middle of the screen.
 */
export function snapDetailView(lng: number, lat: number, radiusMeters: number): {
    lng: number;
    lat: number;
    radiusMeters: number;
} {
    const r = 2 ** Math.ceil(Math.log2(Math.max(1, radiusMeters)));
    const stepLat = r / 4 / 111_320;
    // cos(lat) is floored: near the poles the longitude step would blow up.
    const stepLng = stepLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    return {
        lng: Math.round(lng / stepLng) * stepLng,
        lat: Math.round(lat / stepLat) * stepLat,
        radiusMeters: r * 1.25,
    };
}

/**
 * Build a basemap mosaic centered on (lng, lat) covering ±radius meters.
 *
 * Picks the highest zoom whose tile span still fits in `maxPx`, so the ground
 * resolution is as fine as the pixel budget allows at any footprint. Returns
 * null if no tile could be loaded (e.g. area outside IGN coverage, or SCAN 25
 * requested without an API key).
 */
export async function fetchTileMosaic(opts: {
    /** XYZ template with `{z}/{x}/{y}` placeholders. */
    template: string;
    maxZoom: number;
    lng: number;
    lat: number;
    radiusMeters: number;
    /** Pixel cap on the mosaic's longest side. */
    maxPx?: number;
    signal?: AbortSignal;
}): Promise<DrapeMosaic | null> {
    const { template, maxZoom, lng, lat, radiusMeters, signal } = opts;
    const maxTilesPerSide = (opts.maxPx ?? MAX_MOSAIC_PX) / TILE_SIZE;
    // Expand a little so the mesh (which can spill slightly past the request
    // radius) is fully covered; UVs outside [0,1] are ignored by the shader.
    const r = radiusMeters * 1.1;
    const dLat = r / 111_320;
    const dLng = r / (111_320 * Math.cos((lat * Math.PI) / 180));
    const west = lng - dLng;
    const east = lng + dLng;
    const south = lat - dLat;
    const north = lat + dLat;

    // Choose the finest zoom that keeps the tile span bounded.
    let z = MIN_ZOOM;
    for (let cand = maxZoom; cand >= MIN_ZOOM; cand--) {
        const nw = lngLatToTile(west, north, cand);
        const se = lngLatToTile(east, south, cand);
        const tx = se.x - nw.x + 1;
        const ty = se.y - nw.y + 1;
        if (tx <= maxTilesPerSide && ty <= maxTilesPerSide) { z = cand; break; }
    }

    const nw = lngLatToTile(west, north, z);
    const se = lngLatToTile(east, south, z);
    const x0 = nw.x;
    const y0 = nw.y;
    const x1 = se.x;
    const y1 = se.y;
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;

    const canvas = new OffscreenCanvas(cols * TILE_SIZE, rows * TILE_SIZE);
    // `willReadFrequently` for the CoSIA path, which reads the whole mosaic
    // back with `getImageData`; the drape path only uploads it as a texture and
    // does not care either way.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const jobs: Promise<boolean>[] = [];
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            const url = template
                .replace('{z}', String(z))
                .replace('{x}', String(tx))
                .replace('{y}', String(ty));
            const dx = (tx - x0) * TILE_SIZE;
            const dy = (ty - y0) * TILE_SIZE;
            jobs.push(
                loadTileImage(url, signal).then((img) => {
                    if (!img) return false;
                    ctx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
                    return true;
                }),
            );
        }
    }

    const results = await Promise.all(jobs);
    if (signal?.aborted || !results.some(Boolean)) return null;

    const nwCorner = tileToLngLat(x0, y0, z);
    const seCorner = tileToLngLat(x1 + 1, y1 + 1, z);
    return {
        image: canvas,
        lngLatRect: {
            west: nwCorner.lng,
            north: nwCorner.lat,
            east: seCorner.lng,
            south: seCorner.lat,
        },
    };
}

/** {@link fetchTileMosaic} for one of the app's drapable basemaps. */
export async function fetchDrapeMosaic(opts: {
    source: DrapeSource;
    lng: number;
    lat: number;
    radiusMeters: number;
    /** IGN key for the private layers; ignored by the public ones. */
    ignApiKey?: string;
    signal?: AbortSignal;
}): Promise<DrapeMosaic | null> {
    const { template, maxZoom } = drapeTileTemplate(opts.source, opts.ignApiKey);
    return fetchTileMosaic({
        template,
        maxZoom,
        lng: opts.lng,
        lat: opts.lat,
        radiusMeters: opts.radiusMeters,
        signal: opts.signal,
    });
}
