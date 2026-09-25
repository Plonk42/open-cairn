import type { HillshadeSource, MapView, TerrainDemSource } from '@/stores/mapStore';
import type { RouteMode, RouteWaypoint } from '@/stores/routeStore';
import type { BaseLayerId } from './baseLayers';
import type { BlendMode } from './compositeProtocol';
import type { LngLatTuple } from './geo';
import { formatSunDate, todaySunDatePart } from './sun';
import {
    clampNumber,
    VIEWPOINT_MAX_EYE_HEIGHT_M,
    VIEWPOINT_MAX_FOV,
    VIEWPOINT_MAX_PITCH,
    VIEWPOINT_MIN_EYE_HEIGHT_M,
    VIEWPOINT_MIN_FOV,
    VIEWPOINT_MIN_PITCH,
    type Viewpoint,
    type ViewpointFraming,
} from './viewpointCamera';

/**
 * Eye, look direction and lens of the first-person mode: `[lng, lat, altitude,
 * bearing, pitch, fovDeg, heightM]`.
 *
 * The MapLibre camera this produces is NOT serialised: its centre sits 4 km away
 * at an altitude unrelated to the relief, and the recipient's canvas has another
 * height, so replaying `center/zoom/elevation` would frame something else
 * entirely. Only the standpoint is portable — `cameraForViewpoint` rebuilds the
 * rest from it.
 */
type SerializedViewpoint = [number, number, number, number, number, number, number];

/** Compact serialisable representation of the full app state. */
interface SharePayload {
    v: 2;
    // Map view
    lng: number;
    lat: number;
    z: number;
    p: number;
    b: number;
    vp?: SerializedViewpoint;
    // Layers
    bl: BaseLayerId;
    tp: 0 | 1;
    hs: 0 | 1;
    hss: HillshadeSource;
    hsb: BlendMode;
    hsi: number;
    te: 0 | 1;
    tex: number;
    tds: TerrainDemSource;
    cl: 0 | 1;
    clo: number;
    // Sky, sun and moon
    sd: string;
    as: 0 | 1;
    sp: 0 | 1;
    mp: 0 | 1;
    hp: 0 | 1;
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

/** Standpoint of the "Point de vue" mode, when it was on at share time. */
export interface SharedViewpoint {
    eye: Viewpoint;
    framing: ViewpointFraming;
    /**
     * Height the eye holds above the ground. Travels on its own because the
     * recipient re-settles `eye.altitude` on the DEM it loads, which is not the
     * one the sharer saw — the absolute altitude alone would be flattened back
     * to the default on arrival.
     */
    heightM: number;
}

export interface SharedState {
    view: MapView;
    /** `null` when the sharer was not in the first-person mode. */
    viewpoint: SharedViewpoint | null;
    baseLayer: BaseLayerId;
    toponymsEnabled: boolean;
    hillshadeEnabled: boolean;
    hillshadeSource: HillshadeSource;
    hillshadeBlend: BlendMode;
    hillshadeIntensity: number;
    terrainEnabled: boolean;
    terrainExaggeration: number;
    terrainDemSource: TerrainDemSource;
    contourLinesEnabled: boolean;
    contourLinesOpacity: number;
    /** Naive "YYYY-MM-DDTHH:mm": drives the sky colour and both sky tracks. */
    sunDate: string;
    atmosphericSky: boolean;
    skySunPath: boolean;
    skyMoonPath: boolean;
    skyHiddenPath: boolean;
    routeActive: boolean;
    routeMode: RouteMode;
    colorElevationBySlope: boolean;
    waypoints: RouteWaypoint[];
    selectionRange: [number, number] | null;
}

/** Exhaustive by construction: a new DEM source will not compile until listed. */
const KNOWN_DEM_SOURCES: Record<TerrainDemSource, true> = { auto: true, ign: true, mapterhorn: true };

const SUN_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function round(n: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

function serializeViewpoint(vp: SharedViewpoint): SerializedViewpoint {
    return [
        round(vp.eye.lng, 6),
        round(vp.eye.lat, 6),
        round(vp.eye.altitude, 1),
        round(vp.framing.bearing, 1),
        round(vp.framing.pitch, 1),
        round(vp.framing.fovDeg, 2),
        round(vp.heightM, 1),
    ];
}

/**
 * Rebuild a standpoint from its tuple, clamped to the ranges the mode accepts.
 * A link forged with a pitch of 400° must land on a usable view, not on a camera
 * MapLibre refuses: there is no error boundary to catch the throw.
 */
function deserializeViewpoint(vp: SerializedViewpoint | undefined): SharedViewpoint | null {
    if (!Array.isArray(vp) || vp.length !== 7 || vp.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        return null;
    }
    const [lng, lat, altitude, bearing, pitch, fovDeg, heightM] = vp;
    return {
        eye: { lng, lat, altitude },
        framing: {
            bearing,
            pitch: clampNumber(pitch, VIEWPOINT_MIN_PITCH, VIEWPOINT_MAX_PITCH),
            fovDeg: clampNumber(fovDeg, VIEWPOINT_MIN_FOV, VIEWPOINT_MAX_FOV),
        },
        heightM: clampNumber(heightM, VIEWPOINT_MIN_EYE_HEIGHT_M, VIEWPOINT_MAX_EYE_HEIGHT_M),
    };
}

export function encodeShareState(state: SharedState): string {
    const payload: SharePayload = {
        v: 2,
        lng: round(state.view.longitude, 6),
        lat: round(state.view.latitude, 6),
        z: round(state.view.zoom, 2),
        p: round(state.view.pitch, 1),
        b: round(state.view.bearing, 1),
        vp: state.viewpoint ? serializeViewpoint(state.viewpoint) : undefined,
        bl: state.baseLayer,
        tp: state.toponymsEnabled ? 1 : 0,
        hs: state.hillshadeEnabled ? 1 : 0,
        hss: state.hillshadeSource,
        hsb: state.hillshadeBlend,
        hsi: round(state.hillshadeIntensity, 2),
        te: state.terrainEnabled ? 1 : 0,
        tex: round(state.terrainExaggeration, 2),
        tds: state.terrainDemSource,
        cl: state.contourLinesEnabled ? 1 : 0,
        clo: round(state.contourLinesOpacity, 2),
        sd: state.sunDate,
        as: state.atmosphericSky ? 1 : 0,
        sp: state.skySunPath ? 1 : 0,
        mp: state.skyMoonPath ? 1 : 0,
        hp: state.skyHiddenPath ? 1 : 0,
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
        if (p.v !== 2) return null;

        let wpId = 1;
        const waypoints: RouteWaypoint[] = p.wps.map((wp, i) => ({
            id: `wp-${wpId++}`,
            coordinate: wp.c,
            modeFromPrevious: i === 0 ? undefined : (wp.m ?? 'auto'),
        }));

        return {
            view: { longitude: p.lng, latitude: p.lat, zoom: p.z, pitch: p.p, bearing: p.b },
            viewpoint: deserializeViewpoint(p.vp),
            baseLayer: p.bl,
            toponymsEnabled: p.tp === 1,
            hillshadeEnabled: p.hs === 1,
            hillshadeSource: p.hss,
            hillshadeBlend: p.hsb,
            hillshadeIntensity: p.hsi,
            terrainEnabled: p.te === 1,
            terrainExaggeration: p.tex,
            terrainDemSource: KNOWN_DEM_SOURCES[p.tds] ? p.tds : 'auto',
            contourLinesEnabled: p.cl === 1,
            contourLinesOpacity: p.clo,
            sunDate: SUN_DATE_RE.test(p.sd) ? p.sd : formatSunDate(todaySunDatePart(), 12 * 60),
            atmosphericSky: p.as === 1,
            skySunPath: p.sp === 1,
            skyMoonPath: p.mp === 1,
            skyHiddenPath: p.hp === 1,
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
