// ─────────────────────────────────────────────────────────────────────────────
// Viewpoint camera — standing still and looking around.
//
// MapLibre's camera is not an eye: it is `center + zoom + pitch + bearing`, and
// the eye is *derived*, sitting `cameraToCenterDistance` behind and above the
// center. Rotating the bearing therefore swings the eye around the center — the
// exact opposite of standing on a summit and turning your head.
//
// This module inverts the relation: given the eye, the look direction and the
// lens, it returns the `center / elevation / zoom` that put the eye back where
// we want it. Every rotation then keeps the viewpoint fixed by construction.
//
// MapLibre ships `calculateCameraOptionsFromCameraLngLatAltRotation`, which does
// the same inversion — but its `_distanceToCenterFromAltElevationPitch` snaps
// the center-to-eye distance to a flat 10 km whenever `|cos(pitch)| < 0.1`, and
// otherwise pins the center to the *current* transform elevation. Both make the
// distance (and therefore the zoom) jump around while you pan: near the horizon
// it steps discontinuously, away from it `d = Δaltitude / cos(pitch)` swings by
// more than a zoom level between pitch 80° and 60°. A look-around mode lives
// precisely in that band, and every jump re-picks the tile LOD under the view.
//
// Holding the distance CONSTANT instead makes the zoom constant, so the relief
// keeps its detail level while you turn. It is nearly free: with the eye and
// the field of view fixed, the PROJECTION does not depend on where along the
// view ray the center sits. The tile LOD does, though — the zoom is exactly
// what MapLibre hands to `calculateTileZoom` as the centre zoom, which is why
// `panoramaDetail.ts` has to re-open that decision.
// ─────────────────────────────────────────────────────────────────────────────

/** Eye of a first-person viewpoint. */
export interface Viewpoint {
    lng: number;
    lat: number;
    /** Metres above sea level: DEM height at (lng, lat) plus the eye height. */
    altitude: number;
}

/** Where the observer is looking, in MapLibre's own angular convention. */
export interface LookDirection {
    /** Compass direction faced, degrees clockwise from north. */
    bearing: number;
    /** 0° straight down, 90° at the horizon, 180° straight up. */
    pitch: number;
}

/**
 * A look direction plus the lens it is seen through. Together with the eye, this
 * is everything the rendered image depends on — which is why it travels as one
 * piece through a share link.
 */
export interface ViewpointFraming extends LookDirection {
    /** Vertical field of view in degrees. */
    fovDeg: number;
}

/** Canvas and field of view, i.e. everything the projection needs besides the eye. */
export interface ViewpointLens {
    /** Canvas height in CSS pixels (`canvas.clientHeight`). */
    heightPx: number;
    /** Vertical field of view in degrees (`map.getVerticalFieldOfView()`). */
    fovDeg: number;
}

/** MapLibre camera options that place the eye exactly on the viewpoint. */
export interface ViewpointCamera {
    center: [number, number];
    elevation: number;
    zoom: number;
    bearing: number;
    pitch: number;
}

/** Eye height above the ground on arrival, and the floor the arrows cannot go under. */
export const VIEWPOINT_EYE_HEIGHT_M = 1.7;

/**
 * Ceiling for the arrow keys. Well past what the mode is for, but standing at
 * 1.70 m the drawn terrain a few metres ahead often rises above the eye, and
 * getting clear of it takes tens of metres, not two (see
 * `docs/UI_SHELL_AND_RESPONSIVE.md`).
 */
export const VIEWPOINT_MAX_EYE_HEIGHT_M = 3000;

/** Vertical travel per arrow press, ×10 with Shift. */
export const VIEWPOINT_EYE_STEP_M = 2;
const VIEWPOINT_EYE_FAST_FACTOR = 10;

/**
 * Eye height after one arrow press, clamped to the usable range.
 *
 * @param heightM - Current height above the ground.
 * @param up - `true` for the up arrow.
 * @param fast - Shift held: ten steps at once.
 */
export function eyeHeightAfterStep(heightM: number, up: boolean, fast: boolean): number {
    const step = VIEWPOINT_EYE_STEP_M * (fast ? VIEWPOINT_EYE_FAST_FACTOR : 1);
    return clampNumber(heightM + (up ? step : -step), VIEWPOINT_EYE_HEIGHT_M, VIEWPOINT_MAX_EYE_HEIGHT_M);
}

/**
 * Distance from the eye to MapLibre's center point. Invisible in the image, but
 * it is what sets the zoom, hence the tile LOD: ~4 km puts the center in the
 * middle of the range a summit panorama actually shows.
 */
export const VIEWPOINT_TARGET_DISTANCE_M = 4000;

/** Looking straight up or straight down is useless here and degenerates the yaw. */
export const VIEWPOINT_MIN_PITCH = 20;
export const VIEWPOINT_MAX_PITCH = 150;

/** ~170 mm to ~21 mm equivalent on a 24×36 frame. */
export const VIEWPOINT_MIN_FOV = 8;
export const VIEWPOINT_MAX_FOV = 60;

/** Pitch on entering the mode: just below the horizon, where the landscape is. */
export const VIEWPOINT_INITIAL_PITCH = 85;

const EQUATOR_METERS = 40075016.686;
/** MapLibre's zoom is defined on 512 px tiles: `worldSize = 512 · 2^zoom`. */
const TILE_SIZE = 512;
const METERS_PER_DEGREE_LAT = EQUATOR_METERS / 360;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Horizontal field of view of a `fovDeg` vertical lens on a `aspect = w/h` canvas.
 * Dragging the full canvas width should sweep exactly this much, so the relief
 * follows the cursor like a dragged panorama.
 */
export function horizontalFovDeg(fovDeg: number, aspect: number): number {
    return toDeg(2 * Math.atan(Math.tan(toRad(fovDeg) / 2) * Math.max(aspect, 1e-6)));
}

/** Focal length on a 24×36 frame giving the same vertical field of view. */
export function focalEquivalentMm(fovDeg: number): number {
    return 12 / Math.tan(toRad(clampNumber(fovDeg, 0.1, 179)) / 2);
}

/**
 * Zoom at which MapLibre's fixed pixel distance from eye to center spans
 * `distanceM` metres on the ground.
 *
 * `cameraToCenterDistance = 0.5 / tan(fov/2) · height` is expressed in CSS
 * pixels and depends only on the lens, so the zoom is whatever makes a pixel
 * worth `distanceM / thatDistance` metres at the center's latitude.
 */
function zoomForCenterDistance(distanceM: number, centerLat: number, lens: ViewpointLens): number {
    const distancePx = (0.5 / Math.tan(toRad(lens.fovDeg) / 2)) * Math.max(1, lens.heightPx);
    const metersPerPixel = distanceM / distancePx;
    const worldMeters = EQUATOR_METERS * Math.cos(toRad(centerLat));
    return Math.log2(worldMeters / (TILE_SIZE * metersPerPixel));
}

/**
 * Camera options that leave the eye at `eye` while looking along `look`.
 *
 * @param eye - Fixed observer position; never moves, whatever the rotation.
 * @param look - Bearing and pitch the observer is facing.
 * @param lens - Canvas height and vertical field of view.
 * @param distanceM - Eye-to-center distance; only affects the zoom, not the image.
 */
export function cameraForViewpoint(
    eye: Viewpoint,
    look: LookDirection,
    lens: ViewpointLens,
    distanceM: number = VIEWPOINT_TARGET_DISTANCE_M,
): ViewpointCamera {
    const distance = Math.max(1, distanceM);
    const pitchRad = toRad(look.pitch);
    const bearingRad = toRad(look.bearing);

    // The center sits `distance` metres in front of the eye along the view ray.
    // MapLibre measures pitch from straight down, so the vertical component is
    // `-cos(pitch)` (down below 90°, up above) and the ground run is `sin(pitch)`.
    const groundRun = distance * Math.sin(pitchRad);
    const elevation = eye.altitude - distance * Math.cos(pitchRad);

    const lat = eye.lat + (groundRun * Math.cos(bearingRad)) / METERS_PER_DEGREE_LAT;
    // Equirectangular offset: over the few kilometres involved the meridian
    // convergence is far below the DEM's own accuracy.
    const cosLat = Math.max(Math.cos(toRad(eye.lat)), 1e-6);
    const lng = eye.lng + (groundRun * Math.sin(bearingRad)) / (METERS_PER_DEGREE_LAT * cosLat);

    return {
        center: [lng, lat],
        elevation,
        zoom: zoomForCenterDistance(distance, lat, lens),
        bearing: look.bearing,
        pitch: look.pitch,
    };
}

/** Inverse of the zoom `cameraForViewpoint` picks: eye-to-center distance a camera implies. */
export function centerDistanceForZoom(zoom: number, centerLat: number, lens: ViewpointLens): number {
    const distancePx = (0.5 / Math.tan(toRad(lens.fovDeg) / 2)) * Math.max(1, lens.heightPx);
    const metersPerPixel = (EQUATOR_METERS * Math.cos(toRad(centerLat))) / (TILE_SIZE * 2 ** zoom);
    return distancePx * metersPerPixel;
}

/** Everything a flight interpolates: the eye, where it looks, the lens, and how far the center sits. */
export interface ViewpointPose {
    eye: Viewpoint;
    look: LookDirection;
    fovDeg: number;
    distanceM: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Pose `t` (0..1) of the way from `from` to `to`. The eye travels straight and
 * the bearing takes the short way round; interpolating MapLibre's own
 * `center / zoom` instead would swing the eye around a center kilometres away.
 */
export function interpolatePose(from: ViewpointPose, to: ViewpointPose, t: number): ViewpointPose {
    const turn = ((((to.look.bearing - from.look.bearing) % 360) + 540) % 360) - 180;
    return {
        eye: {
            lng: lerp(from.eye.lng, to.eye.lng, t),
            lat: lerp(from.eye.lat, to.eye.lat, t),
            altitude: lerp(from.eye.altitude, to.eye.altitude, t),
        },
        look: { bearing: from.look.bearing + turn * t, pitch: lerp(from.look.pitch, to.look.pitch, t) },
        fovDeg: lerp(from.fovDeg, to.fovDeg, t),
        distanceM: lerp(from.distanceM, to.distanceM, t),
    };
}

/** Slow out, slow in: the flight should neither lurch off nor slam into the ground. */
export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const FLIGHT_MIN_MS = 900;
const FLIGHT_MAX_MS = 2500;

/** Longer for a longer trip, within bounds: a hop is not a crossing. */
export function flightDurationMs(from: Viewpoint, to: Viewpoint): number {
    const northM = (to.lat - from.lat) * METERS_PER_DEGREE_LAT;
    const eastM = (to.lng - from.lng) * METERS_PER_DEGREE_LAT * Math.cos(toRad((from.lat + to.lat) / 2));
    const metres = Math.hypot(northM, eastM, to.altitude - from.altitude);
    return clampNumber(700 + metres * 0.12, FLIGHT_MIN_MS, FLIGHT_MAX_MS);
}

/**
 * The eye of a camera looking at `target` from `distanceM` away along `look`:
 * the forward counterpart of {@link cameraForViewpoint}.
 */
export function eyeLookingAt(target: Viewpoint, look: LookDirection, distanceM: number): Viewpoint {
    const groundRun = distanceM * Math.sin(toRad(look.pitch));
    const bearingRad = toRad(look.bearing);
    const cosLat = Math.max(Math.cos(toRad(target.lat)), 1e-6);
    return {
        lng: target.lng - (groundRun * Math.sin(bearingRad)) / (METERS_PER_DEGREE_LAT * cosLat),
        lat: target.lat - (groundRun * Math.cos(bearingRad)) / METERS_PER_DEGREE_LAT,
        altitude: target.altitude + distanceM * Math.cos(toRad(look.pitch)),
    };
}

/**
 * Look direction after dragging the panorama by `dx` / `dy` CSS pixels.
 *
 * The scene follows the cursor: dragging right turns the head left, dragging
 * down raises the gaze. A full-width drag sweeps one horizontal field of view.
 */
export function lookAfterDrag(
    look: LookDirection,
    drag: Readonly<{ dx: number; dy: number }>,
    canvas: Readonly<{ widthPx: number; heightPx: number }>,
    fovDeg: number,
): LookDirection {
    const width = Math.max(1, canvas.widthPx);
    const height = Math.max(1, canvas.heightPx);
    return {
        bearing: look.bearing - (drag.dx / width) * horizontalFovDeg(fovDeg, width / height),
        pitch: clampNumber(
            look.pitch + (drag.dy / height) * fovDeg,
            VIEWPOINT_MIN_PITCH,
            VIEWPOINT_MAX_PITCH,
        ),
    };
}

/**
 * Field of view after a wheel notch. Multiplicative so a notch is a constant
 * ratio of focal length, like a real zoom ring, rather than a constant angle.
 */
export function fovAfterWheel(fovDeg: number, deltaY: number): number {
    return clampNumber(fovDeg * Math.exp(deltaY * 0.0015), VIEWPOINT_MIN_FOV, VIEWPOINT_MAX_FOV);
}

/**
 * Field of view after a pinch, `ratio` being how much the finger spacing grew.
 * Spreading the fingers magnifies, i.e. narrows the lens, so the focal length
 * follows the spacing exactly — the image scales with the gesture.
 */
export function fovAfterPinch(fovDeg: number, ratio: number): number {
    return clampNumber(fovDeg / Math.max(ratio, 1e-6), VIEWPOINT_MIN_FOV, VIEWPOINT_MAX_FOV);
}
