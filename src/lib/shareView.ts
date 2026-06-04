import type { CliffStation } from './cliffSlice';
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
    // Cliff slice (all optional — only present when a slice has been drawn)
    cs?: [number, number][];
    cw?: number;
    cc?: number[];
    cClass?: 0 | 1;
    cDepth?: 0 | 1;
    crs?: number;
    cst?: SerializedStation[];
}

interface SerializedWaypoint {
    c: LngLatTuple;
    m?: RouteMode;
}

/** Tuple form: [d, e] or [d, e, label]. */
type SerializedStation = [number, number] | [number, number, string];

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
    // Cliff slice
    cliffSlicePoints: LngLatTuple[];
    cliffSliceCorridor: number;
    cliffSliceClasses: number[];
    cliffSliceColorClass: boolean;
    cliffSliceColorDepth: boolean;
    cliffSliceRopeSafety: number;
    cliffSliceStations: CliffStation[];
}

function round(n: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

/** Mutates `payload` to attach optional cliff-slice fields (only when a slice exists). */
function attachCliffPayload(payload: SharePayload, state: SharedState): void {
    if (state.cliffSlicePoints.length === 0) return;
    payload.cs = state.cliffSlicePoints.map((p) => [round(p[0], 6), round(p[1], 6)]);
    payload.cw = round(state.cliffSliceCorridor, 1);
    if (state.cliffSliceClasses.length > 0) payload.cc = [...state.cliffSliceClasses];
    if (state.cliffSliceColorClass) payload.cClass = 1;
    if (state.cliffSliceColorDepth) payload.cDepth = 1;
    payload.crs = round(state.cliffSliceRopeSafety, 2);
    if (state.cliffSliceStations.length > 0) {
        payload.cst = state.cliffSliceStations.map((st) => {
            const d = round(st.d, 1);
            const e = round(st.e, 1);
            return st.label ? [d, e, st.label] : [d, e];
        });
    }
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

    attachCliffPayload(payload, state);

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

        let stId = 1;
        const cliffSliceStations: CliffStation[] = (p.cst ?? []).map((s) => {
            const station: CliffStation = { id: `s-${stId++}`, d: s[0], e: s[1] };
            if (s.length > 2 && typeof s[2] === 'string') station.label = s[2];
            return station;
        });

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
            cliffSlicePoints: p.cs ?? [],
            cliffSliceCorridor: p.cw ?? 2,
            cliffSliceClasses: p.cc ?? [],
            cliffSliceColorClass: p.cClass === 1,
            cliffSliceColorDepth: p.cDepth === 1,
            cliffSliceRopeSafety: p.crs ?? 0.15,
            cliffSliceStations,
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
