/**
 * Public entry-point for the browser-only LiDAR HD pipeline.
 *
 * Layers (innermost to outermost):
 *   pipeline.ts      pure compute, runs on whatever thread imports it
 *   worker.ts        DedicatedWorker boundary for the heavy CPU work
 *   workerClient.ts  main-thread promise-based dispatcher
 *   cache.ts         IndexedDB key/value cache of assembled results
 *   index.ts (here)  cache-first wrappers exposed to the store
 */
import type { LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import { readCachedLidar, writeCachedLidar } from './cache';
import type { BrowserFetchParams } from './pipeline';
import * as worker from './workerClient';

export { clearLidarCache } from './cache';
export type { BrowserFetchParams as FetchParams } from './pipeline';
export { STAGE_LABELS } from './progress';
export type { LidarProgress, LidarProgressStage, ProgressCallback } from './progress';

export async function fetchLidarShaded(params: BrowserFetchParams): Promise<LidarShadedCloudData> {
    const cached = await readCachedLidar('shaded', params);
    if (cached) {
        params.onProgress?.({ stage: 'done', message: 'Cache', detail: 'données en cache' });
        return cached;
    }
    const data = await worker.fetchLidarShaded(params);
    void writeCachedLidar('shaded', params, data);
    return data;
}

/**
 * Delaunay mode is not cached (composite of mesh + shaded; cache layer keeps
 * one Stored type per call). Always recomputes.
 */
export async function fetchLidarDelaunay(params: BrowserFetchParams): Promise<LidarMixedData> {
    return worker.fetchLidarDelaunay(params);
}

/** Poisson reconstruction mode (WASM PoissonRecon). Not cached. */
export async function fetchLidarPoisson(params: BrowserFetchParams): Promise<LidarMixedData> {
    return worker.fetchLidarPoisson(params);
}

