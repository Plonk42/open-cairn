/**
 * Fetches an IGN orthophoto mosaic covering a LiDAR cloud's footprint, to be
 * draped over the reconstructed ground mesh (Poisson / Delaunay modes).
 *
 * The orthophoto is a nadir (top-down) image, so the UV mapping onto the mesh
 * is a trivial planar projection from the vertex east/north position — no
 * server-baked UVs needed (unlike Relief Maps' pre-textured 3D Tiles).
 *
 * We assemble standard WMTS XYZ tiles (`ORTHOIMAGERY.ORTHOPHOTOS`, EPSG:3857 /
 * "PM" matrix set) into a single canvas, and return that canvas together with
 * the exact lng/lat extent the mosaic covers (tile-aligned), which the WebGL
 * layer converts to its meter-offset frame for the planar UV mapping.
 */

import { ignLayerUrl } from '@/lib/ign';

export interface OrthoMosaic {
    /** Canvas holding the stitched orthophoto, ready for `texImage2D`. */
    image: HTMLCanvasElement;
    /** Exact geographic extent covered by the mosaic (tile-aligned). */
    lngLatRect: { west: number; south: number; east: number; north: number };
}

const TILE_SIZE = 256;
/** Cap the mosaic so we never stitch an unreasonable number of tiles. */
const MAX_TILES_PER_SIDE = 6;
const MIN_ZOOM = 12;
const MAX_ZOOM = 19;

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

function loadTileImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const onAbort = () => { img.src = ''; resolve(null); };
        signal?.addEventListener('abort', onAbort, { once: true });
        img.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(img); };
        img.onerror = () => { signal?.removeEventListener('abort', onAbort); resolve(null); };
        img.src = url;
    });
}

/**
 * Build an orthophoto mosaic centered on (lng, lat) covering ±radius meters.
 *
 * Picks the highest zoom whose tile span stays within `MAX_TILES_PER_SIDE`, so
 * the resolution is as fine as possible without stitching too many tiles.
 * Returns null if no tile could be loaded (e.g. area outside IGN coverage).
 */
export async function fetchOrthoMosaic(
    lng: number,
    lat: number,
    radiusMeters: number,
    signal?: AbortSignal,
): Promise<OrthoMosaic | null> {
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
    for (let cand = MAX_ZOOM; cand >= MIN_ZOOM; cand--) {
        const nw = lngLatToTile(west, north, cand);
        const se = lngLatToTile(east, south, cand);
        const tx = se.x - nw.x + 1;
        const ty = se.y - nw.y + 1;
        if (tx <= MAX_TILES_PER_SIDE && ty <= MAX_TILES_PER_SIDE) { z = cand; break; }
    }

    const nw = lngLatToTile(west, north, z);
    const se = lngLatToTile(east, south, z);
    const x0 = nw.x;
    const y0 = nw.y;
    const x1 = se.x;
    const y1 = se.y;
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;

    const canvas = document.createElement('canvas');
    canvas.width = cols * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const template = ignLayerUrl('ortho');
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
