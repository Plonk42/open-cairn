/**
 * Geometry helpers for the oriented (camera-fixed) LiDAR capture rectangle.
 *
 * The capture rectangle is stored as plain width × length metres with no angle:
 * its orientation is always the *live* camera bearing, so the on-screen box
 * stays put while rotating the map spins the ground footprint. These helpers
 * turn that "screen-aligned, sized in metres" intent into ground geometry —
 * both for drawing the preview polygon and for measuring a drag.
 */
import type maplibregl from 'maplibre-gl';

/** Hard cap on the capture rectangle's ground area (m²). A 2000 × 2000 m zone
 *  (= 400 ha) is the largest allowed; Poisson mode uses a tighter cap (see
 *  POISSON_MAX_AREA_M2). The fetch still derives its radius from the enclosing
 *  circle so tile/node selection brackets the whole (possibly rotated) footprint. */
export const LIDAR_RECT_MAX_AREA_M2 = 4_000_000;
/** Smallest side (m) a capture rectangle is allowed to have. */
export const LIDAR_RECT_MIN_SIDE_M = 20;

/** Metres per degree of latitude (WGS84 mean) — good enough at France scales. */
const M_PER_DEG_LAT = 111_320;

/** Persisted rectangle dimensions (orientation is the live bearing). */
export interface CaptureRectDims {
    widthM: number;
    lengthM: number;
}

/** Enclosing-circle radius (m) of the rectangle — half its diagonal. */
export function rectEnclosingRadiusM(widthM: number, lengthM: number): number {
    return Math.hypot(widthM / 2, lengthM / 2);
}

/** Rectangle area in hectares. */
export function rectAreaHa(widthM: number, lengthM: number): number {
    return (widthM * lengthM) / 10_000;
}

/**
 * Closed ring (lng/lat) of a rectangle centred at (lng,lat), with its `length`
 * axis pointing along `azimuthDeg` (compass degrees from north, clockwise) and
 * its `width` axis perpendicular (to the right). Uses a local equirectangular
 * approximation — exact enough at LiDAR-capture scales.
 */
export function rectCornersLngLat(
    lng: number, lat: number, azimuthDeg: number, widthM: number, lengthM: number,
): GeoJSON.Position[] {
    const rad = (azimuthDeg * Math.PI) / 180;
    // Local east/north unit vectors of the two rectangle axes.
    const upE = Math.sin(rad), upN = Math.cos(rad);        // length axis (azimuth)
    const rightE = Math.cos(rad), rightN = -Math.sin(rad); // width axis (azimuth + 90° CW)
    const hw = widthM / 2, hl = lengthM / 2;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const toLngLat = (e: number, n: number): GeoJSON.Position => [
        lng + e / mPerDegLng,
        lat + n / M_PER_DEG_LAT,
    ];
    const corner = (sw: number, sl: number): GeoJSON.Position => toLngLat(
        sw * hw * rightE + sl * hl * upE,
        sw * hw * rightN + sl * hl * upN,
    );
    return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
}

/** A single GeoJSON polygon FeatureCollection for the rectangle preview. */
export function rectPreviewGeoJson(
    lng: number, lat: number, azimuthDeg: number, widthM: number, lengthM: number,
): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [rectCornersLngLat(lng, lat, azimuthDeg, widthM, lengthM)],
            },
        }],
    };
}

/**
 * Pixel coordinates of the visible-area centre, accounting for the map's
 * `padding`. Padding is `0` on all sides by default (desktop), so this is the
 * plain canvas centre there; the mobile Studio sets a bottom padding while the
 * capture sheet is open so the footprint + load stay in the uncovered map area.
 */
function screenCentrePx(map: maplibregl.Map): { cx: number; cy: number } {
    const canvas = map.getCanvas();
    const pad = map.getPadding();
    const top = pad.top ?? 0;
    const bottom = pad.bottom ?? 0;
    const left = pad.left ?? 0;
    const right = pad.right ?? 0;
    return {
        cx: (left + (canvas.clientWidth - right)) / 2,
        cy: (top + (canvas.clientHeight - bottom)) / 2,
    };
}

/** Screen-centre ground point (accounts for pitch + padding, unlike map.getCenter). */
export function screenCenterLngLat(map: maplibregl.Map): { lng: number; lat: number } {
    const { cx, cy } = screenCentrePx(map);
    const p = map.unproject([cx, cy]);
    return { lng: p.lng, lat: p.lat };
}

/**
 * Azimuth (deg from north, clockwise) of the screen-up direction on the ground
 * at the centre of the view. Derived from the projection (not map.getBearing)
 * so it stays correct under pitch and matches the unprojected preview exactly.
 *
 * Samples a wide, symmetric baseline around the screen centre: a short baseline
 * differences two near-identical unprojected points, amplifying floating-point
 * noise into a visible rotation jitter ("wobble") of the free-orientation
 * preview during camera moves.
 */
export function screenUpAzimuthDeg(map: maplibregl.Map): number {
    const { cx, cy } = screenCentrePx(map);
    // Keep the baseline well clear of the horizon under pitch.
    const base = Math.min(cy * 0.5, 160);
    const up = map.unproject([cx, cy - base]);
    const down = map.unproject([cx, cy + base]);
    const dN = up.lat - down.lat;
    const dE = (up.lng - down.lng) * Math.cos((down.lat * Math.PI) / 180);
    return (Math.atan2(dE, dN) * 180) / Math.PI;
}

/**
 * Clamp a rectangle's dimensions so its ground area stays within `maxAreaM2`,
 * scaling both sides by the same factor to preserve the aspect ratio.
 */
export function clampRectToArea(
    widthM: number, lengthM: number, maxAreaM2: number,
): CaptureRectDims {
    const area = widthM * lengthM;
    if (area <= maxAreaM2) return { widthM, lengthM };
    const scale = Math.sqrt(maxAreaM2 / area);
    return { widthM: widthM * scale, lengthM: lengthM * scale };
}
