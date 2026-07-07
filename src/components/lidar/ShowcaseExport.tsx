import { ExportDialog, type ExportResolutionScale, type ExportTarget } from '@/components/lidar/ExportDialog';
import { saveScene } from '@/lib/savedScenes';
import { extractAmbiance } from '@/lib/showcaseAmbiance';
import { encodeShowcaseGeometry, serializeShowcaseManifest, type ShowcaseScene } from '@/lib/showcaseScene';
import { useMapStore } from '@/stores/mapStore';
import { zipSync, type Zippable } from 'fflate';
import { useState } from 'react';

const MAX_BLOB_BYTES = 500 * 1024 * 1024;

function DownloadIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
    );
}

function timestampId(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `scene-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Best-effort webp thumbnail of the current rendered frame. */
async function captureThumbnail(): Promise<Uint8Array | null> {
    const map = useMapStore.getState().mapInstance;
    if (!map) return null;
    const canvas = map.getCanvas();
    const blob = await new Promise<Blob | null>((resolve) => {
        try {
            canvas.toBlob((b) => resolve(b), 'image/webp', 0.85);
        } catch {
            resolve(null);
        }
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
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
 * Download the current rendered frame straight to a standard `.png` image.
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
 */
async function downloadFrame(filename: string, resolution: ExportResolutionScale): Promise<boolean> {
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

/** Bundle the baked geometry, manifest and thumbnail into a single `.zip`. */
function downloadSceneZip(scene: ShowcaseScene, bytes: Uint8Array, thumb: Uint8Array | null) {
    // The scene files are already compressed (.bin via meshoptimizer, .webp as
    // an image), so the zip just bundles them with STORE (level 0) — a single
    // download instead of three file pickers.
    const files: Zippable = {
        [`${scene.id}.bin`]: [bytes, { level: 0 }],
        [`${scene.id}.json`]: [new TextEncoder().encode(serializeShowcaseManifest(scene)), { level: 0 }],
    };
    if (thumb) files[`${scene.id}.webp`] = [thumb, { level: 0 }];
    const zip = zipSync(files);
    triggerDownload(new Blob([zip], { type: 'application/zip' }), `${scene.id}.zip`);
}

function buildScene(id: string, title: string, description: string): ShowcaseScene | null {
    const st = useMapStore.getState();
    if (st.lidarShaded === null && st.lidarMesh === null) return null;
    const map = st.mapInstance;
    const center = map ? map.getCenter() : { lng: st.view.longitude, lat: st.view.latitude };
    return {
        id,
        title: title.trim() || id,
        description: description.trim() || undefined,
        camera: {
            center: [center.lng, center.lat],
            zoom: map ? map.getZoom() : st.view.zoom,
            pitch: map ? map.getPitch() : st.view.pitch,
            bearing: map ? map.getBearing() : st.view.bearing,
            centerElevation: map ? map.getCenterElevation() : undefined,
        },
        ambiance: extractAmbiance(st),
        shaded: st.lidarShaded,
        mesh: st.lidarMesh,
    };
}

/**
 * "Exporter cette vue" — bakes the current LiDAR geometry + ambiance + camera
 * into a showcase scene. The user picks where it goes:
 *  - "local"   : stored in the browser ("Mes vues" in the gallery), instant
 *                re-open, no file leaves the machine;
 *  - "download": a single `<id>.zip` bundling the three scene files
 *                (`<id>.bin` geometry, `<id>.json` manifest, `<id>.webp` thumb)
 *                — unzip into `public/showcase/` and add the `<id>` to
 *                `public/showcase/index.json` to publish it;
 *  - "both"    : stored locally *and* downloaded.
 */
export function ShowcaseExport() {
    const hasData = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [prompting, setPrompting] = useState(false);

    const runExport = async (title: string, description: string, target: ExportTarget) => {
        setPrompting(false);
        setError(null);
        const id = timestampId();
        const scene = buildScene(id, title, description);
        if (!scene) {
            setError('Aucun nuage chargé à exporter.');
            return;
        }
        setBusy(true);
        try {
            const bytes = await encodeShowcaseGeometry(scene);
            if (target.download && bytes.byteLength > MAX_BLOB_BYTES) {
                const mb = (bytes.byteLength / 1024 / 1024).toFixed(0);
                const proceed = globalThis.confirm(
                    `La scène fait ${mb} Mo (> 500 Mo). Réduire le rayon ou augmenter la décimation avant l'export. Télécharger quand même ?`,
                );
                if (!proceed) return;
            }
            const thumb = await captureThumbnail();

            if (target.local) {
                await saveScene(
                    { id, title: scene.title, description: scene.description },
                    { camera: scene.camera, ambiance: scene.ambiance, shaded: scene.shaded, mesh: scene.mesh },
                    thumb,
                );
            }

            if (target.download) downloadSceneZip(scene, bytes, thumb);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Échec de l’export.');
        } finally {
            setBusy(false);
        }
    };

    // Standalone shortcut: just grab the current frame as a .png, no scene,
    // no "Mes vues" entry, no zip.
    const onDownloadImage = async (resolution: ExportResolutionScale) => {
        setError(null);
        const ok = await downloadFrame(`${timestampId()}.png`, resolution);
        if (!ok) setError('Capture d’écran indisponible.');
    };

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                data-tutorial="export"
                onClick={() => { setError(null); setPrompting(true); }}
                disabled={!hasData || busy}
                title={hasData ? 'Exporter la vue actuelle en scène showcase' : 'Chargez un nuage pour exporter'}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10 disabled:opacity-40"
            >
                <DownloadIcon className="h-4 w-4" />
                <span>{busy ? 'Export…' : 'Exporter cette vue'}</span>
            </button>
            {error && <span className="text-xs text-rose-300">{error}</span>}

            {prompting && (
                <ExportDialog
                    onExport={(title, description, target) => { runExport(title, description, target); }}
                    onDownloadImage={(resolution) => { onDownloadImage(resolution); }}
                    onClose={() => setPrompting(false)}
                />
            )}
        </div>
    );
}
