import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeShareState, parseViewpointHash } from '@/lib/shareView';
import { useShare } from '@/lib/useShare';
import { VIEWPOINT_EYE_HEIGHT_M } from '@/lib/viewpointCamera';
import { useMapStore } from '@/stores/mapStore';
import { ViewpointController } from './ViewpointController';

const markerPosition = vi.hoisted(() => vi.fn());

vi.mock('maplibre-gl', async (importOriginal) => ({
    ...await importOriginal<typeof import('maplibre-gl')>(),
    Marker: class {
        private readonly element = document.createElement('div');
        setLngLat(position: [number, number]) { markerPosition(position); return this; }
        addTo() { return this; }
        getElement() { return this.element; }
        remove() { }
    },
}));

vi.mock('@/lib/freeCamera', () => ({
    isTextEntry: () => false,
    setTerrainCameraCollision: vi.fn(),
}));

vi.mock('@/lib/panoramaDetail', () => ({
    applyPanoramaDetail: () => vi.fn(),
    applyViewpointNearPlane: () => ({ refresh: vi.fn(), restore: vi.fn() }),
}));

vi.mock('@/lib/skyProjection', () => ({
    loadedDemSampler: () => (lng: number) => 1000 + (lng - 5.778) * 10_000,
    renderedGroundSampler: () => () => Number.NaN,
}));

function fakeMap() {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientHeight', { value: 844 });
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const on = (name: string, callback: (event: unknown) => void) => {
        const callbacks = listeners.get(name) ?? new Set();
        callbacks.add(callback);
        listeners.set(name, callbacks);
    };
    const off = (name: string, callback: (event: unknown) => void) => {
        listeners.get(name)?.delete(callback);
    };
    const fire = (name: string, event: unknown = {}) => {
        for (const callback of [...(listeners.get(name) ?? [])]) callback(event);
    };
    const handler = () => ({ isEnabled: () => true, disable: vi.fn(), enable: vi.fn() });
    const map = {
        getCanvas: () => canvas,
        getCenter: () => ({ lng: 5.778, lat: 45.275 }),
        getZoom: () => 12,
        getBearing: () => -20,
        getPitch: () => 85,
        getVerticalFieldOfView: () => 37,
        setVerticalFieldOfView: vi.fn(),
        getCenterClampedToGround: () => true,
        setCenterClampedToGround: vi.fn(),
        setMaxPitch: vi.fn(),
        queryTerrainElevation: () => 1000,
        jumpTo: vi.fn(),
        dragPan: handler(), dragRotate: handler(), scrollZoom: handler(),
        doubleClickZoom: handler(), keyboard: handler(), touchZoomRotate: handler(),
        painter: { transform: {
            getCameraLngLat: () => ({ lng: 5.778, lat: 45.275 }),
            getCameraAltitude: () => 1010,
        } },
        terrain: { tileManager: { maxzoom: 17 } },
        _hash: { getHashString: () => '' },
        on, off, fire,
        once: (name: string, callback: (event: unknown) => void) => {
            const once = (event: unknown) => { off(name, once); callback(event); };
            on(name, once);
        },
    };
    return { map: map as unknown as MapLibreMap, fire, jumps: map.jumpTo, hash: map._hash };
}

describe('the corrected viewpoint eye', () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    beforeEach(() => {
        markerPosition.mockClear();
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        useMapStore.setState(useMapStore.getInitialState(), true);
    });

    afterEach(() => {
        cleanup();
        useMapStore.setState(useMapStore.getInitialState(), true);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('shares the finer-DEM snap without restarting the mode, and retains it when changing place', () => {
        const { map, fire, jumps, hash } = fakeMap();
        useMapStore.setState({ mapInstance: map, viewpointPicking: true });
        render(createElement(ViewpointController));
        act(() => fire('click', { lngLat: { lng: 5.778, lat: 45.275 } }));
        const entry = useMapStore.getState().viewpoint;
        act(() => useMapStore.getState().setViewpointHeightM(25));
        const beforeSnap = jumps.mock.calls.length;
        act(() => fire('idle'));

        const state = useMapStore.getState();
        expect(state.viewpoint).toBe(entry);
        expect(state.viewpointHeightM).toBe(25);
        expect(state.viewpointEye?.lng).toBeGreaterThan(entry!.lng);
        expect(state.viewpointEye?.altitude).toBeGreaterThan(entry!.altitude);
        expect(jumps.mock.calls).toHaveLength(beforeSnap + 1);

        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const { result } = renderHook(() => useShare());
        act(() => result.current.handleShare());
        const url = new URL(writeText.mock.calls[0][0] as string);
        const shared = decodeShareState(url.hash.slice('#share='.length));
        const address = parseViewpointHash(hash.getHashString());
        expect(shared?.viewpoint).toEqual(address);
        expect(shared?.viewpoint?.eye.lng).toBeCloseTo(state.viewpointEye!.lng, 6);

        const corrected = state.viewpointEye;
        act(() => useMapStore.getState().changeViewpointPlace());
        expect(useMapStore.getState().viewpointLeftBehind).toEqual(corrected);
        expect(useMapStore.getState().viewpointEye).toBeNull();
        expect(markerPosition).toHaveBeenCalledWith([corrected!.lng, corrected!.lat]);
    });

    it('publishes height changes without changing the entry or its framing', () => {
        const { map } = fakeMap();
        const entry = { lng: 5.778, lat: 45.275, altitude: 1010 };
        const framing = { bearing: -20, pitch: 85, fovDeg: 37 };
        useMapStore.getState().setViewpoint(entry);
        useMapStore.getState().setViewpointFraming(framing);
        useMapStore.setState({ mapInstance: map });
        render(createElement(ViewpointController));
        act(() => useMapStore.getState().setViewpointHeightM(30));
        const state = useMapStore.getState();
        expect(state.viewpoint).toBe(entry);
        expect(state.viewpointFraming).toBe(framing);
        expect(state.viewpointEye).toEqual({ ...entry, altitude: 1030 });
    });

    it('ignores identical eye publications and clears the eye on exit or a new entry', () => {
        const entry = { lng: 5.778, lat: 45.275, altitude: 1010 };
        useMapStore.getState().setViewpoint(entry);
        const notify = vi.fn();
        const unsubscribe = useMapStore.subscribe(notify);
        useMapStore.getState().setViewpointEye({ ...entry });
        expect(notify).not.toHaveBeenCalled();
        unsubscribe();
        useMapStore.getState().setViewpointEye({ ...entry, altitude: 1030 });
        useMapStore.getState().setViewpoint(null);
        useMapStore.getState().setViewpointEye(entry);
        expect(useMapStore.getState().viewpointEye).toBeNull();
        useMapStore.getState().setViewpoint(entry);
        expect(useMapStore.getState().viewpointEye).toBe(entry);
        expect(useMapStore.getState().viewpointHeightM).toBe(VIEWPOINT_EYE_HEIGHT_M);
    });
});