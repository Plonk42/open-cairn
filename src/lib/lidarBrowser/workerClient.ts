/**
 * Main-thread client for the LiDAR Web Worker. Lazily spawns a single
 * persistent worker; multiplexes concurrent requests by id.
 */
import type { LidarCloudData, LidarMeshData, LidarShadedCloudData } from '../lidarCloud';
import type { BrowserFetchParams } from './pipeline';

type Pending = {
    // Generic over the worker payload; treated as unknown by the multiplexer
    // and re-typed by the per-kind `dispatch` callers.
    resolve: (data: never) => void;
    reject: (err: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{
        id: number;
        ok: boolean;
        data?: unknown;
        error?: { message: string; code?: string };
    }>) => {
        const msg = ev.data;
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) {
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
 * Strip `signal` (and any other non-cloneable values) before sending the
 * params over `postMessage`. `AbortSignal` isn't structured-cloneable.
 *
 * Cancellation across the worker boundary is not implemented in this
 * phase — requests just run to completion. The map store already handles
 * race conditions by latest-wins on the returned data.
 */
function cleanParams(p: BrowserFetchParams): Omit<BrowserFetchParams, 'signal'> {
    const { signal: _ignored, ...rest } = p;
    return rest;
}

function dispatch<T>(kind: 'cloud' | 'mesh' | 'shaded', params: BrowserFetchParams): Promise<T> {
    const w = ensureWorker();
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, kind, params: cleanParams(params) });
    });
}

export function fetchLidarCloud(params: BrowserFetchParams): Promise<LidarCloudData> {
    return dispatch<LidarCloudData>('cloud', params);
}

export function fetchLidarMesh(params: BrowserFetchParams): Promise<LidarMeshData> {
    return dispatch<LidarMeshData>('mesh', params);
}

export function fetchLidarShaded(params: BrowserFetchParams): Promise<LidarShadedCloudData> {
    return dispatch<LidarShadedCloudData>('shaded', params);
}
