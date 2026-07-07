/**
 * Saved LiDAR clouds/meshes — "recently loaded" entries the user can re-open
 * instantly, mirroring the saved-routes UX.
 *
 * Storage split (see the discussion in the repo): the heavy typed-array
 * payload (positions/normals/colors/indices, several MB) lives in a dedicated
 * IndexedDB store, while a compact descriptor (coords, params) lives in
 * localStorage so the list renders synchronously and stays well under the
 * ~5 MB localStorage quota.
 *
 * The IndexedDB store is deliberately separate from the pipeline result cache
 * (`lidarBrowser/cache.ts`), so `clearLidarCache()` (which clears the default
 * idb-keyval store) never wipes the user's saved clouds.
 */
import { createStore, del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';
import { createSavedCollection } from '@/lib/savedStore';

const SAVED_CLOUDS_KEY = 'open-cairn-saved-clouds';
const cloudStore = createStore('open-cairn-saved-clouds-db', 'data');

/** Soft cap on the number of saved clouds; oldest are evicted past this. */
const MAX_ENTRIES = 30;

export type LidarCloudMode = 'shaded' | 'delaunay' | 'poisson';

export const CLOUD_MODE_LABELS: Record<LidarCloudMode, string> = {
    shaded: 'Nuage',
    delaunay: 'Mixte',
    poisson: 'Maillage',
};

/** Lightweight descriptor kept in localStorage. */
export interface SavedCloud {
    id: string;
    /** Dedupe key: same area + params reuses the same entry. */
    key: string;
    name: string;
    /** ISO date string (updated on each re-save of the same key). */
    createdAt: string;
    mode: LidarCloudMode;
    centerLng: number;
    centerLat: number;
    radius: number;
    stride: number;
    classes: number[];
    shader: string;
    /** Point count (shaded cloud). */
    pointCount: number;
    /** Vertex count when a mesh is part of the snapshot. */
    vertexCount?: number;
    hasMesh: boolean;
}

/** Heavy binary snapshot kept in IndexedDB (structured-cloned typed arrays). */
export interface SavedCloudData {
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
}

/** Identifying params captured at load time. */
export interface SavedCloudParams {
    mode: LidarCloudMode;
    centerLng: number;
    centerLat: number;
    radius: number;
    stride: number;
    classes: number[];
    shader: string;
}

const clouds = createSavedCollection<SavedCloud>(SAVED_CLOUDS_KEY);
const readAll = clouds.readAll;
const writeAll = clouds.writeAll;

export const listSavedClouds = clouds.list;

/** Reactive hook returning the current saved clouds, sorted newest-first. */
export const useSavedClouds = clouds.useItems;

/** Dedupe key: same area + params reuses the same entry/gallery match. */
export function makeCloudKey(p: SavedCloudParams): string {
    const lng = p.centerLng.toFixed(4);
    const lat = p.centerLat.toFixed(4);
    const cls = p.classes.length > 0 ? [...p.classes].sort((a, b) => a - b).join(',') : 'all';
    return `${p.mode}:${lng}:${lat}:${p.radius}:${p.stride}:${cls}:${p.shader}`;
}

function defaultName(p: SavedCloudParams): string {
    return `${CLOUD_MODE_LABELS[p.mode]} · ${p.centerLat.toFixed(3)}, ${p.centerLng.toFixed(3)}`;
}

/**
 * Persist a freshly-loaded cloud/mesh as a saved entry. Re-loading the same
 * area + params updates the existing entry (and bumps it to the top) instead
 * of creating a duplicate.
 */
export async function saveLoadedCloud(params: SavedCloudParams, data: SavedCloudData): Promise<SavedCloud | null> {
    if (!data.shaded && !data.mesh) return null;
    const key = makeCloudKey(params);
    const all = readAll();
    const existing = all.find((c) => c.key === key);
    const id = existing?.id ?? `cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const meta: SavedCloud = {
        id,
        key,
        name: existing?.name ?? defaultName(params),
        createdAt: new Date().toISOString(),
        mode: params.mode,
        centerLng: params.centerLng,
        centerLat: params.centerLat,
        radius: params.radius,
        stride: params.stride,
        classes: [...params.classes],
        shader: params.shader,
        pointCount: data.shaded?.pointCount ?? 0,
        vertexCount: data.mesh?.vertexCount,
        hasMesh: data.mesh !== null,
    };

    try {
        await idbSet(`data:${id}`, data, cloudStore);
    } catch {
        return null; // out of quota / IDB unavailable — skip silently
    }

    const next = [meta, ...all.filter((c) => c.id !== id)];
    const kept = next.slice(0, MAX_ENTRIES);
    for (const removed of next.slice(MAX_ENTRIES)) {
        void idbDel(`data:${removed.id}`, cloudStore);
    }
    writeAll(kept);
    return meta;
}

/** Read the heavy snapshot for a saved cloud, or null if missing. */
export async function loadSavedCloudData(id: string): Promise<SavedCloudData | null> {
    try {
        const data = await idbGet<SavedCloudData>(`data:${id}`, cloudStore);
        return data ?? null;
    } catch {
        return null;
    }
}

export function deleteSavedCloud(id: string): void {
    void idbDel(`data:${id}`, cloudStore);
    writeAll(readAll().filter((c) => c.id !== id));
}

/** Remove every saved cloud (descriptors + IndexedDB payloads). */
export function clearAllSavedClouds(): void {
    for (const c of readAll()) {
        void idbDel(`data:${c.id}`, cloudStore);
    }
    writeAll([]);
}

export function renameSavedCloud(id: string, name: string): void {
    const all = readAll();
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], name };
    writeAll(all);
}
