import { decodeShareState, encodeShareState, type SharedState } from '@/lib/shareView';
import {
    VIEWPOINT_EYE_HEIGHT_M,
    VIEWPOINT_MAX_EYE_HEIGHT_M,
    VIEWPOINT_MAX_PITCH,
    VIEWPOINT_MIN_FOV,
    type ViewpointFraming,
} from '@/lib/viewpointCamera';
import { describe, expect, it } from 'vitest';

function baseState(): SharedState {
    return {
        view: { longitude: 6.865432, latitude: 45.832611, zoom: 14.27, pitch: 52.3, bearing: 117.8 },
        viewpoint: null,
        baseLayer: 'plan',
        toponymsEnabled: true,
        hillshadeEnabled: true,
        hillshadeSource: 'mnh',
        hillshadeBlend: 'multiply',
        hillshadeIntensity: 0.8,
        terrainEnabled: true,
        terrainExaggeration: 1.4,
        terrainDemSource: 'mapterhorn',
        contourLinesEnabled: false,
        contourLinesOpacity: 0.5,
        sunDate: '2024-06-21T07:30',
        atmosphericSky: true,
        skySunPath: true,
        skyMoonPath: false,
        skyHiddenPath: true,
        routeActive: true,
        routeMode: 'auto',
        colorElevationBySlope: true,
        waypoints: [
            { id: 'wp-1', coordinate: [6.86, 45.83], modeFromPrevious: undefined },
            { id: 'wp-2', coordinate: [6.87, 45.84], modeFromPrevious: 'free' },
        ],
        selectionRange: [120.5, 850.2],
    };
}

describe('shareView round-trip', () => {
    it('preserves the core map/route state through encode → decode', () => {
        const decoded = decodeShareState(encodeShareState(baseState()));
        expect(decoded).not.toBeNull();
        const s = decoded!;
        expect(s.view.longitude).toBeCloseTo(6.865432, 6);
        expect(s.view.latitude).toBeCloseTo(45.832611, 6);
        expect(s.view.zoom).toBeCloseTo(14.27, 2);
        expect(s.baseLayer).toBe('plan');
        expect(s.toponymsEnabled).toBe(true);
        expect(s.hillshadeEnabled).toBe(true);
        expect(s.hillshadeBlend).toBe('multiply');
        expect(s.terrainExaggeration).toBeCloseTo(1.4, 2);
        expect(s.routeActive).toBe(true);
        expect(s.colorElevationBySlope).toBe(true);
        expect(s.selectionRange).toEqual([120.5, 850.2]);
    });

    it('keeps waypoint coordinates and per-segment modes', () => {
        const decoded = decodeShareState(encodeShareState(baseState()))!;
        expect(decoded.waypoints).toHaveLength(2);
        expect(decoded.waypoints[0].coordinate[0]).toBeCloseTo(6.86, 6);
        // first waypoint never carries a mode-from-previous
        expect(decoded.waypoints[0].modeFromPrevious).toBeUndefined();
        expect(decoded.waypoints[1].modeFromPrevious).toBe('free');
    });

    it('carries the terrain DEM source and the sun/moon settings', () => {
        const decoded = decodeShareState(encodeShareState(baseState()))!;
        expect(decoded.terrainDemSource).toBe('mapterhorn');
        expect(decoded.sunDate).toBe('2024-06-21T07:30');
        expect(decoded.atmosphericSky).toBe(true);
        expect(decoded.skySunPath).toBe(true);
        expect(decoded.skyMoonPath).toBe(false);
        expect(decoded.skyHiddenPath).toBe(true);
    });

    it('produces a URL-safe payload (no +, /, or = characters)', () => {
        const encoded = encodeShareState(baseState());
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it('returns null for malformed input', () => {
        expect(decodeShareState('not-valid-base64-$$$')).toBeNull();
        expect(decodeShareState('')).toBeNull();
    });
});

describe('shareView viewpoint', () => {
    function withViewpoint(framing: ViewpointFraming, heightM = 1.7): SharedState {
        return {
            ...baseState(),
            viewpoint: { eye: { lng: 6.912345, lat: 45.901234, altitude: 2843.6 }, framing, heightM },
        };
    }

    it('round-trips the eye and its framing', () => {
        const decoded = decodeShareState(
            encodeShareState(withViewpoint({ bearing: 214.7, pitch: 96.4, fovDeg: 23.5 })),
        )!;
        expect(decoded.viewpoint).not.toBeNull();
        const vp = decoded.viewpoint!;
        expect(vp.eye.lng).toBeCloseTo(6.912345, 6);
        expect(vp.eye.lat).toBeCloseTo(45.901234, 6);
        expect(vp.eye.altitude).toBeCloseTo(2843.6, 1);
        expect(vp.framing.bearing).toBeCloseTo(214.7, 1);
        // above the horizon: the ceiling the plain map camera has must not apply
        expect(vp.framing.pitch).toBeCloseTo(96.4, 1);
        expect(vp.framing.fovDeg).toBeCloseTo(23.5, 2);
    });

    it('clamps a framing the mode could not accept', () => {
        const decoded = decodeShareState(
            encodeShareState(withViewpoint({ bearing: 0, pitch: 400, fovDeg: 0.1 })),
        )!;
        expect(decoded.viewpoint!.framing.pitch).toBe(VIEWPOINT_MAX_PITCH);
        expect(decoded.viewpoint!.framing.fovDeg).toBe(VIEWPOINT_MIN_FOV);
    });

    it('carries a raised eye rather than flattening it back to standing height', () => {
        const framing = { bearing: 12, pitch: 85, fovDeg: 40 };
        const decoded = decodeShareState(encodeShareState(withViewpoint(framing, 48.5)))!;
        expect(decoded.viewpoint!.heightM).toBeCloseTo(48.5, 1);
    });

    it('clamps a height the arrows could not have reached', () => {
        const framing = { bearing: 0, pitch: 85, fovDeg: 40 };
        expect(decodeShareState(encodeShareState(withViewpoint(framing, -500)))!.viewpoint!.heightM)
            .toBe(VIEWPOINT_EYE_HEIGHT_M);
        expect(decodeShareState(encodeShareState(withViewpoint(framing, 1e6)))!.viewpoint!.heightM)
            .toBe(VIEWPOINT_MAX_EYE_HEIGHT_M);
    });

    it('decodes to null when the sharer was not in the mode', () => {
        expect(decodeShareState(encodeShareState(baseState()))!.viewpoint).toBeNull();
    });
});
