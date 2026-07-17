import { useMapStore } from '@/stores/mapStore';

/** Supersampling multiplier applied on top of the map's current pixel ratio. */
export type ExportResolutionScale = 1 | 2 | 3 | 4;

export const RESOLUTION_OPTIONS: ReadonlyArray<{ value: ExportResolutionScale; label: string }> = [
    { value: 1, label: 'Écran (×1)' },
    { value: 2, label: 'Haute définition (×2)' },
    { value: 3, label: 'Très haute définition (×3)' },
    { value: 4, label: 'Ultra HD (×4)' },
];

const RESOLUTION_KEY = 'open-cairn-export-resolution';

export function readResolution(): ExportResolutionScale {
    try {
        const raw = localStorage.getItem(RESOLUTION_KEY);
        const n = raw ? Number(raw) : 1;
        if (n === 2 || n === 3 || n === 4) return n;
    } catch { /* ignore */ }
    return 1;
}

export function writeResolution(scale: ExportResolutionScale): void {
    try {
        localStorage.setItem(RESOLUTION_KEY, String(scale));
    } catch { /* ignore quota */ }
}

/** Timestamped id / filename base, e.g. `scene-20260717-014530`. */
export function timestampId(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `scene-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Trigger a browser download of a blob under the given filename. */
export function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Resolves after two animation frames — enough for a Zustand store update to
 *  flow through a subscribed component's `useEffect` (here, `LidarCloudOverlay`
 *  pushing `lodForceLevel` into its `LidarWebGLLayer.setConfig`) and land in
 *  time for the next real paint. */
function waitTwoFrames(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * Download the current rendered map frame straight to a standard `.png` image.
 *
 * Temporary overrides are applied for the capture, then restored once the
 * frame's been read back:
 *  - the distance-based point/mesh LOD is pinned to level 0 (full detail) —
 *    exported screenshots shouldn't bake in the decimation used to keep
 *    interactive framerates smooth while panning/zooming;
 *  - when `resolution` is greater than 1, the map's pixel ratio is boosted
 *    (supersampled) so the exported image is sharper than what's currently
 *    on screen — and the point-size multiplier is boosted by the same
 *    factor, since `gl_PointSize` is in drawing-buffer pixels: without this,
 *    non-ground points (rendered as GL points, unlike the ground mesh) would
 *    shrink relative to the exported image.
 *
 * The LiDAR overrides are no-ops when no cloud is loaded, so this works for a
 * plain map screenshot in the Itinéraire view too.
 */
export async function downloadMapScreenshot(filename: string, resolution: ExportResolutionScale): Promise<boolean> {
    const map = useMapStore.getState().mapInstance;
    if (!map) return false;

    const originalLodForceLevel = useMapStore.getState().lidarLodForceLevel;
    const originalPointSizeMultiplier = useMapStore.getState().lidarPointSizeMultiplier;
    useMapStore.getState().setLidarLodForceLevel(0);
    useMapStore.getState().setLidarPointSizeMultiplier(resolution);
    await waitTwoFrames();

    const originalRatio = map.getPixelRatio();
    const boosted = resolution > 1;
    if (boosted) map.setPixelRatio(originalRatio * resolution);

    await new Promise<void>((resolve) => {
        map.once('render', () => resolve());
        map.triggerRepaint();
    });

    const canvas = map.getCanvas();
    const blob = await new Promise<Blob | null>((resolve) => {
        try {
            canvas.toBlob((b) => resolve(b), 'image/png');
        } catch {
            resolve(null);
        }
    });

    if (boosted) map.setPixelRatio(originalRatio);
    useMapStore.getState().setLidarLodForceLevel(originalLodForceLevel);
    useMapStore.getState().setLidarPointSizeMultiplier(originalPointSizeMultiplier);
    map.triggerRepaint();

    if (!blob) return false;
    triggerDownload(blob, filename);
    return true;
}
