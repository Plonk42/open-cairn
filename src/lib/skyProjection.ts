/**
 * The bits of camera maths every sky overlay needs: where the eye is, how a
 * direction lands on screen, and how the DEM is read for a ray march.
 *
 * Shared rather than duplicated because the three have to agree. A label placed
 * with a different pinhole than the tracks would drift off them as soon as the
 * lens changed, and a summit sighted from a different eye than the skyline it is
 * tested against would be declared visible through a mountain.
 */

import { LngLat, type Map as MapLibreMap } from 'maplibre-gl';
import type { GroundSampler, SkylineObserver } from './skyline';

/** `Terrain` is not exported by maplibre-gl, only reachable through the map. */
type MapTerrain = NonNullable<MapLibreMap['terrain']>;

const DEG = Math.PI / 180;

/**
 * Zoom the DEM is sampled at. Measured against the renderer's own
 * `queryTerrainElevation` over eight azimuths around Chamonix: z11 misses a
 * near ridge by up to 0.51° — two solar diameters — while z13 stays within
 * 0.07° everywhere for 0.76 ms a ray instead of 0.57 ms. Going finer buys
 * nothing and risks reading tiles the terrain cache never loaded for the far
 * field, which would come back as sea level.
 */
export const SKYLINE_DEM_ZOOM = 13;

/** The camera eye — the eye every hidden/visible split is computed from. */
export function cameraObserver(map: MapLibreMap): SkylineObserver | null {
    const eye = map.painter.transform.getCameraLngLat();
    const altitudeM = map.painter.transform.getCameraAltitude();
    if (!eye || !Number.isFinite(altitudeM)) return null;
    return { lng: eye.lng, lat: eye.lat, altitudeM };
}

/**
 * Rounded eye position, as a cache key. A ray is some 400 DEM lookups and
 * depends on nothing but the eye, so a pure rotation or a zoom that leaves the
 * eye in place must not pay for a new scan.
 */
export function observerKey(observer: SkylineObserver): string {
    return [
        observer.lng.toFixed(4), observer.lat.toFixed(4), observer.altitudeM.toFixed(0),
    ].join('|');
}

/**
 * Ground sampler backed by the terrain cache. `getElevationForLngLatZoom` costs
 * ~2 µs; `Map.queryTerrainElevation` returns the same numbers for ~141 µs and
 * would make a march unusable.
 */
export function demSampler(terrain: MapTerrain): GroundSampler {
    return (lng, lat) => terrain.getElevationForLngLatZoom(new LngLat(lng, lat), SKYLINE_DEM_ZOOM);
}

/**
 * Where a direction at infinity lands on screen, in CSS pixels, or null when it
 * points behind the camera.
 *
 * Read off MapLibre's own view-projection matrix — the vanishing point of the
 * direction, `w = 0` — rather than re-deriving a pinhole: padding, roll, lens
 * and canvas size then come from the one place the renderer takes them from.
 * The matrix scales altitude by `pixelsPerMeter`, so a metre east, north or up
 * weighs the same once the horizontal part is scaled by it too.
 */
export function projectDirection(
    map: MapLibreMap,
    dir: readonly number[],
): { x: number; y: number } | null {
    const transform = map.painter.transform;
    const m = pixelMatrix(transform);
    const ppm = transform.pixelsPerMeter;
    const dx = dir[0] * ppm;
    const dy = -dir[1] * ppm;
    const dz = dir[2];
    const w = m[3] * dx + m[7] * dy + m[11] * dz;
    if (w <= 0) return null;
    return {
        x: (m[0] * dx + m[4] * dy + m[8] * dz) / w,
        y: (m[1] * dx + m[5] * dy + m[9] * dz) / w,
    };
}

export type ScreenProjector = (lng: number, lat: number, altitudeM: number) => { x: number; y: number } | null;

/**
 * Projects ground points exactly as the renderer does, for the frame it is
 * built in — build one per frame, it snapshots the camera.
 */
export function screenProjector(map: MapLibreMap): ScreenProjector {
    const transform = map.painter.transform;
    const m = pixelMatrix(transform);
    const world = transform.worldSize;
    return (lng, lat, altitudeM) => {
        const x = mercatorX(lng) * world;
        const y = mercatorY(lat) * world;
        const w = m[3] * x + m[7] * y + m[11] * altitudeM + m[15];
        if (w <= 0) return null;
        return {
            x: (m[0] * x + m[4] * y + m[8] * altitudeM + m[12]) / w,
            y: (m[1] * x + m[5] * y + m[9] * altitudeM + m[13]) / w,
        };
    };
}

type Transform = MapLibreMap['painter']['transform'];

/** World (mercator pixels, altitude in metres) to screen pixels: MapLibre's `_pixelMatrix3D`. */
function pixelMatrix(transform: Transform): Float64Array {
    const a = transform.clipSpaceToPixelsMatrix;
    const b = transform.modelViewProjectionMatrix;
    const out = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1]
                + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
        }
    }
    return out;
}

function mercatorX(lngDeg: number): number {
    return (lngDeg + 180) / 360;
}

/** Mercator northing, 0 at the top of the world, 1 at the bottom. */
function mercatorY(latDeg: number): number {
    return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2))) / 360;
}

/** Tile extent MapLibre's elevation samplers are addressed in. */
const EXTENT = 8192;
const MAX_TILE_COORD = EXTENT * (1 - 1e-12);

/**
 * Ground height of the surface MapLibre is DRAWING, NaN wherever no rendered
 * tile covers the spot (or its DEM has not arrived).
 *
 * `demSampler` asks for a zoom and gets whatever the tile cache holds: when the
 * z13 tile is not loaded, MapLibre falls back to any loaded ancestor. Measured
 * looking through an 8° lens, 864 of 900 summits read from a z5 tile, 396 m low
 * at the median and 949 m at worst — so a label computed then pointed far below
 * its summit, and stayed there. Refusing what is not rendered makes the answer
 * the picture's own, whatever the cache happens to hold.
 *
 * Mirrors MapLibre's `sampleAt` over the public `getCoverageIndex()`.
 */
export function renderedGroundSampler(terrain: MapTerrain): GroundSampler {
    const index = terrain.getCoverageIndex();
    if (!index) return () => Number.NaN;
    const { exaggeration } = terrain;
    return (lng, lat) => {
        const my = mercatorY(lat);
        if (my < 0 || my >= 1) return Number.NaN;
        const mx = mercatorX(lng);
        const wrap = Math.floor(mx);
        const x = mx - wrap;
        for (const z of index.zooms) {
            const scale = 2 ** z;
            const tx = Math.floor(x * scale);
            const ty = Math.floor(my * scale);
            const sampler = index.samplerPerTile.get(`${wrap}/${z}/${tx}/${ty}`);
            if (sampler === undefined) continue;
            if (!sampler) return Number.NaN;
            const px = Math.min((x * scale - tx) * EXTENT, MAX_TILE_COORD);
            const py = Math.min((my * scale - ty) * EXTENT, MAX_TILE_COORD);
            return sampler(px, py, EXTENT) * exaggeration;
        }
        return Number.NaN;
    };
}
