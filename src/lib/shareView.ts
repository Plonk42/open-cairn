import type { HillshadeSource, MapView } from '@/stores/mapStore';
import type { RouteMode, RouteWaypoint } from '@/stores/routeStore';
import type { BlendMode } from './compositeProtocol';
import type { LngLatTuple } from './geo';
import type { BaseLayerId } from './mapStyle';

/** Compact serialisable representation of the full app state. */
interface SharePayload {
    v: 1;
    // Map view
    lng: number;
    lat: number;
    z: number;
    p: number;
    b: number;
    // Layers
    bl: BaseLayerId;
    hs: 0 | 1;
    hss: HillshadeSource;
    hsb: BlendMode;
    hsi: number;
    te: 0 | 1;
    tex: number;
    cl: 0 | 1;
    clo: number;
    // Route
    ra: 0 | 1;
    rm: RouteMode;
    ces: 0 | 1;
    wps: SerializedWaypoint[];
    sel?: [number, number];
}

interface SerializedWaypoint {
    c: LngLatTuple;
    m?: RouteMode;
}

export interface SharedState {
    view: MapView;
    baseLayer: BaseLayerId;
    hillshadeEnabled: boolean;
    hillshadeSource: HillshadeSource;
    hillshadeBlend: BlendMode;
    hillshadeIntensity: number;
    terrainEnabled: boolean;
    terrainExaggeration: number;
    contourLinesEnabled: boolean;
    contourLinesOpacity: number;
    routeActive: boolean;
    routeMode: RouteMode;
    colorElevationBySlope: boolean;
    waypoints: RouteWaypoint[];
    selectionRange: [number, number] | null;
}

function round(n: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

export function encodeShareState(state: SharedState): string {
    const payload: SharePayload = {
        v: 1,
        lng: round(state.view.longitude, 6),
        lat: round(state.view.latitude, 6),
        z: round(state.view.zoom, 2),
        p: round(state.view.pitch, 1),
        b: round(state.view.bearing, 1),
        bl: state.baseLayer,
        hs: state.hillshadeEnabled ? 1 : 0,
        hss: state.hillshadeSource,
        hsb: state.hillshadeBlend,
        hsi: round(state.hillshadeIntensity, 2),
        te: state.terrainEnabled ? 1 : 0,
        tex: round(state.terrainExaggeration, 2),
        cl: state.contourLinesEnabled ? 1 : 0,
        clo: round(state.contourLinesOpacity, 2),
        ra: state.routeActive ? 1 : 0,
        rm: state.routeMode,
        ces: state.colorElevationBySlope ? 1 : 0,
        wps: state.waypoints.map((wp) => {
            const s: SerializedWaypoint = { c: [round(wp.coordinate[0], 6), round(wp.coordinate[1], 6)] };
            if (wp.modeFromPrevious) s.m = wp.modeFromPrevious;
            return s;
        }),
        sel: state.selectionRange ? [round(state.selectionRange[0], 1), round(state.selectionRange[1], 1)] : undefined,
    };

    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) binary += String.fromCodePoint(byte);
    const encoded = btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
    return encoded;
}

export function decodeShareState(hash: string): SharedState | null {
    try {
        const base64 = hash.replaceAll('-', '+').replaceAll('_', '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (c) => c.codePointAt(0) ?? 0);
        const json = new TextDecoder().decode(bytes);
        const p: SharePayload = JSON.parse(json);
        if (p.v !== 1) return null;

        let wpId = 1;
        const waypoints: RouteWaypoint[] = p.wps.map((wp, i) => ({
            id: `wp-${wpId++}`,
            coordinate: wp.c,
            modeFromPrevious: i === 0 ? undefined : (wp.m ?? 'auto'),
        }));

        return {
            view: { longitude: p.lng, latitude: p.lat, zoom: p.z, pitch: p.p, bearing: p.b },
            baseLayer: p.bl,
            hillshadeEnabled: p.hs === 1,
            hillshadeSource: p.hss,
            hillshadeBlend: p.hsb,
            hillshadeIntensity: p.hsi,
            terrainEnabled: p.te === 1,
            terrainExaggeration: p.tex,
            contourLinesEnabled: p.cl === 1,
            contourLinesOpacity: p.clo,
            routeActive: p.ra === 1,
            routeMode: p.rm,
            colorElevationBySlope: p.ces === 1,
            waypoints,
            selectionRange: p.sel ?? null,
        };
    } catch {
        return null;
    }
}

export function buildShareUrl(state: SharedState): string {
    const base = globalThis.location.origin + globalThis.location.pathname;
    return `${base}#share=${encodeShareState(state)}`;
}

export function parseShareFromUrl(): SharedState | null {
    const hash = globalThis.location.hash;
    if (!hash.startsWith('#share=')) return null;
    return decodeShareState(hash.slice('#share='.length));
}
