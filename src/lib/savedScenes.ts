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
 * The IndexedDB store uses a dedicated `createStore`, separate from saved
 * clouds, so clearing one never wipes the other.
 */
import { unzipSync } from 'fflate';
import { createStore, del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';

import type { CaptureParams } from '@/lib/captureParams';
import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';
import { createSavedCollection } from '@/lib/savedStore';
import { decodeShowcaseGeometry, fetchArrayBufferWithProgress, parseShowcaseManifest, type SceneLoadProgress, type ShowcaseAmbiance, type ShowcaseCamera } from '@/lib/showcaseScene';

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
    /** Total number of clouds bundled in this scene (primary + extraClouds). */
    cloudCount: number;
    /** Copie de l'ambiance : « Appliquer le style » n'a ainsi pas à tirer la géométrie depuis IndexedDB. */
    ambiance: ShowcaseAmbiance;
}

/** One cloud of a scene: a shaded point cloud, a mesh, or both. */
export interface SavedSceneCloud {
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
}

/** Heavy snapshot kept in IndexedDB (structured-cloned typed arrays). */
export interface SavedSceneData {
    camera: ShowcaseCamera;
    ambiance: ShowcaseAmbiance;
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    /** Extra clouds bundled alongside the primary one (multi-cloud export). */
    extraClouds?: SavedSceneCloud[];
    /** Réglages de génération, primaire en premier (voir `showcaseScene.ts`). */
    captureParams?: Array<CaptureParams | null>;
}

/**
 * `data:<id>` record. Scenes written before the extra clouds were split out keep
 * them inline and carry no `extraCount`.
 */
type StoredScene = SavedSceneData & { extraCount?: number };

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
        cloudCount: 1 + (data.extraClouds?.length ?? 0),
        ambiance: data.ambiance,
    };

    // One record per cloud: a multi-cloud scene decodes to well over a gigabyte,
    // and a single structured clone of the whole thing exhausts the tab's heap.
    const { extraClouds, ...head } = data;
    try {
        await idbSet(`data:${meta.id}`, extraClouds?.length ? { ...head, extraCount: extraClouds.length } : head, sceneStore);
        for (const [i, cloud] of (extraClouds ?? []).entries()) {
            await idbSet(`extra:${meta.id}:${i}`, cloud, sceneStore);
        }
        if (thumb) await idbSet(`thumb:${meta.id}`, thumb, sceneStore);
    } catch (err) {
        throw new Error(`Scène non enregistrée : ${err instanceof Error ? err.message : String(err)}`);
    }

    const next = [descriptor, ...all.filter((s) => s.id !== meta.id)];
    const kept = next.slice(0, MAX_ENTRIES);
    for (const removed of next.slice(MAX_ENTRIES)) deleteSceneRecords(removed);
    writeAll(kept);
    return descriptor;
}

/** Drop every IndexedDB record owned by a saved scene. */
function deleteSceneRecords(scene: SavedScene): void {
    void idbDel(`data:${scene.id}`, sceneStore);
    void idbDel(`thumb:${scene.id}`, sceneStore);
    for (let i = 0; i < scene.cloudCount - 1; i++) void idbDel(`extra:${scene.id}:${i}`, sceneStore);
}

/** Read the heavy snapshot for a saved scene, or null if missing. */
export async function loadSavedSceneData(id: string): Promise<SavedSceneData | null> {
    try {
        const data = await idbGet<StoredScene>(`data:${id}`, sceneStore);
        if (!data) return null;
        if (!data.extraCount) return data;
        const extraClouds: SavedSceneCloud[] = [];
        for (let i = 0; i < data.extraCount; i++) {
            const cloud = await idbGet<SavedSceneCloud>(`extra:${id}:${i}`, sceneStore);
            if (cloud) extraClouds.push(cloud);
        }
        return { ...data, extraClouds };
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
    const all = readAll();
    const scene = all.find((s) => s.id === id);
    if (scene) deleteSceneRecords(scene);
    writeAll(all.filter((s) => s.id !== id));
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
 * Decode an already-unzipped archive (the three `<id>.bin`/`.json`/`.webp` files
 * unpacked into a Record) and persist the result as a new local entry. Called by
 * both `importSceneFromZip` (local file) and `importSceneFromUrl` (remote fetch).
 */
async function importSceneFromArchive(
    files: Record<string, Uint8Array>,
    fallbackName: string,
): Promise<SavedScene | null> {
    const binBytes = findEntry(files, '.bin');
    const jsonBytes = findEntry(files, '.json');
    if (!binBytes || !jsonBytes) {
        throw new Error('Archive invalide : fichiers .bin et .json attendus.');
    }
    const thumbBytes = findEntry(files, '.webp');

    const manifest = parseShowcaseManifest(new TextDecoder().decode(jsonBytes));
    // Unzipped entries usually own their buffer outright; copying a several-hundred
    // megabyte payload just to re-slice it would be pure heap pressure.
    const geometryBuffer =
        binBytes.byteOffset === 0 && binBytes.byteLength === binBytes.buffer.byteLength
            ? (binBytes.buffer as ArrayBuffer)
            : (binBytes.buffer.slice(binBytes.byteOffset, binBytes.byteOffset + binBytes.byteLength) as ArrayBuffer);
    const geometry = await decodeShowcaseGeometry(geometryBuffer);

    const id = `scene-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return saveScene(
        { id, title: manifest.title || fallbackName, description: manifest.description },
        { camera: manifest.camera, ambiance: manifest.ambiance, shaded: geometry.shaded, mesh: geometry.mesh, extraClouds: geometry.extraClouds, captureParams: manifest.captureParams },
        thumbBytes ?? null,
    );
}

/**
 * Import a `.zip` exported by another user/computer into "Mes vues". The archive
 * bundles `<id>.bin` (geometry), `<id>.json` (manifest), and optionally
 * `<id>.webp` (thumbnail). The scene is decoded and stored locally; a fresh id
 * is generated so re-importing never clobbers an existing entry.
 */
export async function importSceneFromZip(file: File): Promise<SavedScene | null> {
    // Never bind the zip bytes to a local: a large scene needs every spare byte of
    // the tab's heap once its geometry is decoded.
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    return importSceneFromArchive(files, file.name.replace(/\.zip$/i, ''));
}

/**
* Download a `.zip` from a remote URL and import it into "Mes vues".
*
* The host must serve `Access-Control-Allow-Origin` headers (CORS). Google Drive
* is rejected immediately with an explicit message. Dropbox viewer links
* (`?dl=0`) are automatically rewritten to direct-download links (`?dl=1`).
*
* Pass `onProgress` to receive download-percentage updates, followed by a
* `'decode'` tick once the network transfer is complete.
*/
export async function importSceneFromUrl(
    url: string,
    onProgress?: (p: SceneLoadProgress) => void,
): Promise<SavedScene | null> {
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('URL invalide : seules les adresses http/https sont supportées.');
    }

    onProgress?.({ phase: 'download', loaded: 0, total: 0 });

    let buf: ArrayBuffer;
    try {
        buf = await fetchArrayBufferWithProgress(url, onProgress);
    } catch (e) {
        if (e instanceof TypeError) {
            // Opaque network error — most likely CORS or no internet
            throw new Error(`Téléchargement bloqué (CORS ou réseau). Assurez-vous que l'URL est correcte et que le serveur autorise les requêtes depuis ce site.`);
        }
        throw e;
    }

    onProgress?.({ phase: 'decode' });
    const fallbackName = url.split('/').pop()?.replace(/\.zip$/i, '') ?? 'scène importée';
    return importSceneFromArchive(unzipSync(new Uint8Array(buf)), fallbackName);
}
