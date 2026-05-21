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

function normalizeWaypoints(waypoints: RouteWaypoint[]): RouteWaypoint[] {
    return waypoints.map((waypoint, index) => index === 0 ? { ...waypoint, modeFromPrevious: undefined } : waypoint);
}

async function computeSegment(waypoints: RouteWaypoint[], segmentIndex: number, signal: AbortSignal): Promise<{ segment: RouteSegment; degraded: boolean }> {
    const start = waypoints[segmentIndex].coordinate;
    const end = waypoints[segmentIndex + 1].coordinate;
    const mode = segmentModeForWaypoint(waypoints[segmentIndex + 1]);
    const id = `${waypoints[segmentIndex].id}-${waypoints[segmentIndex + 1].id}`;

    if (mode === 'free') {
        return { segment: { ...buildStraightSegment(start, end), id, mode }, degraded: false };
    }
    try {
        return { segment: { ...await computeIgnWalkingSegment(start, end, signal), id, mode }, degraded: false };
    } catch (error) {
        if (signal.aborted) throw error;
        return { segment: { ...buildStraightSegment(start, end), id, mode }, degraded: true };
    }
}

function recomputeRoute(get: () => RouteState, set: (partial: Partial<RouteState>) => void, affectedIndices?: number[]): void {
    currentAbortController?.abort();
    const revision = currentRevision + 1;
    currentRevision = revision;
    const abortController = new AbortController();
    currentAbortController = abortController;

    const { waypoints, mode, routeSegments: existingSegments } = get();
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

    const totalSegments = waypoints.length - 1;
    const indicesToCompute = affectedIndices
        ? affectedIndices.filter((i) => i >= 0 && i < totalSegments)
        : Array.from({ length: totalSegments }, (_, i) => i);
    const indicesToComputeSet = new Set(indicesToCompute);

    const draftSegments = buildDraftSegments(waypoints);
    // For unchanged segments, keep previously computed segments; for affected ones, show draft
    const initialSegments: RouteSegment[] = draftSegments.map((draft, i) =>
        !indicesToComputeSet.has(i) && existingSegments[i] ? existingSegments[i] : draft
    );
    const initialMerged = mergeSegments(initialSegments);
    set({
        routeSegments: initialSegments,
        routeCoordinates: initialMerged.coordinates,
        stats: { ...EMPTY_STATS, distance: initialMerged.distance, duration: initialMerged.duration },
        status: 'loading',
        statusMessage: mode === 'auto' ? 'Calcul IGN en cours' : 'Profil en cours',
    });

    void (async () => {
        try {
            // Start from existing computed segments for unchanged indices
            const segments: RouteSegment[] = new Array(totalSegments);
            let degraded = false;
            for (let i = 0; i < totalSegments; i++) {
                if (!indicesToComputeSet.has(i) && existingSegments[i]) {
                    segments[i] = existingSegments[i];
                }
            }
            // Compute only the affected segments
            for (const i of indicesToCompute) {
                const res = await computeSegment(waypoints, i, abortController.signal);
                segments[i] = res.segment;
                if (res.degraded) degraded = true;
            }

            const result = mergeSegments(segments);
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
        const prevLength = get().waypoints.length;
        set((state) => ({
            waypoints: [...state.waypoints, {
                id: waypointId(),
                coordinate,
                modeFromPrevious: state.waypoints.length === 0 ? undefined : state.mode,
            }],
        }));
        // Only compute the new last segment
        recomputeRoute(get, set, prevLength >= 1 ? [prevLength - 1] : undefined);
    },

    moveWaypoint: (id, coordinate, recalculate = true) => {
        const waypointIndex = get().waypoints.findIndex((w) => w.id === id);
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
        if (recalculate) {
            // Only recompute segments adjacent to the moved waypoint
            const affected: number[] = [];
            if (waypointIndex > 0) affected.push(waypointIndex - 1);
            if (waypointIndex >= 0 && waypointIndex < get().waypoints.length - 1) affected.push(waypointIndex);
            recomputeRoute(get, set, affected.length > 0 ? affected : undefined);
        }
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
        const waypointIndex = get().waypoints.findIndex((w) => w.id === id);
        set((state) => ({
            waypoints: normalizeWaypoints(state.waypoints.map((waypoint) => waypoint.id === id ? { ...waypoint, modeFromPrevious: mode } : waypoint)),
        }));
        // Only recompute the segment ending at this waypoint
        recomputeRoute(get, set, waypointIndex > 0 ? [waypointIndex - 1] : undefined);
    },

    removeWaypoint: (id) => {
        const waypointIndex = get().waypoints.findIndex((w) => w.id === id);
        set((state) => ({ waypoints: normalizeWaypoints(state.waypoints.filter((waypoint) => waypoint.id !== id)) }));
        // After removal, the segment at (waypointIndex - 1) now bridges the neighbors
        const newWaypoints = get().waypoints;
        const affected: number[] = [];
        if (waypointIndex > 0 && newWaypoints.length > 1) affected.push(waypointIndex - 1);
        recomputeRoute(get, set, affected.length > 0 ? affected : undefined);
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