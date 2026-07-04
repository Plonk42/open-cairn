/**
 * Shared message protocol for the mesh LOD (level-of-detail) simplification
 * Web Worker boundary — mirrors `workerProtocol.ts`'s shape/rationale but for
 * a separate dedicated worker. Kept independent from the LiDAR-pipeline
 * worker (`worker.ts`): simplification keeps running for the whole lifetime
 * of a loaded mesh (long after any pipeline fetch has completed), so sharing
 * a worker would let a slow simplification compete with — or get wiped out
 * by — an unrelated fetch cancellation (`cancelLidarWorkerRequests`
 * terminates the pipeline worker outright).
 *
 * Point-cloud LOD does NOT go through this worker: unlike triangles, points
 * can be decimated to an exact ratio with a trivial O(target) index stride,
 * cheap enough to run synchronously on the main thread (see `pointStrideIndices`
 * in `LidarWebGLLayer.ts`) — no WASM/worker round-trip, and no approximation
 * error (`MeshoptSimplifier.simplifyPoints`'s density-based clustering can
 * undershoot badly on a real LiDAR cloud's very non-uniform density).
 *
 *   main → worker:  {@link LodRequest}
 *   worker → main:  {@link LodResponse}
 */

/**
 * main → worker. `targets` holds one entry per coarser LOD level (finest
 * first, level 0 excluded since it's the untouched original geometry): the
 * target index count for that level.
 */
export interface LodRequest {
    id: number;
    positions: Float32Array;
    indices: Uint32Array;
    targets: number[];
}

/**
 * worker → main, streamed one `level` message per computed target so the
 * main thread can upload+use each level as soon as it's ready (mirrors the
 * progressive per-level behaviour of the previous main-thread implementation).
 */
export type LodResponse =
    | { id: number; type: 'level'; levelIndex: number; data: Uint32Array }
    | { id: number; type: 'done' }
    | { id: number; type: 'err'; error: string };
