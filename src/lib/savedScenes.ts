/**
 * Saved showcase scenes — exported views the user keeps locally ("Mes vues"),
 * mirroring the saved-clouds UX. Exporting a view stores it here so it can be
 * re-opened instantly from the gallery without downloading any file.
 *
 * Storage split (same rationale as `savedClouds.ts`): the heavy geometry +
 * thumbnail bytes live in a dedicated IndexedDB store, while a compact
 * descriptor (id, title, counts, date) lives in localStorage so the list
 * renders synchronously and stays well under the localStorage quota.
 *
 * The IndexedDB store is deliberately separate from the pipeline result cache
 * (`lidarBrowser/cache.ts`) and from saved clouds, so clearing one never wipes
 * the others.
 */
import { unzipSync } from 'fflate';
import { createStore, del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';
import { createSavedCollection } from '@/lib/savedStore';
import { decodeShowcaseGeometry, parseShowcaseManifest, type ShowcaseAmbiance, type ShowcaseCamera } from '@/lib/showcaseScene';

const SAVED_SCENES_KEY = 'open-cairn-saved-scenes';
const sceneStore = createStore('open-cairn-saved-scenes-db', 'data');

/** Soft cap on the number of saved scenes; oldest are evicted past this. */
const MAX_ENTRIES = 30;

/** Lightweight descriptor kept in localStorage. */
export interface SavedScene {
    id: string;
    title: string;
    description?: string;
    /** ISO date string. */
    createdAt: string;
    hasMesh: boolean;
    pointCount: number;
    vertexCount?: number;
}

/** Heavy snapshot kept in IndexedDB (structured-cloned typed arrays). */
export interface SavedSceneData {
    camera: ShowcaseCamera;
    ambiance: ShowcaseAmbiance;
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
}

const scenes = createSavedCollection<SavedScene>(SAVED_SCENES_KEY);
const readAll = scenes.readAll;
const writeAll = scenes.writeAll;

export const listSavedScenes = scenes.list;

/** Reactive hook returning the current saved scenes, sorted newest-first. */
export const useSavedScenes = scenes.useItems;

/**
 * Persist an exported scene as a local entry. The heavy geometry goes to
 * IndexedDB (`data:<id>`), the optional thumbnail to `thumb:<id>`, and the
 * compact descriptor to localStorage.
 */
export async function saveScene(
    meta: { id: string; title: string; description?: string; createdAt?: string },
    data: SavedSceneData,
    thumb: Uint8Array | null,
): Promise<SavedScene | null> {
    if (!data.shaded && !data.mesh) return null;
    const all = readAll();

    const descriptor: SavedScene = {
        id: meta.id,
        title: meta.title,
        description: meta.description,
        createdAt: meta.createdAt ?? new Date().toISOString(),
        hasMesh: data.mesh !== null,
        pointCount: data.shaded?.pointCount ?? 0,
        vertexCount: data.mesh?.vertexCount,
    };

    try {
        await idbSet(`data:${meta.id}`, data, sceneStore);
        if (thumb) await idbSet(`thumb:${meta.id}`, thumb, sceneStore);
    } catch {
        return null; // out of quota / IDB unavailable — skip silently
    }

    const next = [descriptor, ...all.filter((s) => s.id !== meta.id)];
    const kept = next.slice(0, MAX_ENTRIES);
    for (const removed of next.slice(MAX_ENTRIES)) {
        void idbDel(`data:${removed.id}`, sceneStore);
        void idbDel(`thumb:${removed.id}`, sceneStore);
    }
    writeAll(kept);
    return descriptor;
}

/** Read the heavy snapshot for a saved scene, or null if missing. */
export async function loadSavedSceneData(id: string): Promise<SavedSceneData | null> {
    try {
        const data = await idbGet<SavedSceneData>(`data:${id}`, sceneStore);
        return data ?? null;
    } catch {
        return null;
    }
}

/** Read the stored thumbnail bytes for a saved scene, or null if missing. */
export async function loadSavedSceneThumb(id: string): Promise<Uint8Array | null> {
    try {
        const thumb = await idbGet<Uint8Array>(`thumb:${id}`, sceneStore);
        return thumb ?? null;
    } catch {
        return null;
    }
}

export function deleteSavedScene(id: string): void {
    void idbDel(`data:${id}`, sceneStore);
    void idbDel(`thumb:${id}`, sceneStore);
    writeAll(readAll().filter((s) => s.id !== id));
}

export function renameSavedScene(id: string, title: string): void {
    const all = readAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], title };
    writeAll(all);
}

/** Find a single zip entry whose name ends with the given extension. */
function findEntry(files: Record<string, Uint8Array>, ext: string): Uint8Array | null {
    const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(ext));
    return name ? files[name] : null;
}

/**
 * Import a `.zip` exported by another user/computer into "Mes vues". The archive
 * bundles `<id>.bin` (geometry), `<id>.json` (manifest), and optionally
 * `<id>.webp` (thumbnail). The scene is decoded and stored locally; a fresh id
 * is generated so re-importing never clobbers an existing entry.
 */
export async function importSceneFromZip(file: File): Promise<SavedScene | null> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buffer);

    const binBytes = findEntry(files, '.bin');
    const jsonBytes = findEntry(files, '.json');
    if (!binBytes || !jsonBytes) {
        throw new Error('Archive invalide : fichiers .bin et .json attendus.');
    }
    const thumbBytes = findEntry(files, '.webp');

    const manifest = parseShowcaseManifest(new TextDecoder().decode(jsonBytes));
    const geometryBuffer = binBytes.buffer.slice(
        binBytes.byteOffset,
        binBytes.byteOffset + binBytes.byteLength,
    ) as ArrayBuffer;
    const geometry = await decodeShowcaseGeometry(geometryBuffer);

    const id = `scene-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return saveScene(
        { id, title: manifest.title || file.name.replace(/\.zip$/i, ''), description: manifest.description },
        { camera: manifest.camera, ambiance: manifest.ambiance, shaded: geometry.shaded, mesh: geometry.mesh },
        thumbBytes ?? null,
    );
}
