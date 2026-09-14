/**
 * Geometry helpers for the oriented LiDAR capture rectangle.
 *
 * The rectangle is anchored to the ground: drawing it stores its centre, its
 * orientation (the camera bearing at draw time) and its two sides in metres, so
 * the camera can then be framed freely without moving what will be captured.
 * These helpers turn that into ground geometry — both for drawing the preview
 * polygon and for measuring a drag.
 */
import type maplibregl from 'maplibre-gl';

/** Hard cap on the capture rectangle's ground area (m²). A 5000 × 5000 m zone
 *  (= 2500 ha) is the largest allowed, in every mode: what a capture can
 *  actually swallow is a point count, not an area, and the capture resolution
 *  (see `lidarResolution.ts`) is what bounds it. The fetch still derives its
 *  radius from the enclosing circle so tile/node selection brackets the whole
 *  (possibly rotated) footprint. */
export const LIDAR_RECT_MAX_AREA_M2 = 25_000_000;
/** Smallest side (m) a capture rectangle is allowed to have. */
export const LIDAR_RECT_MIN_SIDE_M = 20;

/** Metres per degree of latitude (WGS84 mean) — good enough at France scales. */
const M_PER_DEG_LAT = 111_320;

/** Ground-anchored capture rectangle. */
export interface CaptureRect {
    centerLng: number;
    centerLat: number;
    /** Azimuth (deg from north, clockwise) of the `lengthM` axis. */
    bearingDeg: number;
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
export function rectPreviewGeoJson(rect: CaptureRect): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [rectCornersLngLat(
                    rect.centerLng, rect.centerLat, rect.bearingDeg, rect.widthM, rect.lengthM,
                )],
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
 * True when any corner or the centre of the rectangle projects inside the
 * canvas. The zone is ground-anchored, so panning away leaves it off-screen
 * with nothing to show.
 */
export function rectOnScreen(map: maplibregl.Map, rect: CaptureRect): boolean {
    const canvas = map.getCanvas();
    const points: GeoJSON.Position[] = [
        ...rectCornersLngLat(rect.centerLng, rect.centerLat, rect.bearingDeg, rect.widthM, rect.lengthM),
        [rect.centerLng, rect.centerLat],
    ];
    return points.some(([lng, lat]) => {
        const p = map.project([lng, lat]);
        return p.x >= 0 && p.x <= canvas.clientWidth && p.y >= 0 && p.y <= canvas.clientHeight;
    });
}

/**
 * Clamp a rectangle's sides so its ground area stays within `maxAreaM2`,
 * scaling both by the same factor to preserve the aspect ratio.
 */
export function clampRectToArea(rect: CaptureRect, maxAreaM2: number): CaptureRect {
    const widthM = Math.max(LIDAR_RECT_MIN_SIDE_M, rect.widthM);
    const lengthM = Math.max(LIDAR_RECT_MIN_SIDE_M, rect.lengthM);
    const area = widthM * lengthM;
    if (area <= maxAreaM2) return { ...rect, widthM, lengthM };
    const scale = Math.sqrt(maxAreaM2 / area);
    return { ...rect, widthM: widthM * scale, lengthM: lengthM * scale };
}

/**
 * Rectangle spanned by a drag between two ground points, with its axes along
 * `bearingDeg`. The drag box is axis-aligned in that rotated frame, so the
 * midpoint of the dragged diagonal is the rectangle's centre.
 */
export function rectFromDrag(
    a: { lng: number; lat: number },
    b: { lng: number; lat: number },
    bearingDeg: number,
): CaptureRect {
    const centerLat = (a.lat + b.lat) / 2;
    const centerLng = (a.lng + b.lng) / 2;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
    const dE = (b.lng - a.lng) * mPerDegLng;
    const dN = (b.lat - a.lat) * M_PER_DEG_LAT;
    const rad = (bearingDeg * Math.PI) / 180;
    const alongLength = dE * Math.sin(rad) + dN * Math.cos(rad);
    const alongWidth = dE * Math.cos(rad) - dN * Math.sin(rad);
    return clampRectToArea({
        centerLng,
        centerLat,
        bearingDeg,
        widthM: Math.abs(alongWidth),
        lengthM: Math.abs(alongLength),
    }, LIDAR_RECT_MAX_AREA_M2);
}
