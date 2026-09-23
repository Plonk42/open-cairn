import { describe, expect, it } from 'vitest';
import {
    cameraForViewpoint,
    centerDistanceForZoom,
    easeInOutCubic,
    eyeHeightAfterStep,
    eyeLookingAt,
    flightDurationMs,
    focalEquivalentMm,
    fovAfterPinch,
    fovAfterWheel,
    highestGroundNearby,
    horizontalFovDeg,
    interpolatePose,
    lookAfterDrag,
    VIEWPOINT_EYE_HEIGHT_M,
    VIEWPOINT_EYE_STEP_M,
    VIEWPOINT_MAX_EYE_HEIGHT_M,
    VIEWPOINT_MAX_FOV,
    VIEWPOINT_MAX_PITCH,
    VIEWPOINT_MIN_FOV,
    VIEWPOINT_MIN_PITCH,
    VIEWPOINT_TARGET_DISTANCE_M,
    type Viewpoint,
    type ViewpointPose,
} from './viewpointCamera';

/** Aiguille du Midi-ish: a high viewpoint at a latitude where cos(lat) ≈ 0.7. */
const EYE: Viewpoint = { lng: 6.887, lat: 45.879, altitude: 3842 };
const LENS = { heightPx: 900, fovDeg: 36.87 };

const EQUATOR_METERS = 40075016.686;
const METERS_PER_DEGREE_LAT = EQUATOR_METERS / 360;
const D = VIEWPOINT_TARGET_DISTANCE_M;

/** Metres a CSS pixel covers at the map centre, for the returned zoom. */
function metersPerPixel(zoom: number, lat: number): number {
    return (EQUATOR_METERS * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

describe('cameraForViewpoint', () => {
    it('puts the centre at eye altitude, dead ahead, when looking at the horizon', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 0, pitch: 90 }, LENS);
        expect(cam.elevation).toBeCloseTo(EYE.altitude, 6);
        expect(cam.center[0]).toBeCloseTo(EYE.lng, 9);
        expect(cam.center[1]).toBeCloseTo(EYE.lat + D / METERS_PER_DEGREE_LAT, 6);
    });

    it('sends the centre due east on bearing 90', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 90, pitch: 90 }, LENS);
        const cosLat = Math.cos((EYE.lat * Math.PI) / 180);
        expect(cam.center[1]).toBeCloseTo(EYE.lat, 9);
        expect(cam.center[0]).toBeCloseTo(EYE.lng + D / (METERS_PER_DEGREE_LAT * cosLat), 6);
    });

    it('drops the centre straight below the eye when looking down', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 143, pitch: 0 }, LENS);
        expect(cam.center[0]).toBeCloseTo(EYE.lng, 9);
        expect(cam.center[1]).toBeCloseTo(EYE.lat, 9);
        expect(cam.elevation).toBeCloseTo(EYE.altitude - D, 6);
    });

    it('raises the centre above the eye when looking up', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 143, pitch: 180 }, LENS);
        expect(cam.elevation).toBeCloseTo(EYE.altitude + D, 6);
    });

    it('returns the zoom whose pixel span matches the eye-to-centre distance', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 210, pitch: 75 }, LENS);
        // MapLibre's own definition of the distance from the eye to the centre.
        const distancePx = (0.5 / Math.tan((LENS.fovDeg * Math.PI) / 360)) * LENS.heightPx;
        expect(metersPerPixel(cam.zoom, cam.center[1]) * distancePx).toBeCloseTo(D, 3);
    });

    it('keeps the zoom steady while the gaze sweeps across the horizon', () => {
        // This is the whole point of a constant eye-to-centre distance: MapLibre's
        // own inversion steps the distance to 10 km inside |cos(pitch)| < 0.1 and
        // would pop the tile LOD right where a look-around view spends its time.
        const zooms = [60, 75, 85, 90, 95, 105, 120].map(
            (pitch) => cameraForViewpoint(EYE, { bearing: 30, pitch }, LENS).zoom,
        );
        const spread = Math.max(...zooms) - Math.min(...zooms);
        expect(spread).toBeLessThan(0.01);
    });

    it('zooms in when the lens narrows', () => {
        const wide = cameraForViewpoint(EYE, { bearing: 0, pitch: 90 }, { ...LENS, fovDeg: 60 });
        const tele = cameraForViewpoint(EYE, { bearing: 0, pitch: 90 }, { ...LENS, fovDeg: 10 });
        expect(tele.zoom).toBeGreaterThan(wide.zoom + 2);
        // The eye is unchanged, so the centre must not move either.
        expect(tele.center[1]).toBeCloseTo(wide.center[1], 9);
    });

    it('never divides by zero on a degenerate lens', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 0, pitch: 90 }, { heightPx: 0, fovDeg: 36.87 });
        expect(Number.isFinite(cam.zoom)).toBe(true);
    });
});

describe('horizontalFovDeg', () => {
    it('equals the vertical field of view on a square canvas', () => {
        expect(horizontalFovDeg(40, 1)).toBeCloseTo(40, 6);
    });

    it('widens on a landscape canvas', () => {
        expect(horizontalFovDeg(36.87, 16 / 9)).toBeGreaterThan(36.87);
    });
});

describe('focalEquivalentMm', () => {
    it('maps a 24 mm lens to its vertical field of view on a 24×36 frame', () => {
        const fov24mm = (2 * Math.atan(12 / 24) * 180) / Math.PI;
        expect(focalEquivalentMm(fov24mm)).toBeCloseTo(24, 6);
    });

    it('grows as the field of view narrows', () => {
        expect(focalEquivalentMm(10)).toBeGreaterThan(focalEquivalentMm(50));
    });
});

describe('lookAfterDrag', () => {
    const canvas = { widthPx: 1600, heightPx: 900 };

    it('sweeps one horizontal field of view over a full-width drag', () => {
        const next = lookAfterDrag({ bearing: 180, pitch: 90 }, { dx: 1600, dy: 0 }, canvas, 36.87);
        // Dragging right turns the head left: the scene follows the cursor.
        expect(next.bearing).toBeCloseTo(180 - horizontalFovDeg(36.87, 16 / 9), 6);
        expect(next.pitch).toBeCloseTo(90, 6);
    });

    it('raises the gaze when the panorama is dragged down', () => {
        const next = lookAfterDrag({ bearing: 0, pitch: 90 }, { dx: 0, dy: 90 }, canvas, 36.87);
        expect(next.pitch).toBeCloseTo(90 + 3.687, 3);
    });

    it('clamps the pitch instead of tipping over the zenith', () => {
        const up = lookAfterDrag({ bearing: 0, pitch: 90 }, { dx: 0, dy: 100000 }, canvas, 36.87);
        const down = lookAfterDrag({ bearing: 0, pitch: 90 }, { dx: 0, dy: -100000 }, canvas, 36.87);
        expect(up.pitch).toBe(VIEWPOINT_MAX_PITCH);
        expect(down.pitch).toBe(VIEWPOINT_MIN_PITCH);
    });
});

describe('fovAfterWheel', () => {
    it('narrows on a negative delta and widens on a positive one', () => {
        expect(fovAfterWheel(30, -100)).toBeLessThan(30);
        expect(fovAfterWheel(30, 100)).toBeGreaterThan(30);
    });

    it('stays inside the usable lens range', () => {
        expect(fovAfterWheel(30, -100000)).toBe(VIEWPOINT_MIN_FOV);
        expect(fovAfterWheel(30, 100000)).toBe(VIEWPOINT_MAX_FOV);
    });
});

describe('fovAfterPinch', () => {
    it('narrows the lens as the fingers spread, exactly in proportion', () => {
        expect(fovAfterPinch(30, 2)).toBeCloseTo(15, 6);
        expect(fovAfterPinch(15, 0.5)).toBeCloseTo(30, 6);
    });

    it('stays inside the usable lens range', () => {
        expect(fovAfterPinch(30, 1000)).toBe(VIEWPOINT_MIN_FOV);
        expect(fovAfterPinch(30, 0.001)).toBe(VIEWPOINT_MAX_FOV);
    });

    it('survives a degenerate ratio rather than returning NaN', () => {
        expect(fovAfterPinch(30, 0)).toBe(VIEWPOINT_MAX_FOV);
    });
});

describe('eyeHeightAfterStep', () => {
    it('moves one step per press, ten with Shift', () => {
        expect(eyeHeightAfterStep(50, true, false)).toBeCloseTo(50 + VIEWPOINT_EYE_STEP_M, 6);
        expect(eyeHeightAfterStep(50, false, false)).toBeCloseTo(50 - VIEWPOINT_EYE_STEP_M, 6);
        expect(eyeHeightAfterStep(50, true, true)).toBeCloseTo(50 + 10 * VIEWPOINT_EYE_STEP_M, 6);
    });

    it('never sinks below standing height', () => {
        expect(eyeHeightAfterStep(VIEWPOINT_EYE_HEIGHT_M, false, true)).toBe(VIEWPOINT_EYE_HEIGHT_M);
    });

    it('stops at the ceiling', () => {
        expect(eyeHeightAfterStep(VIEWPOINT_MAX_EYE_HEIGHT_M, true, true)).toBe(VIEWPOINT_MAX_EYE_HEIGHT_M);
    });
});

describe('flight helpers', () => {
    const pose = (eye: Viewpoint, bearing: number, pitch = 60, fovDeg = 36.87, distanceM = 5000): ViewpointPose =>
        ({ eye, look: { bearing, pitch }, fovDeg, distanceM });

    it('inverts the zoom cameraForViewpoint picks', () => {
        const cam = cameraForViewpoint(EYE, { bearing: 30, pitch: 85 }, LENS);
        expect(centerDistanceForZoom(cam.zoom, cam.center[1], LENS)).toBeCloseTo(D, 3);
    });

    it('lands the forward eye where cameraForViewpoint put the centre', () => {
        const look = { bearing: 210, pitch: 60 };
        const cam = cameraForViewpoint(EYE, look, LENS);
        const eye = eyeLookingAt({ lng: cam.center[0], lat: cam.center[1], altitude: cam.elevation }, look, D);
        expect(eye.lng).toBeCloseTo(EYE.lng, 4);
        expect(eye.lat).toBeCloseTo(EYE.lat, 4);
        expect(eye.altitude).toBeCloseTo(EYE.altitude, 3);
    });

    it('starts and ends exactly on its two poses', () => {
        const a = pose(EYE, 10);
        const b = pose({ lng: 6.9, lat: 45.9, altitude: 2000 }, 80, 85, 20, D);
        expect(interpolatePose(a, b, 0)).toEqual(a);
        const end = interpolatePose(a, b, 1);
        expect(end.eye).toEqual(b.eye);
        expect(end.look.bearing).toBeCloseTo(80, 9);
        expect(end.fovDeg).toBeCloseTo(20, 9);
    });

    it('turns the short way round', () => {
        const mid = interpolatePose(pose(EYE, 350), pose(EYE, 10), 0.5);
        expect(((mid.look.bearing % 360) + 360) % 360).toBeCloseTo(0, 9);
    });

    it('eases in and out, and keeps a hop short and a crossing bounded', () => {
        expect(easeInOutCubic(0)).toBe(0);
        expect(easeInOutCubic(1)).toBe(1);
        expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
        expect(flightDurationMs(EYE, EYE)).toBeGreaterThan(0);
        const far = { lng: EYE.lng + 1, lat: EYE.lat, altitude: EYE.altitude };
        expect(flightDurationMs(EYE, far)).toBeGreaterThan(flightDurationMs(EYE, EYE));
        expect(flightDurationMs(EYE, far)).toBeLessThanOrEqual(2500);
    });
});

describe('highestGroundNearby', () => {
    const CLICK = { lng: EYE.lng, lat: EYE.lat };
    const cosLat = Math.cos((CLICK.lat * Math.PI) / 180);
    /** Metres east and north of the click. */
    const offset = (lng: number, lat: number) => ({
        east: (lng - CLICK.lng) * METERS_PER_DEGREE_LAT * cosLat,
        north: (lat - CLICK.lat) * METERS_PER_DEGREE_LAT,
    });

    it('stays on the click when the ground is flat within the tolerance', () => {
        const spot = highestGroundNearby(CLICK, (lng) => 1000 + 0.2 * Math.sin(lng * 1e5));
        expect(spot).toMatchObject(CLICK);
    });

    it('climbs a slope to the edge of the disc', () => {
        const spot = highestGroundNearby(CLICK, (lng, lat) => 1000 + 0.4 * offset(lng, lat).east);
        // Anything within the 0.5 m tolerance of the top counts: 48.75 m east and up.
        expect(offset(spot!.lng, spot!.lat).east).toBeGreaterThan(48.7);
        expect(spot!.ground).toBeGreaterThan(1019.5);
    });

    it('finds a knoll off to one side', () => {
        const knoll = (lng: number, lat: number) => {
            const { east, north } = offset(lng, lat);
            return 1000 + 8 * Math.exp(-(east ** 2 + (north - 30) ** 2) / 200);
        };
        const spot = highestGroundNearby(CLICK, knoll)!;
        expect(offset(spot.lng, spot.lat).north).toBeCloseTo(30, 0);
        expect(Math.abs(offset(spot.lng, spot.lat).east)).toBeLessThan(1);
    });

    it('gives up when no sample has a height', () => {
        expect(highestGroundNearby(CLICK, () => null)).toBeNull();
    });
});
