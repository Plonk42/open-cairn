/**
 * Saved LiDAR clouds/meshes — "recently loaded" entries the user can re-open
 * instantly, mirroring the saved-routes UX.
 *
 * Storage split (see the discussion in the repo): the heavy typed-array
 * payload (positions/normals/colors/indices, several MB) lives in a dedicated
 * IndexedDB store, while a compact descriptor (coords, params, a tiny top-down
 * preview) lives in localStorage so the list renders synchronously and stays
 * well under the ~5 MB localStorage quota.
 *
 * The IndexedDB store is deliberately separate from the pipeline result cache
 * (`lidarBrowser/cache.ts`), so `clearLidarCache()` (which clears the default
 * idb-keyval store) never wipes the user's saved clouds.
 */
import { createStore, del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';

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

/** Compact top-down scatter used as the list thumbnail. */
export interface SavedCloudPreview {
    /** Interleaved (x, y) in [0,1], y already flipped for SVG. */
    points: number[];
    /** Normalized altitude [0,1] per point, for the colour ramp. */
    alts: number[];
}

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
    preview: SavedCloudPreview;
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

function readAll(): SavedCloud[] {
    try {
        const raw = localStorage.getItem(SAVED_CLOUDS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as SavedCloud[]) : [];
    } catch {
        return [];
    }
}

function writeAll(clouds: SavedCloud[]): void {
    try {
        localStorage.setItem(SAVED_CLOUDS_KEY, JSON.stringify(clouds));
    } catch { /* ignore quota */ }
    globalThis.dispatchEvent(new CustomEvent('open-cairn-saved-clouds-changed'));
}

export function listSavedClouds(): SavedCloud[] {
    return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function makeKey(p: SavedCloudParams): string {
    const lng = p.centerLng.toFixed(4);
    const lat = p.centerLat.toFixed(4);
    const cls = p.classes.length > 0 ? [...p.classes].sort((a, b) => a - b).join(',') : 'all';
    return `${p.mode}:${lng}:${lat}:${p.radius}:${p.stride}:${cls}:${p.shader}`;
}

function defaultName(p: SavedCloudParams): string {
    return `${CLOUD_MODE_LABELS[p.mode]} · ${p.centerLat.toFixed(3)}, ${p.centerLng.toFixed(3)}`;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Build a compact top-down preview from the snapshot's point/vertex positions. */
function buildPreview(data: SavedCloudData): SavedCloudPreview {
    const src = data.shaded ?? data.mesh;
    if (!src || src.positions.length < 3) return { points: [], alts: [] };
    const pos = src.positions; // interleaved (x_east, y_north, alt)
    const n = Math.floor(pos.length / 3);
    const target = Math.min(n, 220);
    const step = n / target;

    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < target; i++) {
        const idx = Math.min(n - 1, Math.floor(i * step)) * 3;
        const x = pos[idx], y = pos[idx + 1], z = pos[idx + 2];
        xs.push(x); ys.push(y); zs.push(z);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const spanZ = Math.max(maxZ - minZ, 1e-6);
    const span = Math.max(spanX, spanY); // keep aspect ratio square
    const offX = (span - spanX) / 2;
    const offY = (span - spanY) / 2;

    const points: number[] = [];
    const alts: number[] = [];
    for (let i = 0; i < target; i++) {
        // Flip Y so north is up in SVG coordinates.
        points.push(
            round3((xs[i] - minX + offX) / span),
            round3(1 - (ys[i] - minY + offY) / span),
        );
        alts.push(round3((zs[i] - minZ) / spanZ));
    }
    return { points, alts };
}

/**
 * Persist a freshly-loaded cloud/mesh as a saved entry. Re-loading the same
 * area + params updates the existing entry (and bumps it to the top) instead
 * of creating a duplicate.
 */
export async function saveLoadedCloud(params: SavedCloudParams, data: SavedCloudData): Promise<SavedCloud | null> {
    if (!data.shaded && !data.mesh) return null;
    const key = makeKey(params);
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
        preview: buildPreview(data),
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

export function renameSavedCloud(id: string, name: string): void {
    const all = readAll();
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], name };
    writeAll(all);
}
