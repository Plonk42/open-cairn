/**
 * Public entry-point for the browser-only LiDAR HD pipeline.
 *
 * Same surface as the service client (`../lidarCloud`) so the store can
 * switch backends without touching consumer code.
 *
 * Currently runs on the main thread; will be moved to a Web Worker in
 * a follow-up phase.
 */
export {
    fetchLidarCloudBrowser as fetchLidarCloud,
    fetchLidarMeshBrowser as fetchLidarMesh,
    fetchLidarShadedBrowser as fetchLidarShaded,
    type BrowserFetchParams as FetchParams,
} from './pipeline';
