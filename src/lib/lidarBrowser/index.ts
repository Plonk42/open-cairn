/**
 * Public entry-point (barrel) for the browser-only LiDAR HD pipeline.
 *
 * Layers (innermost to outermost):
 *   pipeline.ts      pure compute, runs on whatever thread imports it
 *   worker.ts        DedicatedWorker boundary for the heavy CPU work
 *   workerClient.ts  main-thread promise-based dispatcher
 *   index.ts (here)  single import path exposed to the store / UI
 */
export type { BrowserFetchParams as FetchParams } from './pipeline';
export { STAGE_LABELS } from './progress';
export type { LidarProgress, LidarProgressStage, ProgressCallback } from './progress';
export { cancelLidarWorkerRequests, fetchLidarDelaunay, fetchLidarPoisson, fetchLidarShaded } from './workerClient';

