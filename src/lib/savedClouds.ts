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
 * `colors` is stripped before the typed-array payload is persisted (see
 * `stripColors`/`restoreColors` below) — it's cheap to re-derive from
 * normals + the active shader, and gets recomputed unconditionally as soon
 * as a cloud re-enters the store, so storing it would just be dead weight.
 *
 * The IndexedDB store uses a dedicated `createStore` (not the default
 * idb-keyval store), so it is isolated from any other idb-keyval usage.
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
    /** Capture rectangle dimensions (m). */
    widthM: number;
    lengthM: number;
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

/**
 * On-disk shape of `SavedCloudData`, minus `colors`. Colors are a cheap
 * per-point derivation from normals + the active shader (no spatial search,
 * unlike normals themselves — see the pipeline's `colorsFromNormals`), and
 * `addLidarCloudSnapshot` unconditionally recolors every cloud against the
 * *current* shader as soon as it re-enters the store. Persisting colors here
 * would just bloat IndexedDB (~11% more bytes per entry) for values that get
 * discarded the moment the entry is reloaded.
 */
interface StoredCloudData {
    shaded: Omit<LidarShadedCloudData, 'colors'> | null;
    mesh: Omit<LidarMeshData, 'colors'> | null;
}

function stripColors(data: SavedCloudData): StoredCloudData {
    const { shaded, mesh } = data;
    return {
        shaded: shaded ? (({ colors: _colors, ...rest }) => rest)(shaded) : null,
        mesh: mesh ? (({ colors: _colors, ...rest }) => rest)(mesh) : null,
    };
}

/** Placeholder colors sized to match positions; overwritten before anything renders it. */
function restoreColors(stored: StoredCloudData): SavedCloudData {
    return {
        shaded: stored.shaded ? { ...stored.shaded, colors: new Uint8Array(stored.shaded.positions.length) } : null,
        mesh: stored.mesh ? { ...stored.mesh, colors: new Uint8Array(stored.mesh.positions.length) } : null,
    };
}

/** Identifying params captured at load time. */
export interface SavedCloudParams {
    mode: LidarCloudMode;
    centerLng: number;
    centerLat: number;
    widthM: number;
    lengthM: number;
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
    // Include the rectangle dimensions so two differently-shaped rectangles
    // that happen to share the same enclosing radius (e.g. 500×300 vs a
    // near-square rect) don't dedupe together.
    const size = `${p.widthM.toFixed(0)}x${p.lengthM.toFixed(0)}`;
    return `${p.mode}:${lng}:${lat}:${size}:${p.stride}:${cls}:${p.shader}`;
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
    let all = readAll();
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
        widthM: params.widthM,
        lengthM: params.lengthM,
        stride: params.stride,
        classes: [...params.classes],
        shader: params.shader,
        pointCount: data.shaded?.pointCount ?? 0,
        vertexCount: data.mesh?.vertexCount,
        hasMesh: data.mesh !== null,
    };

    // A handful of large Poisson meshes is enough to exhaust the origin's
    // IndexedDB quota; without this eviction-and-retry loop the very first
    // failure would make every later capture stop being recorded, silently and
    // for good. Oldest entries go first, exactly like the MAX_ENTRIES cap.
    const evictable = all
        .filter((c) => c.id !== id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => c.id);
    const stored = stripColors(data);
    for (; ;) {
        try {
            await idbSet(`data:${id}`, stored, cloudStore);
            break;
        } catch (err) {
            const victim = evictable.shift();
            if (victim === undefined) {
                console.warn('savedClouds: nuage non enregistré', err);
                writeAll(all);
                return null;
            }
            try {
                await idbDel(`data:${victim}`, cloudStore);
            } catch { /* payload already gone — the descriptor still has to go */ }
            all = all.filter((c) => c.id !== victim);
        }
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
        const stored = await idbGet<StoredCloudData>(`data:${id}`, cloudStore);
        return stored ? restoreColors(stored) : null;
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
