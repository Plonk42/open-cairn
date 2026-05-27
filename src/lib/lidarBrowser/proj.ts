/**
 * proj4 setup for the browser-side LiDAR pipeline.
 *
 * Registers EPSG:2154 (RGF93 / Lambert-93), the projection IGN uses for all
 * LiDAR HD COPC tiles. We export a singleton `to2154` / `to4326` so callers
 * don't re-parse the projection string on every reprojection.
 */
import proj4 from 'proj4';

// Lambert-93 definition (same string used by EPSG.io & PROJ).
const EPSG_2154 =
    '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

proj4.defs('EPSG:2154', EPSG_2154);

const to2154 = proj4('EPSG:4326', 'EPSG:2154');
const to4326 = proj4('EPSG:2154', 'EPSG:4326');

/** WGS84 (lng, lat) → Lambert-93 (x, y) meters. */
export function lngLatToL93(lng: number, lat: number): [number, number] {
    return to2154.forward([lng, lat]) as [number, number];
}

/** Lambert-93 (x, y) meters → WGS84 (lng, lat). */
export function l93ToLngLat(x: number, y: number): [number, number] {
    return to4326.forward([x, y]) as [number, number];
}
