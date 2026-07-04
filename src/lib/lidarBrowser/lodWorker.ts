/**
 * Web Worker entry point for LiDAR mesh LOD (level-of-detail) simplification.
 *
 * Runs `meshoptimizer` triangle-mesh simplification off the main thread. On a
 * dense gallery-scene mesh, computing the 4 coarser LOD levels can take
 * several seconds of synchronous WASM work per level; this used to be
 * deferred via `requestIdleCallback` on the main thread, but idle callbacks
 * are not preemptible once started, so the whole page still froze for that
 * entire duration right after a cloud finished loading (the mesh was already
 * visible, but navigation stayed janky). Moving the computation here keeps
 * the UI thread free; results stream back one `level` message at a time so
 * the main thread can start using each level as soon as it's ready.
 *
 * Point-cloud LOD doesn't go through this worker — see `lodWorkerProtocol.ts`.
 *
 * Protocol: see `./lodWorkerProtocol`.
 */
/// <reference lib="webworker" />
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { LodRequest, LodResponse } from './lodWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
    ready ??= MeshoptSimplifier.ready;
    return ready;
}

self.onmessage = async (ev: MessageEvent<LodRequest>) => {
    const { id, positions, indices, targets } = ev.data;
    try {
        await ensureReady();
        for (let i = 0; i < targets.length; i++) {
            const [data] = MeshoptSimplifier.simplify(indices, positions, 3, Math.max(3, targets[i]), 0.1, ['LockBorder']);
            self.postMessage({ id, type: 'level', levelIndex: i, data } satisfies LodResponse, [data.buffer]);
        }
        self.postMessage({ id, type: 'done' } satisfies LodResponse);
    } catch (err) {
        self.postMessage({ id, type: 'err', error: err instanceof Error ? err.message : String(err) } satisfies LodResponse);
    }
};
