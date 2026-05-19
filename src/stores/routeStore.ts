import { computeElevationProfile, type ElevationSample } from '@/lib/elevation';
import { interpolateAlongLine, sliceLineByDistance, type LngLatTuple } from '@/lib/geo';
import { buildStraightSegment, computeIgnWalkingSegment, mergeSegments, type RouteSegmentResult } from '@/lib/routing';
import { create } from 'zustand';

export type RouteMode = 'auto' | 'free';
export type RouteStatus = 'idle' | 'loading' | 'error';

export interface RouteWaypoint {
    id: string;
    coordinate: LngLatTuple;
    modeFromPrevious?: RouteMode;
}

export interface RouteSegment extends RouteSegmentResult {
    id: string;
    mode: RouteMode;
}

export interface RouteStats {
    distance: number;
    duration: number;
    ascent: number;
    descent: number;
}

interface RouteState {
    active: boolean;
    setActive: (active: boolean) => void;

    deleteMode: boolean;
    setDeleteMode: (deleteMode: boolean) => void;

    mode: RouteMode;
    setMode: (mode: RouteMode) => void;

    colorElevationBySlope: boolean;
    setColorElevationBySlope: (colorElevationBySlope: boolean) => void;

    waypoints: RouteWaypoint[];
    routeSegments: RouteSegment[];
    routeCoordinates: LngLatTuple[];
    profile: ElevationSample[];
    stats: RouteStats;
    status: RouteStatus;
    statusMessage: string | null;
    hoverDistance: number | null;
    hoverCoordinate: LngLatTuple | null;
    selectionRange: [number, number] | null;
    selectionCoordinates: LngLatTuple[];

    addWaypoint: (coordinate: LngLatTuple) => void;
    moveWaypoint: (id: string, coordinate: LngLatTuple, recalculate?: boolean) => void;
    reorderWaypoint: (id: string, newIndex: number) => void;
    setWaypointSegmentMode: (id: string, mode: RouteMode) => void;
    removeWaypoint: (id: string) => void;
    clearRoute: () => void;
    setHoverDistance: (distance: number | null) => void;
    setSelectionRange: (range: [number, number] | null) => void;
}

const EMPTY_STATS: RouteStats = { distance: 0, duration: 0, ascent: 0, descent: 0 };
let nextWaypointId = 1;
let currentAbortController: AbortController | null = null;
let currentRevision = 0;

function waypointId(): string {
    const id = `wp-${nextWaypointId}`;
    nextWaypointId += 1;
    return id;
}

function buildDraftStraightRoute(waypoints: RouteWaypoint[]): RouteSegmentResult {
    const segments = buildDraftSegments(waypoints);
    return mergeSegments(segments);
}

function segmentModeForWaypoint(waypoint: RouteWaypoint): RouteMode {
    return waypoint.modeFromPrevious ?? 'auto';
}

function buildDraftSegments(waypoints: RouteWaypoint[]): RouteSegment[] {
    const segments: RouteSegment[] = [];
    for (let i = 1; i < waypoints.length; i += 1) {
        const mode = segmentModeForWaypoint(waypoints[i]);
        segments.push({
            ...buildStraightSegment(waypoints[i - 1].coordinate, waypoints[i].coordinate),
            id: `${waypoints[i - 1].id}-${waypoints[i].id}`,
            mode,
        });
    }
    return segments;
}

async function buildRoute(waypoints: RouteWaypoint[], signal: AbortSignal): Promise<{ segments: RouteSegment[]; result: RouteSegmentResult; degraded: boolean }> {
    if (waypoints.length < 2) return { segments: [], result: { coordinates: [], distance: 0, duration: 0 }, degraded: false };

    const segments: RouteSegment[] = [];
    let degraded = false;
    for (let i = 1; i < waypoints.length; i += 1) {
        const start = waypoints[i - 1].coordinate;
        const end = waypoints[i].coordinate;
        const mode = segmentModeForWaypoint(waypoints[i]);
        const id = `${waypoints[i - 1].id}-${waypoints[i].id}`;
        if (mode === 'free') {
            segments.push({ ...buildStraightSegment(start, end), id, mode });
            continue;
        }
        try {
            segments.push({ ...await computeIgnWalkingSegment(start, end, signal), id, mode });
        } catch (error) {
            if (signal.aborted) throw error;
            degraded = true;
            segments.push({ ...buildStraightSegment(start, end), id, mode });
        }
    }
    return { segments, result: mergeSegments(segments), degraded };
}

function normalizeWaypoints(waypoints: RouteWaypoint[]): RouteWaypoint[] {
    return waypoints.map((waypoint, index) => index === 0 ? { ...waypoint, modeFromPrevious: undefined } : waypoint);
}

function recomputeRoute(get: () => RouteState, set: (partial: Partial<RouteState>) => void): void {
    currentAbortController?.abort();
    const revision = currentRevision + 1;
    currentRevision = revision;
    const abortController = new AbortController();
    currentAbortController = abortController;

    const { waypoints, mode } = get();
    if (waypoints.length < 2) {
        set({
            routeSegments: [],
            routeCoordinates: [],
            profile: [],
            stats: EMPTY_STATS,
            status: 'idle',
            statusMessage: null,
            hoverDistance: null,
            hoverCoordinate: null,
        });
        return;
    }

    const draft = buildDraftStraightRoute(waypoints);
    const draftSegments = buildDraftSegments(waypoints);
    set({
        routeSegments: draftSegments,
        routeCoordinates: draft.coordinates,
        stats: { ...EMPTY_STATS, distance: draft.distance, duration: draft.duration },
        status: 'loading',
        statusMessage: mode === 'auto' ? 'Calcul IGN en cours' : 'Profil en cours',
    });

    void (async () => {
        try {
            const { segments, result, degraded } = await buildRoute(waypoints, abortController.signal);
            let profile: ElevationSample[] = [];
            let ascent = 0;
            let descent = 0;
            try {
                const elevation = await computeElevationProfile(result.coordinates, abortController.signal);
                profile = elevation.samples;
                ascent = elevation.ascent;
                descent = elevation.descent;
            } catch (error) {
                if (abortController.signal.aborted) throw error;
            }
            if (revision !== currentRevision) return;
            const hoverDistance = get().hoverDistance;
            set({
                routeSegments: segments,
                routeCoordinates: result.coordinates,
                profile,
                stats: {
                    distance: result.distance,
                    duration: result.duration,
                    ascent,
                    descent,
                },
                status: degraded ? 'error' : 'idle',
                statusMessage: degraded ? 'Certaines portions sont tracées en ligne droite' : null,
                hoverCoordinate: hoverDistance === null ? null : interpolateAlongLine(result.coordinates, hoverDistance),
            });
        } catch (error) {
            if (abortController.signal.aborted || revision !== currentRevision) return;
            if (import.meta.env.DEV) console.debug(error);
            set({ status: 'error', statusMessage: 'Calcul indisponible' });
        }
    })();
}

export const useRouteStore = create<RouteState>((set, get) => ({
    active: true,
    setActive: (active) => set({ active, deleteMode: active ? get().deleteMode : false }),

    deleteMode: false,
    setDeleteMode: (deleteMode) => set({ deleteMode, active: deleteMode ? true : get().active }),

    mode: 'auto',
    setMode: (mode) => set({ mode }),

    colorElevationBySlope: false,
    setColorElevationBySlope: (colorElevationBySlope) => set({ colorElevationBySlope }),

    waypoints: [],
    routeSegments: [],
    routeCoordinates: [],
    profile: [],
    stats: EMPTY_STATS,
    status: 'idle',
    statusMessage: null,
    hoverDistance: null,
    hoverCoordinate: null,
    selectionRange: null,
    selectionCoordinates: [],

    addWaypoint: (coordinate) => {
        set((state) => ({
            waypoints: [...state.waypoints, {
                id: waypointId(),
                coordinate,
                modeFromPrevious: state.waypoints.length === 0 ? undefined : state.mode,
            }],
        }));
        recomputeRoute(get, set);
    },

    moveWaypoint: (id, coordinate, recalculate = true) => {
        set((state) => {
            const waypoints = state.waypoints.map((waypoint) => waypoint.id === id ? { ...waypoint, coordinate } : waypoint);
            const routeSegments = buildDraftSegments(waypoints);
            const draft = waypoints.length > 1 ? mergeSegments(routeSegments) : { coordinates: [], distance: 0, duration: 0 };
            return {
                waypoints,
                routeSegments,
                routeCoordinates: draft.coordinates,
                stats: recalculate ? state.stats : { ...state.stats, distance: draft.distance, duration: draft.duration },
                hoverCoordinate: state.hoverDistance === null ? null : interpolateAlongLine(draft.coordinates, state.hoverDistance),
            };
        });
        if (recalculate) recomputeRoute(get, set);
    },

    reorderWaypoint: (id, newIndex) => {
        set((state) => {
            const oldIndex = state.waypoints.findIndex((w) => w.id === id);
            if (oldIndex === -1 || oldIndex === newIndex) return state;
            const waypoints = [...state.waypoints];
            const [moved] = waypoints.splice(oldIndex, 1);
            waypoints.splice(newIndex, 0, moved);
            return { waypoints: normalizeWaypoints(waypoints) };
        });
        recomputeRoute(get, set);
    },

    setWaypointSegmentMode: (id, mode) => {
        set((state) => ({
            waypoints: normalizeWaypoints(state.waypoints.map((waypoint) => waypoint.id === id ? { ...waypoint, modeFromPrevious: mode } : waypoint)),
        }));
        recomputeRoute(get, set);
    },

    removeWaypoint: (id) => {
        set((state) => ({ waypoints: normalizeWaypoints(state.waypoints.filter((waypoint) => waypoint.id !== id)) }));
        recomputeRoute(get, set);
    },

    clearRoute: () => {
        currentAbortController?.abort();
        currentRevision += 1;
        set({
            waypoints: [],
            routeSegments: [],
            routeCoordinates: [],
            profile: [],
            stats: EMPTY_STATS,
            status: 'idle',
            statusMessage: null,
            hoverDistance: null,
            hoverCoordinate: null,
            selectionRange: null,
            selectionCoordinates: [],
            deleteMode: false,
        });
    },

    setHoverDistance: (distance) => {
        const routeCoordinates = get().routeCoordinates;
        const coord = distance === null ? null : interpolateAlongLine(routeCoordinates, distance);
        console.log('[HOVER 2] store setHoverDistance', { distance, coord, coordsLen: routeCoordinates.length });
        set({
            hoverDistance: distance,
            hoverCoordinate: coord,
        });
    },

    setSelectionRange: (range) => {
        const routeCoordinates = get().routeCoordinates;
        if (!range || Math.abs(range[1] - range[0]) < 1) {
            set({ selectionRange: null, selectionCoordinates: [] });
            return;
        }
        const start = Math.min(range[0], range[1]);
        const end = Math.max(range[0], range[1]);
        set({
            selectionRange: [start, end],
            selectionCoordinates: sliceLineByDistance(routeCoordinates, start, end),
        });
    },
}));