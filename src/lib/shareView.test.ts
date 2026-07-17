import { describe, expect, it } from 'vitest';
import { decodeShareState, encodeShareState, type SharedState } from '@/lib/shareView';

function baseState(): SharedState {
    return {
        view: { longitude: 6.865432, latitude: 45.832611, zoom: 14.27, pitch: 52.3, bearing: 117.8 },
        baseLayer: 'plan',
        hillshadeEnabled: true,
        hillshadeSource: 'mnh',
        hillshadeBlend: 'multiply',
        hillshadeIntensity: 0.8,
        terrainEnabled: true,
        terrainExaggeration: 1.4,
        contourLinesEnabled: false,
        contourLinesOpacity: 0.5,
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

    it('produces a URL-safe payload (no +, /, or = characters)', () => {
        const encoded = encodeShareState(baseState());
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it('returns null for malformed input', () => {
        expect(decodeShareState('not-valid-base64-$$$')).toBeNull();
        expect(decodeShareState('')).toBeNull();
    });
});
