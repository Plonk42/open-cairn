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
    const eye = map.transform.getCameraLngLat();
    const altitudeM = map.transform.getCameraAltitude();
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
 * Where a direction at infinity lands on screen, in CSS pixels.
 *
 * Same pinhole as MapLibre's own camera: the focal length in pixels is
 * `0.5·height/tan(fovY/2)`, which is exactly its `cameraToCenterDistance`.
 * Returns null when the direction is behind the camera.
 */
export function projectDirection(
    map: MapLibreMap,
    dir: readonly number[],
): { x: number; y: number } | null {
    const bearing = map.getBearing() * DEG;
    const pitch = map.getPitch() * DEG;
    const sinB = Math.sin(bearing);
    const cosB = Math.cos(bearing);
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    // ENU basis of the camera: pitch 0 looks straight down, 90 at the horizon.
    const forward = [sinB * sinP, cosB * sinP, -cosP];
    const up = [sinB * cosP, cosB * cosP, sinP];
    const right = [cosB, -sinB, 0];
    const dot = (v: number[]) => dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2];

    const depth = dot(forward);
    if (depth <= 1e-4) return null;
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const focal = (0.5 * height) / Math.tan((map.getVerticalFieldOfView() * DEG) / 2);
    return {
        x: width / 2 + (focal * dot(right)) / depth,
        y: height / 2 - (focal * dot(up)) / depth,
    };
}
