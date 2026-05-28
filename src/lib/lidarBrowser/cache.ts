/**
 * IndexedDB cache for assembled LiDAR pipeline results.
 *
 * Why cache at the result level (not at the HTTP/Range level): a single
 * shaded-cloud request decodes ~10 MB of LAZ chunks across 1–4 COPC tiles,
 * runs k-NN normals on ~100k points, and produces 4–8 MB of typed arrays.
 * Caching the assembled output skips all of that on cache hit.
 *
 * Storage budget: each key holds typed arrays as ArrayBuffers (IDB stores
 * them efficiently as Blobs internally). At ~6 MB per entry and a soft
 * LRU cap of 50 entries, the DB stays around 300 MB max — well under
 * browser quotas (typically several GB on desktop).
 */
import { clear as idbClear, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

import type { LidarShadedCloudData } from '../lidarCloud';

/** Round-trip data through the cache. */
export type Cacheable = LidarShadedCloudData;

/**
 * Stable cache key. Round to 4 decimals (~10 m at the equator) so tiny
 * cursor jitter still hits the cache; bigger moves are intentional.
 */
function makeKey(
    mode: 'shaded',
    p: { lng: number; lat: number; radius: number; stride: number; classes?: number[] },
): string {
    const lng = p.lng.toFixed(4);
    const lat = p.lat.toFixed(4);
    const classes = p.classes && p.classes.length > 0 ? p.classes.slice().sort((a, b) => a - b).join(',') : 'all';
    return `lidar:${mode}:${lng}:${lat}:${p.radius}:${p.stride}:${classes}`;
}

/** Soft LRU cap (eviction is best-effort, not strict). */
const MAX_ENTRIES = 50;

/** Wrap a typed-array buffer as a transferable-friendly plain object. */
type StoredShaded = {
    mode: 'shaded';
    centerLng: number;
    centerLat: number;
    positions: ArrayBuffer;
    normals: ArrayBuffer;
    colors: ArrayBuffer;
    classifications: ArrayBuffer;
    pointCount: number;
    radius: number;
};

function packShaded(d: LidarShadedCloudData): StoredShaded {
    return {
        mode: 'shaded',
        centerLng: d.centerLng,
        centerLat: d.centerLat,
        positions: d.positions.buffer as ArrayBuffer,
        normals: d.normals.buffer as ArrayBuffer,
        colors: d.colors.buffer as ArrayBuffer,
        classifications: d.classifications.buffer as ArrayBuffer,
        pointCount: d.pointCount,
        radius: d.radius,
    };
}

function unpack(s: StoredShaded): Cacheable {
    return {
        kind: 'shaded',
        centerLng: s.centerLng,
        centerLat: s.centerLat,
        positions: new Float32Array(s.positions),
        normals: new Float32Array(s.normals),
        colors: new Uint8Array(s.colors),
        classifications: new Uint8Array(s.classifications),
        pointCount: s.pointCount,
        radius: s.radius,
    };
}

async function evictIfNeeded(): Promise<void> {
    try {
        const all = await idbKeys();
        const lidar = all.filter((k): k is string => typeof k === 'string' && k.startsWith('lidar:'));
        if (lidar.length <= MAX_ENTRIES) return;
        // No real LRU info in the kv store; just trim the oldest-insertion
        // entries (idb-keyval `keys()` returns insertion order on Chromium).
        const toDelete = lidar.slice(0, lidar.length - MAX_ENTRIES);
        await Promise.all(toDelete.map((k) => idbDel(k)));
    } catch { /* cache eviction failures are non-fatal */ }
}

export async function readCachedLidar(
    mode: 'shaded',
    params: { lng: number; lat: number; radius: number; stride: number; classes?: number[] },
): Promise<Cacheable | null> {
    try {
        const key = makeKey(mode, params);
        const raw = await idbGet<StoredShaded>(key);
        if (!raw) return null;
        return unpack(raw);
    } catch {
        return null;
    }
}

export async function writeCachedLidar(
    mode: 'shaded',
    params: { lng: number; lat: number; radius: number; stride: number; classes?: number[] },
    data: Cacheable,
): Promise<void> {
    try {
        const key = makeKey(mode, params);
        const stored = packShaded(data);
        await idbSet(key, stored);
        await evictIfNeeded();
    } catch { /* cache write failures are non-fatal */ }
}

export async function clearLidarCache(): Promise<void> {
    try { await idbClear(); } catch { /* ignore */ }
}
