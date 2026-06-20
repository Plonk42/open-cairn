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
        cliffSlicePoints: [],
        cliffSliceCorridor: 2,
        cliffSliceClasses: [],
        cliffSliceColorClass: false,
        cliffSliceColorDepth: false,
        cliffSliceRopeSafety: 0.15,
        cliffSliceStations: [],
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

    it('round-trips cliff-slice geometry, stations and flags', () => {
        const state = baseState();
        state.cliffSlicePoints = [[6.861, 45.831], [6.862, 45.832]];
        state.cliffSliceCorridor = 3.5;
        state.cliffSliceClasses = [2, 6];
        state.cliffSliceColorClass = true;
        state.cliffSliceColorDepth = true;
        state.cliffSliceRopeSafety = 0.2;
        state.cliffSliceStations = [
            { id: 's-1', d: 0, e: 1000 },
            { id: 's-2', d: 25.4, e: 1042.8, label: 'R1' },
        ];
        const decoded = decodeShareState(encodeShareState(state))!;
        expect(decoded.cliffSlicePoints).toHaveLength(2);
        expect(decoded.cliffSlicePoints[0][0]).toBeCloseTo(6.861, 6);
        expect(decoded.cliffSliceCorridor).toBeCloseTo(3.5, 1);
        expect(decoded.cliffSliceClasses).toEqual([2, 6]);
        expect(decoded.cliffSliceColorClass).toBe(true);
        expect(decoded.cliffSliceColorDepth).toBe(true);
        expect(decoded.cliffSliceRopeSafety).toBeCloseTo(0.2, 2);
        expect(decoded.cliffSliceStations).toHaveLength(2);
        expect(decoded.cliffSliceStations[1].label).toBe('R1');
        expect(decoded.cliffSliceStations[1].d).toBeCloseTo(25.4, 1);
    });

    it('applies defaults for omitted optional cliff-slice fields', () => {
        const decoded = decodeShareState(encodeShareState(baseState()))!;
        expect(decoded.cliffSlicePoints).toEqual([]);
        expect(decoded.cliffSliceCorridor).toBe(2);
        expect(decoded.cliffSliceClasses).toEqual([]);
        expect(decoded.cliffSliceRopeSafety).toBe(0.15);
        expect(decoded.cliffSliceStations).toEqual([]);
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
