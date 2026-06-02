/**
 * Main-thread client for the LiDAR Web Worker. Lazily spawns a single
 * persistent worker; multiplexes concurrent requests by id.
 */
import type { LidarMixedData, LidarShadedCloudData } from '../lidarCloud';
import type { BrowserFetchParams } from './pipeline';
import type { LidarProgress, ProgressCallback } from './progress';

type Pending = {
    // Generic over the worker payload; treated as unknown by the multiplexer
    // and re-typed by the per-kind `dispatch` callers.
    resolve: (data: never) => void;
    reject: (err: Error) => void;
    onProgress?: ProgressCallback;
};

type WorkerResultOk = { id: number; type: 'ok'; data: unknown };
type WorkerResultErr = { id: number; type: 'err'; error: { message: string; code?: string } };
type WorkerProgress = { id: number; type: 'progress'; progress: LidarProgress };
type WorkerMessage = WorkerResultOk | WorkerResultErr | WorkerProgress;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const msg = ev.data;
        const p = pending.get(msg.id);
        if (!p) return;
        if (msg.type === 'progress') {
            if (p.onProgress) p.onProgress(msg.progress);
            return;
        }
        pending.delete(msg.id);
        if (msg.type === 'ok') {
            (p.resolve as (v: unknown) => void)(msg.data);
        } else {
            const err = new Error(msg.error?.message ?? 'Worker error') as Error & { code?: string };
            if (msg.error?.code) err.code = msg.error.code;
            p.reject(err);
        }
    };
    worker.onerror = (ev) => {
        // Reject everything in flight; the worker is likely dead.
        for (const [, p] of pending) p.reject(new Error(ev.message || 'Worker crashed'));
        pending.clear();
        worker?.terminate();
        worker = null;
    };
    return worker;
}

/**
 * Strip non-cloneable values (`signal`, `onProgress`) before sending the
 * params over `postMessage`. `AbortSignal` and functions aren't structured-cloneable.
 *
 * Cancellation across the worker boundary is not implemented in this
 * phase — requests just run to completion. The map store already handles
 * race conditions by latest-wins on the returned data.
 */
function cleanParams(p: BrowserFetchParams): Omit<BrowserFetchParams, 'signal' | 'onProgress'> {
    const { signal: _ignored, onProgress: _ignored2, ...rest } = p;
    return rest;
}

function dispatch<T>(kind: 'shaded' | 'delaunay' | 'poisson', params: BrowserFetchParams): Promise<T> {
    const w = ensureWorker();
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress: params.onProgress });
        w.postMessage({ id, kind, params: cleanParams(params) });
    });
}

export function fetchLidarShaded(params: BrowserFetchParams): Promise<LidarShadedCloudData> {
    return dispatch<LidarShadedCloudData>('shaded', params);
}

export function fetchLidarDelaunay(params: BrowserFetchParams): Promise<LidarMixedData> {
    return dispatch<LidarMixedData>('delaunay', params);
}

export function fetchLidarPoisson(params: BrowserFetchParams): Promise<LidarMixedData> {
    return dispatch<LidarMixedData>('poisson', params);
}
