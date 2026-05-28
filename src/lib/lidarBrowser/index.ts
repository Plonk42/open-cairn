/**
 * Public entry-point for the browser-only LiDAR HD pipeline.
 *
 * Same surface as the service client (`../lidarCloud`) so the store can
 * switch backends without touching consumer code.
 *
 * Layers (innermost to outermost):
 *   pipeline.ts      pure compute, runs on whatever thread imports it
 *   worker.ts        DedicatedWorker boundary for the heavy CPU work
 *   workerClient.ts  main-thread promise-based dispatcher
 *   cache.ts         IndexedDB key/value cache of assembled results
 *   index.ts (here)  cache-first wrappers exposed to the store
 */
import type { LidarCloudData, LidarMeshData, LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import { readCachedLidar, writeCachedLidar } from './cache';
import type { BrowserFetchParams } from './pipeline';
import * as worker from './workerClient';

export { clearLidarCache } from './cache';
export type { BrowserFetchParams as FetchParams, MeshMethod } from './pipeline';
export type { LidarProgress, ProgressCallback } from './progress';

export async function fetchLidarCloud(params: BrowserFetchParams): Promise<LidarCloudData> {
    const cached = await readCachedLidar('cloud', params);
    if (cached) {
        params.onProgress?.({ stage: 'done', message: 'Cache', detail: 'données en cache' });
        return cached as LidarCloudData;
    }
    const data = await worker.fetchLidarCloud(params);
    void writeCachedLidar('cloud', params, data);
    return data;
}

export async function fetchLidarMesh(params: BrowserFetchParams): Promise<LidarMeshData> {
    const cached = await readCachedLidar('mesh', params);
    if (cached) {
        params.onProgress?.({ stage: 'done', message: 'Cache', detail: 'données en cache' });
        return cached as LidarMeshData;
    }
    const data = await worker.fetchLidarMesh(params);
    void writeCachedLidar('mesh', params, data);
    return data;
}

export async function fetchLidarShaded(params: BrowserFetchParams): Promise<LidarShadedCloudData> {
    const cached = await readCachedLidar('shaded', params);
    if (cached) {
        params.onProgress?.({ stage: 'done', message: 'Cache', detail: 'données en cache' });
        return cached as LidarShadedCloudData;
    }
    const data = await worker.fetchLidarShaded(params);
    void writeCachedLidar('shaded', params, data);
    return data;
}

/**
 * Mixed mode is not cached (composite of mesh + shaded; cache layer keeps
 * one Stored type per call). Always recomputes.
 */
export async function fetchLidarMixed(params: BrowserFetchParams): Promise<LidarMixedData> {
    return worker.fetchLidarMixed(params);
}

