/**
 * Single source of truth for a loaded LiDAR cloud's custom WebGL layer id.
 *
 * Shared by `LidarCloudOverlay` (which creates/removes the layer) and
 * `MapContainer` (which re-asserts the layer's z-order after a style rebuild).
 * Keeping the id format in one place avoids the class of bug where a consumer
 * hard-codes a stale layer name (e.g. the old static `lidar-shaded-cloud`) and
 * silently no-ops once the naming changes.
 */
export const lidarCloudLayerId = (cloudId: string): string => `lidar-cloud-${cloudId}`;
