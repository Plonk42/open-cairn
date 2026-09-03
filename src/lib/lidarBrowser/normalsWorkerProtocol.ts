/**
 * Message protocol for `normalsWorker.ts` — the per-tile Phase 2 (multi-worker)
 * normals computation Web Worker. Mirrors `lodWorkerProtocol.ts`'s shape.
 *
 * Spawned in a NESTED fashion: `normalsPool.ts` creates a small pool of these
 * workers from *inside* the already-running pipeline worker (`worker.ts`),
 * not from the main thread.
 *
 *   pool → worker:  {@link NormalsTileRequest}
 *   worker → pool:  {@link NormalsTileResponse}
 */

/** pool → worker. One tile's worth of work — see `normalsTiling.ts`'s `NormalsTilePlan`. */
export interface NormalsTileRequest {
    id: number;
    /** Interleaved (x, y, z), ascending-global-index order (see `NormalsTilePlan.localPositions`). */
    positions: Float32Array;
    /** Local indices (into `positions`) of this tile's query points. */
    queryLocalIndices: Int32Array;
    k: number;
    cellSize: number;
    forceUpward: boolean;
    origin: { minX: number; minY: number; minZ: number };
    wantQuality: boolean;
    /** Crease-preserving robust refit strength, 0..1 (0 = plain k-NN PCA). */
    robust: number;
}

/** worker → pool. */
export type NormalsTileResponse =
    | { id: number; type: 'ok'; normals: Float32Array; quality?: Float32Array }
    | { id: number; type: 'err'; error: string };
