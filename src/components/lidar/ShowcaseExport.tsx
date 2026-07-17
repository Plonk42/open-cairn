import { ExportDialog } from '@/components/lidar/ExportDialog';
import { saveScene } from '@/lib/savedScenes';
import { timestampId, triggerDownload } from '@/lib/screenshot';
import { extractAmbiance } from '@/lib/showcaseAmbiance';
import { encodeShowcaseGeometry, serializeShowcaseManifest, type ShowcaseScene } from '@/lib/showcaseScene';
import { useMapStore } from '@/stores/mapStore';
import { zipSync, type Zippable } from 'fflate';
import { useState } from 'react';

const MAX_BLOB_BYTES = 500 * 1024 * 1024;

/** Persisted export destination choice (survives across exports). */
const TARGET_KEY = 'open-cairn-export-target';

export interface ExportTarget {
    local: boolean;
    download: boolean;
}

function readTarget(): ExportTarget {
    try {
        const raw = localStorage.getItem(TARGET_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<ExportTarget>;
            return { local: parsed.local ?? true, download: parsed.download ?? false };
        }
    } catch { /* ignore */ }
    return { local: true, download: false };
}

function writeTarget(target: ExportTarget): void {
    try {
        localStorage.setItem(TARGET_KEY, JSON.stringify(target));
    } catch { /* ignore quota */ }
}

function DownloadIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
    );
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
    // Every currently-visible cloud gets bundled into the scene (not just the
    // primary one mirrored in `lidarShaded`/`lidarMesh`), so "Exporter cette
    // vue" restores the whole multi-cloud view in one shot on reload.
    const visibleClouds = st.lidarClouds.filter((c) => c.visible && (c.shaded !== null || c.mesh !== null));
    if (visibleClouds.length === 0) return null;
    const [primary, ...rest] = visibleClouds;
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
        shaded: primary.shaded,
        mesh: primary.mesh,
        extraClouds: rest.length > 0 ? rest.map((c) => ({ shaded: c.shaded, mesh: c.mesh })) : undefined,
    };
}

function ExportChoice({
    checked,
    onChange,
    title,
    desc,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }>) {
    return (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-black/5 px-3 py-2.5 ring-1 ring-black/5 transition hover:bg-black/10 hover:ring-green-400/50 dark:bg-white/5 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:ring-emerald-400/50">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={title}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-500"
            />
            <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-white">{title}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{desc}</span>
            </span>
        </label>
    );
}

/**
 * "Scène" tab of the export dialog: names the scene and picks where it goes
 * (local "Mes vues" and/or a downloaded `.zip`). Owns the form state and
 * persists the destination choice; `onExport` runs the actual export.
 */
function SceneExportForm({ onExport }: Readonly<{ onExport: (title: string, description: string, target: ExportTarget) => void }>) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [target, setTarget] = useState<ExportTarget>(() => readTarget());

    const updateTarget = (patch: Partial<ExportTarget>) => {
        setTarget((prev) => {
            const next = { ...prev, ...patch };
            writeTarget(next);
            return next;
        });
    };

    return (
        <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                Donnez un titre et une description, puis choisissez où enregistrer la scène.
            </p>
            <div className="mt-4 space-y-3">
                <label className="block">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Titre</span>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Ex. Rocher de Chalves"
                        autoFocus
                        className="mt-1 w-full rounded-md bg-gray-50 px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-gray-200 placeholder:text-slate-400 focus:outline-none focus:ring-green-400/60 dark:bg-white/5 dark:text-white dark:ring-white/15 dark:placeholder:text-slate-500"
                    />
                </label>
                <label className="block">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Description <span className="text-slate-400 dark:text-slate-500">(optionnel)</span></span>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ex. Les Rochers de Chalves, au coucher du soleil."
                        rows={2}
                        className="mt-1 w-full resize-none rounded-md bg-gray-50 px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-gray-200 placeholder:text-slate-400 focus:outline-none focus:ring-green-400/60 dark:bg-white/5 dark:text-white dark:ring-white/15 dark:placeholder:text-slate-500"
                    />
                </label>
            </div>
            <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Enregistrer&nbsp;:</p>
            <div className="mt-2 space-y-2">
                <ExportChoice
                    checked={target.local}
                    onChange={(v) => updateTarget({ local: v })}
                    title="Stocker dans « Mes vues »"
                    desc="Enregistre la scène dans le navigateur pour la rouvrir instantanément."
                />
                <ExportChoice
                    checked={target.download}
                    onChange={(v) => updateTarget({ download: v })}
                    title="Télécharger"
                    desc="Télécharge un fichier .zip (à publier dans la galerie showcase)."
                />
            </div>
            <button
                type="button"
                onClick={() => { onExport(title, description, target); }}
                disabled={!target.local && !target.download}
                className="mt-4 w-full rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-400 disabled:opacity-40"
            >
                Exporter
            </button>
        </div>
    );
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
 *
 * The dialog shares its first "Image" tab (a plain `.png` screenshot) with the
 * Itinéraire view; this "Scène" export lives on the second tab.
 */
export function ShowcaseExport() {
    const hasData = useMapStore((s) => s.lidarClouds.some((c) => c.visible && (c.shaded !== null || c.mesh !== null)));
    const cloudCount = useMapStore((s) => s.lidarClouds.filter((c) => c.visible && (c.shaded !== null || c.mesh !== null)).length);
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
                    { camera: scene.camera, ambiance: scene.ambiance, shaded: scene.shaded, mesh: scene.mesh, extraClouds: scene.extraClouds },
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

    const cloudSuffix = cloudCount > 1 ? 's' : '';
    const exportTitle = hasData
        ? `Exporter la vue actuelle (${cloudCount} nuage${cloudSuffix})`
        : 'Chargez un nuage pour exporter la scène';

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                data-tutorial="export"
                onClick={() => { setError(null); setPrompting(true); }}
                disabled={busy}
                title={exportTitle}
                className="inline-flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 disabled:opacity-40 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
            >
                <DownloadIcon className="h-4 w-4" />
                <span>{busy ? 'Export…' : 'Exporter cette vue'}</span>
            </button>
            {error && <span className="text-xs text-rose-500 dark:text-rose-300">{error}</span>}

            {prompting && (
                <ExportDialog
                    secondTabLabel="Scène"
                    secondTab={
                        hasData ? (
                            <SceneExportForm onExport={(title, description, target) => { runExport(title, description, target); }} />
                        ) : (
                            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                                Chargez un nuage LiDAR pour exporter la scène.
                            </p>
                        )
                    }
                    onClose={() => setPrompting(false)}
                />
            )}
        </div>
    );
}
