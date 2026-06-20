/**
 * Shared message protocol for the LiDAR Web Worker boundary.
 *
 * Single source of truth for the request/response shapes exchanged between
 * the main-thread client ({@link ./workerClient}) and the worker entry point
 * ({@link ./worker}). Keeping these in one module prevents the two sides from
 * drifting out of sync.
 *
 *   main → worker:  {@link WorkerRequest}
 *   worker → main:  {@link WorkerResponse}
 */
import type { BrowserFetchParams } from './pipeline';
import type { LidarProgress } from './progress';

/** Reconstruction kinds the worker can run. */
export type LidarWorkerKind = 'shaded' | 'delaunay' | 'poisson';

/**
 * Params as sent over `postMessage`: the non-cloneable fields (`signal`,
 * `onProgress`) are stripped on the client before transfer.
 */
export type WorkerRequestParams = Omit<BrowserFetchParams, 'signal' | 'onProgress'>;

/** main → worker. */
export interface WorkerRequest {
    id: number;
    kind: LidarWorkerKind;
    params: WorkerRequestParams;
}

/** worker → main. */
export type WorkerResponse =
    | { id: number; type: 'ok'; data: unknown }
    | { id: number; type: 'err'; error: { message: string; code?: string } }
    | { id: number; type: 'progress'; progress: LidarProgress };
