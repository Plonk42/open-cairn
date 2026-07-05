/**
 * Web Worker entry point for one Phase 2 (multi-worker) normals-computation
 * tile. Spawned in a NESTED fashion by `normalsPool.ts` from inside the
 * already-running pipeline worker (`worker.ts`) — not from the main thread.
 *
 * Pure delegation to `computeNormalsTile`: all the actual k-NN/PCA logic
 * (and its exact-parity requirements) lives in `normals.ts`.
 *
 * Protocol: see `./normalsWorkerProtocol`.
 */
/// <reference lib="webworker" />
import { computeNormalsTile } from './normals';
import type { NormalsTileRequest, NormalsTileResponse } from './normalsWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<NormalsTileRequest>) => {
    const { id, positions, queryLocalIndices, k, cellSize, forceUpward, origin, wantQuality } = ev.data;
    try {
        const { normals, quality } = computeNormalsTile(positions, queryLocalIndices, {
            k, cellSize, forceUpward, origin, wantQuality,
        });
        const transfer: Transferable[] = [normals.buffer];
        if (quality) transfer.push(quality.buffer);
        self.postMessage({ id, type: 'ok', normals, quality } satisfies NormalsTileResponse, transfer);
    } catch (err) {
        self.postMessage({ id, type: 'err', error: err instanceof Error ? err.message : String(err) } satisfies NormalsTileResponse);
    }
};
