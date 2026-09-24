/**
 * `composite://` MapLibre protocol — fetches a base raster tile and a LiDAR
 * shadow tile in parallel, blends them in a worker's OffscreenCanvas, and
 * returns the result to MapLibre as an ImageBitmap (no PNG re-encode).
 *
 * URL format:
 *   composite://<baseKey>/<shadowKind>/<blendMode>/<intensityPercent>/<detailScale>/{z}/{x}/{y}
 */

import * as maplibregl from 'maplibre-gl';
import type { CompositeJob, CompositeReply, CompositeRequest, DetailedTileRequest, TileRequest } from './compositeWorkerProtocol';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignWmtsUrl, OSM_ATTRIBUTION, OSM_TILE_URL } from './ign';

let registered = false;

/** Module-level getter for the IGN apikey — set externally to avoid circular imports. */
let _ignApiKey = '';
export function setIgnApiKey(key: string): void { _ignApiKey = key; }

export type CompositeBaseKey = keyof typeof IGN_LAYERS | 'osm';

interface RasterLayerDef {
    minZoom: number;
    maxZoom: number;
    tileUrl: string;
    attribution: string;
}

/** Short URL token → IGN LiDAR HD shadow layer key. */
export const SHADOW_LAYER_KEY = {
    mns: 'lidarMnsShadow',
    mnt: 'lidarMntShadow',
    mnh: 'lidarMnhShadow',
} as const satisfies Record<string, CompositeBaseKey>;

export type ShadowKind = keyof typeof SHADOW_LAYER_KEY;

/** Supported shadow blend modes. */
export const BLEND_MODES = [
    'lidar-neutral',
    'multiply',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
    'lidar-neutral': 'Relief LiDAR (recommandé)',
    'multiply': 'Multiplication (rapide)',
};

function rasterLayerDef(layerKey: CompositeBaseKey): RasterLayerDef {
    if (layerKey === 'osm') {
        return { minZoom: 0, maxZoom: 19, tileUrl: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
    }

    const def = IGN_LAYERS[layerKey];
    return {
        minZoom: def.minZoom,
        maxZoom: def.maxZoom,
        attribution: IGN_ATTRIBUTION,
        tileUrl: ignWmtsUrl({
            layer: def.id,
            format: def.format,
            private: def.private,
            apikey: def.private ? _ignApiKey : undefined,
        }),
    };
}

function tileUrlFor(layerKey: CompositeBaseKey, z: number, x: number, y: number): string {
    const def = rasterLayerDef(layerKey);
    return def.tileUrl
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
}

function overzoomedTile(layerKey: CompositeBaseKey, z: number, x: number, y: number): TileRequest {
    const def = rasterLayerDef(layerKey);
    const sourceZ = Math.max(def.minZoom, Math.min(def.maxZoom, z));
    const overscale = 2 ** (z - sourceZ);
    const sourceX = Math.floor(x / overscale);
    const sourceY = Math.floor(y / overscale);

    return {
        url: tileUrlFor(layerKey, sourceZ, sourceX, sourceY),
        overscale,
        offsetX: x - sourceX * overscale,
        offsetY: y - sourceY * overscale,
    };
}

interface CompositeArgs {
    baseKey: CompositeBaseKey;
    shadow: ShadowKind;
    mode: BlendMode;
    intensity: number;
    detailScale: number;
    z: number;
    x: number;
    y: number;
    signal?: AbortSignal;
}

function detailedTiles(
    layerKey: CompositeBaseKey,
    z: number,
    x: number,
    y: number,
    detailScale: number,
): DetailedTileRequest[] {
    const def = rasterLayerDef(layerKey);
    const detailOffset = Math.max(0, Math.min(Math.log2(detailScale), def.maxZoom - z));
    const targetZ = z + detailOffset;
    const scale = 2 ** detailOffset;

    return Array.from({ length: scale * scale }, (_, index) => {
        const dx = index % scale;
        const dy = Math.floor(index / scale);
        return {
            ...overzoomedTile(layerKey, targetZ, x * scale + dx, y * scale + dy),
            dx,
            dy,
            scale,
        };
    });
}

// ---------------------------------------------------------------------------
// Worker pool: the blend runs off the main thread (see `compositeWorker.ts`)
// ---------------------------------------------------------------------------
interface CompositeOutcome {
    bitmap: ImageBitmap | null;
    shadowTimedOut: boolean;
}

interface PendingJob {
    worker: Worker;
    resolve: (outcome: CompositeOutcome) => void;
    reject: (err: Error) => void;
}

let workers: Worker[] = [];
let nextWorker = 0;
let nextJobId = 0;
const pendingJobs = new Map<number, PendingJob>();

function onWorkerReply(ev: MessageEvent<CompositeReply>): void {
    const msg = ev.data;
    const job = pendingJobs.get(msg.id);
    if (!job) {
        // Cancelled while the worker was already done with it.
        if (msg.type === 'ok') msg.bitmap?.close();
        return;
    }
    pendingJobs.delete(msg.id);
    if (msg.type === 'ok') job.resolve({ bitmap: msg.bitmap, shadowTimedOut: msg.shadowTimedOut });
    else if (msg.aborted) job.reject(new DOMException('Aborted', 'AbortError'));
    else job.reject(msg.timedOut ? new DOMException(msg.error, 'TimeoutError') : new Error(msg.error));
}

/** A worker that fails to load would otherwise leave every tile it was given pending forever. */
function onWorkerError(worker: Worker, ev: ErrorEvent): void {
    for (const [id, job] of pendingJobs) {
        if (job.worker !== worker) continue;
        pendingJobs.delete(id);
        job.reject(new Error(ev.message || 'composite worker crashed'));
    }
}

function pickWorker(): Worker {
    if (workers.length === 0) {
        const count = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
        workers = Array.from({ length: count }, () => {
            const worker = new Worker(new URL('./compositeWorker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = onWorkerReply;
            worker.onerror = (ev) => onWorkerError(worker, ev);
            return worker;
        });
    }
    return workers[nextWorker++ % workers.length];
}

function runInWorker(job: Omit<CompositeJob, 'type' | 'id'>, signal?: AbortSignal): Promise<CompositeOutcome> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const worker = pickWorker();
    const id = ++nextJobId;
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            pendingJobs.delete(id);
            worker.postMessage({ type: 'cancel', id } satisfies CompositeRequest);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const settle = () => signal?.removeEventListener('abort', onAbort);
        pendingJobs.set(id, {
            worker,
            resolve: (outcome) => { settle(); resolve(outcome); },
            reject: (err) => { settle(); reject(err); },
        });
        worker.postMessage({ type: 'job', id, ...job } satisfies CompositeRequest);
    });
}

function composite(args: CompositeArgs): Promise<CompositeOutcome> {
    const { baseKey, shadow: shadowKind, mode, intensity, detailScale, z, x, y, signal } = args;
    const shadowKey = SHADOW_LAYER_KEY[shadowKind];
    const wantShadow = intensity > 0 && z >= IGN_LAYERS[shadowKey].minZoom;
    return runInWorker({
        base: overzoomedTile(baseKey, z, x, y),
        shadowTiles: wantShadow ? detailedTiles(shadowKey, z, x, y, detailScale) : [],
        mode,
        intensity,
        detailScale,
    }, signal);
}

// ---------------------------------------------------------------------------
// LRU cache for composite tile results
// ---------------------------------------------------------------------------
let tileCacheMax = 512;

class TileLruCache {
    private readonly map = new Map<string, ImageBitmap>();

    get(key: string): ImageBitmap | undefined {
        const bitmap = this.map.get(key);
        if (bitmap) {
            // Move to end (most recently used)
            this.map.delete(key);
            this.map.set(key, bitmap);
        }
        return bitmap;
    }

    set(key: string, bitmap: ImageBitmap): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else while (this.map.size >= tileCacheMax) {
            // Evict oldest entries
            const oldest = this.map.keys().next().value!;
            const evicted = this.map.get(oldest);
            this.map.delete(oldest);
            evicted?.close?.();
        }
        this.map.set(key, bitmap);
    }

    resize(newMax: number): void {
        while (this.map.size > newMax) {
            const oldest = this.map.keys().next().value!;
            const evicted = this.map.get(oldest);
            this.map.delete(oldest);
            evicted?.close?.();
        }
    }
}

const tileCache = new TileLruCache();

export function setTileCacheMaxSize(size: number): void {
    tileCacheMax = Math.max(0, Math.round(size));
    tileCache.resize(tileCacheMax);
}

/** Clear all cached composite tiles and notify the map to re-fetch. */
export function clearTileCache(): void {
    tileCache.resize(0);
    tileCache.resize(tileCacheMax);
    globalThis.dispatchEvent(new CustomEvent('composite-tile-reload'));
}

export interface CompositeTileRetryDetail {
    z: number;
    x: number;
    y: number;
}

// MapLibre never re-requests an errored tile while it stays in frame: a tile whose worker
// fetches both timed out would stay a hole, so ask the map to refresh it a little later.
// A tile whose shadow timed out is shown, but likewise refreshed rather than cached.
const RETRY_DELAY_MS = 15_000;
const MAX_DEFERRED_RETRIES = 3;
const deferredRetries = new Map<string, number>();

function scheduleDeferredRetry(url: string, tile: CompositeTileRetryDetail): void {
    const count = deferredRetries.get(url) ?? 0;
    if (count >= MAX_DEFERRED_RETRIES) {
        deferredRetries.delete(url);
        return;
    }
    deferredRetries.set(url, count + 1);
    globalThis.setTimeout(() => {
        globalThis.dispatchEvent(new CustomEvent<CompositeTileRetryDetail>('composite-tile-retry', { detail: tile }));
    }, RETRY_DELAY_MS);
}

async function compositeOrScheduleRetry(
    url: string,
    tile: CompositeTileRetryDetail,
    args: CompositeArgs,
): Promise<CompositeOutcome> {
    try {
        const outcome = await composite(args);
        if (outcome.bitmap && outcome.shadowTimedOut) scheduleDeferredRetry(url, tile);
        return outcome;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') scheduleDeferredRetry(url, tile);
        throw err;
    }
}

export function registerCompositeProtocol(): void {
    if (registered) return;
    registered = true;
    maplibregl.addProtocol('composite', async (req, abortController) => {
        const url = req.url.replace(/^composite:\/\//, '');

        // Check LRU cache first
        const cached = tileCache.get(url);
        if (cached) return { data: cached };

        const parts = url.split('/');
        if (parts.length < 7) throw new Error(`Bad composite URL: ${req.url}`);
        const baseKey = parts[0] as CompositeBaseKey;
        const shadow = parts[1] as ShadowKind;
        const mode = parts[2] as BlendMode;
        const intensity = Math.max(0, Math.min(1, Number(parts[3]) / 100));
        const hasDetailScale = parts.length >= 8;
        const detailScale = hasDetailScale ? Math.max(1, Math.min(2, Number(parts[4]) || 1)) : 1;
        const tileOffset = hasDetailScale ? 5 : 4;
        const tile = {
            z: Number(parts[tileOffset]),
            x: Number(parts[tileOffset + 1]),
            y: Number(parts[tileOffset + 2]),
        };
        const { bitmap, shadowTimedOut } = await compositeOrScheduleRetry(url, tile, {
            baseKey,
            shadow,
            mode,
            intensity,
            detailScale,
            ...tile,
            signal: abortController?.signal,
        });
        if (!bitmap) {
            throw new Error('composite: base tile unavailable');
        }
        if (shadowTimedOut) return { data: bitmap };
        deferredRetries.delete(url);
        tileCache.set(url, bitmap);
        return { data: bitmap };
    });
}

/** Build a MapLibre tile URL template that uses the composite:// protocol. */
export function compositeTileUrl(
    baseKey: CompositeBaseKey,
    shadow: ShadowKind,
    mode: BlendMode,
    intensity: number,
    detailScale = 1,
): string {
    const pct = Math.round(Math.max(0, Math.min(1, intensity)) * 100);
    const scale = Math.max(1, Math.min(2, Math.round(detailScale)));
    return `composite://${baseKey}/${shadow}/${mode}/${pct}/${scale}/{z}/{x}/{y}`;
}
