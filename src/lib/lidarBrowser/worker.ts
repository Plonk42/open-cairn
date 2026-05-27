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
 *
 * All large outputs (positions / normals / colors / classifications /
 * indices) are sent back as transferables so the buffers move zero-copy
 * across the worker boundary.
 */
/// <reference lib="webworker" />
import { fetchLidarCloudBrowser, fetchLidarMeshBrowser, fetchLidarShadedBrowser, type BrowserFetchParams } from './pipeline';

type RequestMessage =
    | { id: number; kind: 'cloud'; params: BrowserFetchParams }
    | { id: number; kind: 'mesh'; params: BrowserFetchParams }
    | { id: number; kind: 'shaded'; params: BrowserFetchParams };

declare const self: DedicatedWorkerGlobalScope;

/**
 * Collect every `ArrayBuffer` underlying the TypedArray fields of a result
 * so they can be transferred back to the main thread.
 */
function collectTransferables(obj: Record<string, unknown>): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (const v of Object.values(obj)) {
        if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer);
    }
    return out;
}

self.onmessage = async (ev: MessageEvent<RequestMessage>) => {
    const { id, kind, params } = ev.data;
    try {
        let data: Record<string, unknown>;
        switch (kind) {
            case 'cloud': data = await fetchLidarCloudBrowser(params) as unknown as Record<string, unknown>; break;
            case 'mesh':  data = await fetchLidarMeshBrowser(params) as unknown as Record<string, unknown>;  break;
            case 'shaded':data = await fetchLidarShadedBrowser(params) as unknown as Record<string, unknown>; break;
        }
        const transferables = collectTransferables(data);
        self.postMessage({ id, ok: true, data }, transferables);
    } catch (err) {
        const e = err as Error & { code?: string };
        self.postMessage({ id, ok: false, error: { message: e.message ?? String(err), code: e.code } });
    }
};
