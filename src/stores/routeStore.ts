import { computeElevationProfile, type ElevationSample } from '@/lib/elevation';
import { distanceMeters, interpolateAlongLine, sliceLineByDistance, type LngLatTuple } from '@/lib/geo';
import { buildStraightSegment, computeIgnWalkingSegment, mergeSegments, type RouteSegmentResult } from '@/lib/routing';
import { create } from 'zustand';

export type RouteMode = 'auto' | 'free';
export type RouteStatus = 'idle' | 'loading' | 'error';

const ROUTE_STORAGE_KEY = 'open-cairn-route';

type PersistedRoute = {
    waypoints?: RouteWaypoint[];
    active?: boolean;
    mode?: RouteMode;
    colorElevationBySlope?: boolean;
    gpxImportWaypoints?: number;
    selectionRange?: [number, number] | null;
};

function loadPersistedRoute(): PersistedRoute {
    try {
        const raw = localStorage.getItem(ROUTE_STORAGE_KEY);
        if (raw) return JSON.parse(raw) as PersistedRoute;
    } catch { /* ignore */ }
    return {};
}

function savePersistedRoute(route: PersistedRoute): void {
    try {
        localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
    } catch { /* ignore */ }
}

export { loadPersistedRoute };

export interface RouteWaypoint {
    id: string;
    coordinate: LngLatTuple;
    modeFromPrevious?: RouteMode;
    name?: string;
}

export interface RouteSegment extends RouteSegmentResult {
    id: string;
    mode: RouteMode;
    /** Whether the first coordinate is a snap (waypoint → route start) */
    hasSnapStart: boolean;
    /** Whether the last coordinate is a snap (route end → waypoint) */
    hasSnapEnd: boolean;
    /** Whether this segment has been fully computed (false = draft/straight line) */
    computed: boolean;
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

    gpxImportWaypoints: number;
    setGpxImportWaypoints: (count: number) => void;

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
    renameWaypoint: (id: string, name: string) => void;
    removeWaypoint: (id: string) => void;
    restoreWaypoints: (waypoints: RouteWaypoint[]) => void;
    /** Import a route with pre-computed segments (e.g. from GPX track data). */
    importRoute: (waypoints: RouteWaypoint[], segments: RouteSegment[]) => void;
    reverseRoute: () => void;
    clearRoute: () => void;
    setHoverDistance: (distance: number | null) => void;
    setSelectionRange: (range: [number, number] | null) => void;
}

const EMPTY_STATS: RouteStats = { distance: 0, duration: 0, ascent: 0, descent: 0 };
let nextWaypointId = 1;
let currentAbortController: AbortController | null = null;
let currentRevision = 0;

const persistedRoute = loadPersistedRoute();

// Initialise le compteur d'ID waypoints pour éviter les collisions après restauration
if (persistedRoute.waypoints && persistedRoute.waypoints.length > 0) {
    const maxId = persistedRoute.waypoints.reduce((max, wp) => {
        const n = Number.parseInt(wp.id.replace('wp-', ''), 10);
        return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextWaypointId = maxId + 1;
}

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
            hasSnapStart: false,
            hasSnapEnd: false,
            computed: false,
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
        return { segment: { ...buildStraightSegment(start, end), id, mode, hasSnapStart: false, hasSnapEnd: false, computed: true }, degraded: false };
    }
    try {
        const result = await computeIgnWalkingSegment(start, end, signal);
        // Include snap portions (waypoint → route start, route end → waypoint)
        // so elevation profile and distance account for the full path.
        const coords = result.coordinates;
        const segStart = coords[0];
        const segEnd = coords.at(-1)!;
        let fullCoords = coords;
        let extraDist = 0;
        let hasSnapStart = false;
        let hasSnapEnd = false;
        if (distanceMeters(start, segStart) > 1) {
            fullCoords = [start, ...fullCoords];
            extraDist += distanceMeters(start, segStart);
            hasSnapStart = true;
        }
        if (distanceMeters(end, segEnd) > 1) {
            fullCoords = [...fullCoords, end];
            extraDist += distanceMeters(segEnd, end);
            hasSnapEnd = true;
        }
        return {
            segment: {
                coordinates: fullCoords,
                distance: result.distance + extraDist,
                duration: result.duration + extraDist / (4 / 3.6),
                id,
                mode,
                hasSnapStart,
                hasSnapEnd,
                computed: true,
            },
            degraded: false,
        };
    } catch (error) {
        if (signal.aborted) throw error;
        return { segment: { ...buildStraightSegment(start, end), id, mode, hasSnapStart: false, hasSnapEnd: false, computed: true }, degraded: true };
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
    const requestedIndices = affectedIndices
        ? affectedIndices.filter((i) => i >= 0 && i < totalSegments)
        : Array.from({ length: totalSegments }, (_, i) => i);
    // Also include any segments that were never fully computed (aborted previous run)
    const indicesToCompute = [...new Set([
        ...requestedIndices,
        ...existingSegments
            .map((seg, i) => (!seg.computed && i < totalSegments) ? i : -1)
            .filter((i) => i >= 0),
    ])];
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
            const selectionRange = get().selectionRange;
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
                selectionCoordinates: selectionRange ? sliceLineByDistance(result.coordinates, Math.min(selectionRange[0], selectionRange[1]), Math.max(selectionRange[0], selectionRange[1])) : get().selectionCoordinates,
            });
        } catch (error) {
            if (abortController.signal.aborted || revision !== currentRevision) return;
            if (import.meta.env.DEV) console.debug(error);
            set({ status: 'error', statusMessage: 'Calcul indisponible' });
        }
    })();
}

export const useRouteStore = create<RouteState>((set, get) => ({
    active: persistedRoute.active ?? true,
    setActive: (active) => set({ active, deleteMode: active ? get().deleteMode : false }),

    deleteMode: false,
    setDeleteMode: (deleteMode) => set({ deleteMode, active: deleteMode ? true : get().active }),

    mode: persistedRoute.mode ?? 'auto',
    setMode: (mode) => set({ mode }),

    colorElevationBySlope: persistedRoute.colorElevationBySlope ?? false,
    setColorElevationBySlope: (colorElevationBySlope) => set({ colorElevationBySlope }),

    gpxImportWaypoints: persistedRoute.gpxImportWaypoints ?? 8,
    setGpxImportWaypoints: (gpxImportWaypoints) => set({ gpxImportWaypoints }),

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
            // Only rebuild adjacent segments as straight lines; keep existing computed segments for the rest
            const affectedIndices = new Set<number>();
            if (waypointIndex > 0) affectedIndices.add(waypointIndex - 1);
            if (waypointIndex < waypoints.length - 1) affectedIndices.add(waypointIndex);
            const routeSegments = state.routeSegments.map((seg, i) => {
                if (!affectedIndices.has(i)) return seg;
                return {
                    ...buildStraightSegment(waypoints[i].coordinate, waypoints[i + 1].coordinate),
                    id: `${waypoints[i].id}-${waypoints[i + 1].id}`,
                    mode: segmentModeForWaypoint(waypoints[i + 1]),
                    hasSnapStart: false,
                    hasSnapEnd: false,
                    computed: false,
                };
            });
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

    renameWaypoint: (id, name) => {
        set((state) => ({
            waypoints: state.waypoints.map((wp) => wp.id === id ? { ...wp, name: name || undefined } : wp),
        }));
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

    restoreWaypoints: (waypoints) => {
        // Update the internal ID counter to avoid collisions
        const maxId = waypoints.reduce((max, wp) => {
            const n = Number.parseInt(wp.id.replace('wp-', ''), 10);
            return Number.isNaN(n) ? max : Math.max(max, n);
        }, 0);
        nextWaypointId = maxId + 1;
        set({ waypoints: normalizeWaypoints(waypoints) });
        recomputeRoute(get, set);
    },

    reverseRoute: () => {
        const { waypoints } = get();
        if (waypoints.length < 2) return;
        const n = waypoints.length - 1;
        // Collect original indices that have modeFromPrevious === 'free'
        const freeIndices = new Set<number>();
        for (let i = 1; i <= n; i++) {
            if (waypoints[i].modeFromPrevious === 'free') freeIndices.add(i);
        }
        // Reverse the array and recompute modeFromPrevious:
        // If original index j was free, then reversed index (n - j + 1) should be free.
        const reversed = [...waypoints].reverse();
        const newFreeIndices = new Set<number>();
        for (const j of freeIndices) {
            newFreeIndices.add(n - j + 1);
        }
        const result: RouteWaypoint[] = reversed.map((wp, i) => {
            if (i === 0) return { ...wp, modeFromPrevious: undefined };
            const mode: RouteMode = newFreeIndices.has(i) ? 'free' : 'auto';
            return { ...wp, modeFromPrevious: mode };
        });
        set({ waypoints: result });
        recomputeRoute(get, set);
    },

    importRoute: (waypoints, segments) => {
        currentAbortController?.abort();
        currentRevision += 1;
        const maxId = waypoints.reduce((max, wp) => {
            const n = Number.parseInt(wp.id.replace('wp-', ''), 10);
            return Number.isNaN(n) ? max : Math.max(max, n);
        }, 0);
        nextWaypointId = maxId + 1;
        const merged = mergeSegments(segments);
        set({
            waypoints: normalizeWaypoints(waypoints),
            routeSegments: segments,
            routeCoordinates: merged.coordinates,
            stats: { distance: merged.distance, duration: merged.duration, ascent: 0, descent: 0 },
            status: 'loading',
            statusMessage: 'Profil en cours',
            hoverDistance: null,
            hoverCoordinate: null,
            selectionRange: null,
            selectionCoordinates: [],
        });
        // Compute elevation profile asynchronously
        const abortController = new AbortController();
        currentAbortController = abortController;
        const revision = currentRevision;
        void (async () => {
            try {
                const elevation = await computeElevationProfile(merged.coordinates, abortController.signal);
                if (revision !== currentRevision) return;
                set({
                    profile: elevation.samples,
                    stats: { distance: merged.distance, duration: merged.duration, ascent: elevation.ascent, descent: elevation.descent },
                    status: 'idle',
                    statusMessage: null,
                });
            } catch {
                if (revision !== currentRevision) return;
                set({ status: 'idle', statusMessage: null, profile: [] });
            }
        })();
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
        set({
            hoverDistance: distance,
            hoverCoordinate: distance === null ? null : interpolateAlongLine(routeCoordinates, distance),
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

// Auto-save persistent route state to localStorage whenever it changes.
// Debounced to avoid excessive writes during route computation.
let _routeSaveTimer: ReturnType<typeof setTimeout> | null = null;
useRouteStore.subscribe((state) => {
    if (_routeSaveTimer) clearTimeout(_routeSaveTimer);
    _routeSaveTimer = setTimeout(() => {
        savePersistedRoute({
            waypoints: state.waypoints,
            active: state.active,
            mode: state.mode,
            colorElevationBySlope: state.colorElevationBySlope,
            gpxImportWaypoints: state.gpxImportWaypoints,
            selectionRange: state.selectionRange,
        });
    }, 500);
});