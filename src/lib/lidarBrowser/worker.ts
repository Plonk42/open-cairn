/**
 * Web Worker entry point for the browser LiDAR pipeline.
 *
 * Runs in its own thread so the COPC decode + k-NN normals + Delaunay mesh
 * (the heavy parts) never block the React/MapLibre main thread. The whole
 * pipeline is pure compute on typed arrays, so it ports cleanly.
 *
 * Protocol:
 *   main → worker: { id, kind: 'cloud'|'mesh'|'shaded', params }
 *   worker → main: { id, ok: true,  data, transferables: ArrayBuffer[] }
 *                | { id, ok: false, error: { message, code? } }
 *                | { id, type: 'progress', progress: LidarProgress }
 *
 * All large outputs (positions / normals / colors / classifications /
 * indices) are sent back as transferables so the buffers move zero-copy
 * across the worker boundary.
 */
/// <reference lib="webworker" />
import { fetchLidarCloudBrowser, fetchLidarMeshBrowser, fetchLidarMixedBrowser, fetchLidarShadedBrowser, type BrowserFetchParams } from './pipeline';
import type { LidarProgress } from './progress';

type RequestMessage =
    | { id: number; kind: 'cloud'; params: BrowserFetchParams }
    | { id: number; kind: 'mesh'; params: BrowserFetchParams }
    | { id: number; kind: 'shaded'; params: BrowserFetchParams }
    | { id: number; kind: 'mixed'; params: BrowserFetchParams };

declare const self: DedicatedWorkerGlobalScope;

/**
 * Collect every `ArrayBuffer` underlying the TypedArray fields of a result
 * so they can be transferred back to the main thread. Recurses one level
 * into nested objects (mixed mode wraps mesh + shaded).
 */
function collectTransferables(obj: Record<string, unknown>): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    const seen = new Set<ArrayBuffer>();
    const add = (b: ArrayBuffer) => { if (!seen.has(b)) { seen.add(b); out.push(b); } };
    const visit = (v: unknown) => {
        if (ArrayBuffer.isView(v)) add(v.buffer as ArrayBuffer);
        else if (v && typeof v === 'object') {
            for (const inner of Object.values(v as Record<string, unknown>)) {
                if (ArrayBuffer.isView(inner)) add(inner.buffer as ArrayBuffer);
            }
        }
    };
    for (const v of Object.values(obj)) visit(v);
    return out;
}

self.onmessage = async (ev: MessageEvent<RequestMessage>) => {
    const { id, kind, params } = ev.data;
    // Create a progress callback that sends progress to the main thread
    const onProgress = (progress: LidarProgress) => {
        self.postMessage({ id, type: 'progress', progress });
    };
    const paramsWithProgress = { ...params, onProgress };
    try {
        let data: Record<string, unknown>;
        switch (kind) {
            case 'cloud': data = await fetchLidarCloudBrowser(paramsWithProgress) as unknown as Record<string, unknown>; break;
            case 'mesh': data = await fetchLidarMeshBrowser(paramsWithProgress) as unknown as Record<string, unknown>; break;
            case 'shaded': data = await fetchLidarShadedBrowser(paramsWithProgress) as unknown as Record<string, unknown>; break;
            case 'mixed': data = await fetchLidarMixedBrowser(paramsWithProgress) as unknown as Record<string, unknown>; break;
        }
        const transferables = collectTransferables(data);
        self.postMessage({ id, ok: true, data }, transferables);
    } catch (err) {
        const e = err as Error & { code?: string };
        self.postMessage({ id, ok: false, error: { message: e.message ?? String(err), code: e.code } });
    }
};
