import { describe, expect, it } from 'vitest';
import {
    cameraForViewpoint,
    focalEquivalentMm,
    fovAfterWheel,
    horizontalFovDeg,
    lookAfterDrag,
    VIEWPOINT_MAX_FOV,
    VIEWPOINT_MAX_PITCH,
    VIEWPOINT_MIN_FOV,
    VIEWPOINT_MIN_PITCH,
    VIEWPOINT_TARGET_DISTANCE_M,
    type Viewpoint,
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
