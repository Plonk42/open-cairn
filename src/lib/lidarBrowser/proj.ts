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

/**
 * Unit Lambert-93 direction of the capture rectangle's *length* axis, given the
 * ground azimuth (deg from north, clockwise) at (lng, lat). A short WGS84 step
 * along the azimuth is reprojected to L93 and normalised, so the result picks up
 * the grid's meridian convergence — the L93 axes are not aligned with true north
 * away from the 3°E central meridian. The width axis is the left-perpendicular
 * `(-uy, ux)`.
 */
export function l93RectAxes(
    lng: number, lat: number, azimuthDeg: number,
): { ux: number; uy: number } {
    const rad = (azimuthDeg * Math.PI) / 180;
    const stepN = (Math.cos(rad) * 10) / 111_320;
    const stepE = (Math.sin(rad) * 10) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const [ax, ay] = lngLatToL93(lng, lat);
    const [bx, by] = lngLatToL93(lng + stepE, lat + stepN);
    const ux = bx - ax;
    const uy = by - ay;
    const len = Math.hypot(ux, uy) || 1;
    return { ux: ux / len, uy: uy / len };
}

/**
 * Rotate a single Lambert-93 axis direction `(ux, uy)` into the true geographic
 * east/north frame at (lng, lat) — the exact rotation
 * {@link l93OffsetsToGeographicEnu} applies to point positions. Use it to keep
 * derived L93 axes (e.g. the Poisson base capture rectangle from
 * {@link l93RectAxes}) aligned with the rotated point cloud: because every point
 * is turned by the same centre convergence γ, the capture rectangle — a rigid
 * feature of the cloud — must be turned by that same γ, not an independently
 * computed geographic azimuth (which differs by a small finite-difference
 * residual and would leave the walls a few decimetres off the terrain).
 */
export function l93AxisToGeographicEnu(
    ux: number, uy: number, lng: number, lat: number,
): { ux: number; uy: number } {
    const { nx, ny } = geographicNorthInL93(lng, lat);
    // Same mapping as l93OffsetsToGeographicEnu: east = (ny, -nx), north = (nx, ny).
    return { ux: ux * ny - uy * nx, uy: ux * nx + uy * ny };
}

/** Unit Lambert-93 direction of geographic north at (lng, lat). */
function geographicNorthInL93(lng: number, lat: number): { nx: number; ny: number } {
    const stepN = 10 / 111_320;
    const [ax, ay] = lngLatToL93(lng, lat);
    const [bx, by] = lngLatToL93(lng, lat + stepN);
    const nx = bx - ax;
    const ny = by - ay;
    const len = Math.hypot(nx, ny) || 1;
    return { nx: nx / len, ny: ny / len };
}

/**
 * Rotate interleaved Lambert-93 grid offsets `(dx, dy, z)` into a true
 * geographic east/north/up frame at (lng, lat), in place.
 *
 * IGN LiDAR positions are decoded as grid offsets from the capture centre
 * (`dx = X_l93 − x0`, `dy = Y_l93 − y0`), but the renderer and every downstream
 * consumer (shader, shadow light matrix, BD Forêt® rasteriser, cliff slice…)
 * treat them as geographic east/north. Those frames differ by the L93 meridian
 * convergence γ — zero on the 3°E central meridian, ≈2° in the Alps — so each
 * cloud is effectively rotated γ about its own centre. A single capture merely
 * looks slightly turned against the basemap, but two overlapping captures with
 * different centres drift apart by ≈ γ·(centre separation) in their shared area
 * (a few metres), which is the visible seam between adjacent clouds.
 *
 * γ varies negligibly across a ~500 m capture, so one rotation about the centre
 * aligns the whole cloud (residual < 1 cm). Heights (`z`) are untouched.
 */
export function l93OffsetsToGeographicEnu(
    positions: Float32Array, pointCount: number, lng: number, lat: number,
): void {
    const { nx, ny } = geographicNorthInL93(lng, lat);
    // (nx, ny) is geographic north in L93; east is that turned 90° clockwise,
    // i.e. (ny, -nx). Projecting each offset onto the two axes maps L93 → ENU.
    for (let i = 0; i < pointCount; i++) {
        const dx = positions[i * 3];
        const dy = positions[i * 3 + 1];
        positions[i * 3] = dx * ny - dy * nx;      // east
        positions[i * 3 + 1] = dx * nx + dy * ny;  // north
    }
}
