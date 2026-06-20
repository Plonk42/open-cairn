import type { LngLatTuple } from '@/lib/geo';
import { createSavedCollection } from '@/lib/savedStore';
import type { RouteSegment, RouteStats, RouteWaypoint } from '@/stores/routeStore';

const SAVED_ROUTES_KEY = 'open-cairn-saved-routes';

/** Persisted preview polyline (already simplified, normalized for thumbnail rendering). */
export interface SavedRoutePreview {
    /** Bounding box [w, s, e, n] in WGS84. */
    bbox: [number, number, number, number];
    /** Downsampled coordinates of the merged route line. */
    coords: LngLatTuple[];
    /** Downsampled elevation samples (m) along the route, ordered by distance. */
    elevations?: number[];
    /** Coordinate of the highest elevation sample, for the summit marker. */
    summit?: LngLatTuple;
}

export interface SavedRoute {
    id: string;
    name: string;
    /** ISO date string. */
    createdAt: string;
    waypoints: RouteWaypoint[];
    segments: RouteSegment[];
    stats: RouteStats;
    preview: SavedRoutePreview;
}

const routes = createSavedCollection<SavedRoute>(SAVED_ROUTES_KEY);
const readAll = routes.readAll;
const writeAll = routes.writeAll;

export const listSavedRoutes = routes.list;

/** Reactive hook returning the current saved routes, sorted newest-first. */
export const useSavedRoutes = routes.useItems;

export function getSavedRouteById(id: string): SavedRoute | null {
    return readAll().find((r) => r.id === id) ?? null;
}

export function saveRoute(route: Omit<SavedRoute, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): SavedRoute {
    const all = readAll();
    const id = route.id ?? `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = route.createdAt ?? new Date().toISOString();
    const entry: SavedRoute = { ...route, id, createdAt };
    const idx = all.findIndex((r) => r.id === id);
    if (idx >= 0) all[idx] = entry;
    else all.unshift(entry);
    writeAll(all);
    return entry;
}

export function deleteSavedRoute(id: string): void {
    writeAll(readAll().filter((r) => r.id !== id));
}

export function renameSavedRoute(id: string, name: string): void {
    const all = readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], name };
    writeAll(all);
}

function computeBbox(coordinates: LngLatTuple[]): [number, number, number, number] {
    let w = coordinates[0][0], e = coordinates[0][0], s = coordinates[0][1], n = coordinates[0][1];
    for (const [lng, lat] of coordinates) {
        if (lng < w) w = lng;
        if (lng > e) e = lng;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
    }
    return [w, s, e, n];
}

function downsample<T>(items: ReadonlyArray<T>, targetPoints: number): T[] {
    if (items.length <= targetPoints) return [...items];
    const out: T[] = [];
    const step = (items.length - 1) / (targetPoints - 1);
    for (let i = 0; i < targetPoints; i++) {
        const idx = Math.min(items.length - 1, Math.round(i * step));
        out.push(items[idx]);
    }
    return out;
}

function sampleByDistance(
    profile: ReadonlyArray<{ elevation: number; distance: number }>,
    n: number,
): number[] {
    const last = profile.at(-1);
    const total = last ? last.distance : 0;
    if (total <= 0) return profile.map((p) => p.elevation).slice(0, n);
    const out: number[] = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
        const target = (i / (n - 1)) * total;
        while (cursor < profile.length - 1 && profile[cursor + 1].distance < target) cursor++;
        out.push(profile[cursor].elevation);
    }
    return out;
}

/**
 * Downsample a polyline (and optional elevation profile) to ~targetPoints,
 * keeping endpoints, and compute its bbox. Used to build a compact preview
 * for the saved-route list thumbnails.
 */
export function buildPreview(
    coordinates: LngLatTuple[],
    profile?: ReadonlyArray<{ elevation: number; coordinate: LngLatTuple; distance: number }>,
    targetPoints = 96,
): SavedRoutePreview {
    if (coordinates.length === 0) {
        return { bbox: [0, 0, 0, 0], coords: [] };
    }
    const bbox = computeBbox(coordinates);
    const coords = downsample(coordinates, targetPoints);

    if (!profile || profile.length < 2) {
        return { bbox, coords };
    }
    const elevations = sampleByDistance(profile, targetPoints);
    const summit = profile.reduce((best, p) => (p.elevation > best.elevation ? p : best), profile[0]).coordinate;
    return { bbox, coords, elevations, summit };
}
