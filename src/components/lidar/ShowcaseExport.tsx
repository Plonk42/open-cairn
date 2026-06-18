import { saveScene } from '@/lib/savedScenes';
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

/** Persisted export destination choice (survives across exports). */
const TARGET_KEY = 'open-cairn-export-target';

interface ExportTarget {
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

/** Download the current rendered frame straight to a standard `.png` image. */
async function downloadFrame(filename: string): Promise<boolean> {
    const map = useMapStore.getState().mapInstance;
    if (!map) return false;
    const canvas = map.getCanvas();
    const blob = await new Promise<Blob | null>((resolve) => {
        try {
            canvas.toBlob((b) => resolve(b), 'image/png');
        } catch {
            resolve(null);
        }
    });
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
        ambiance: {
            lidarMode: st.lidarMode,
            lidarShader: st.lidarShader,
            lidarSunDate: st.lidarSunDate,
            lidarShadows: st.lidarShadows,
            lidarShadowStrength: st.lidarShadowStrength,
            lidarCloudEdl: st.lidarCloudEdl,
            lidarCloudEdlStrength: st.lidarCloudEdlStrength,
            lidarCloudEdlRadius: st.lidarCloudEdlRadius,
            lidarCloudEdlFarPlane: st.lidarCloudEdlFarPlane,
            lidarCloudPointSize: st.lidarCloudPointSize,
            lidarCloudSizeCompensation: st.lidarCloudSizeCompensation,
            lidarCloudOpacity: st.lidarCloudOpacity,
            lidarCloudPhotoOpacity: st.lidarCloudPhotoOpacity,
            lidarCloudBasemapOpacity: st.lidarCloudBasemapOpacity,
            lidarCloudClasses: st.lidarCloudClasses,
        },
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
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [target, setTarget] = useState<ExportTarget>(() => readTarget());

    const openPrompt = () => {
        setTitle('');
        setDescription('');
        setError(null);
        setPrompting(true);
    };

    const updateTarget = (patch: Partial<ExportTarget>) => {
        setTarget((prev) => {
            const next = { ...prev, ...patch };
            writeTarget(next);
            return next;
        });
    };

    const runExport = async () => {
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
    const onDownloadImage = async () => {
        setError(null);
        const ok = await downloadFrame(`${timestampId()}.png`);
        if (!ok) setError('Capture d’écran indisponible.');
    };

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={openPrompt}
                disabled={!hasData || busy}
                title={hasData ? 'Exporter la vue actuelle en scène showcase' : 'Chargez un nuage pour exporter'}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10 disabled:opacity-40"
            >
                <DownloadIcon className="h-4 w-4" />
                <span>{busy ? 'Export…' : 'Exporter cette vue'}</span>
            </button>
            {error && <span className="text-xs text-rose-300">{error}</span>}

            {prompting && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="dark w-full max-w-sm rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
                        <h3 className="text-sm font-semibold text-white">Exporter cette vue</h3>
                        <p className="mt-1 text-xs text-slate-400">
                            Donnez un titre et une description, puis choisissez où enregistrer la scène.
                        </p>
                        <div className="mt-4 space-y-3">
                            <label className="block">
                                <span className="text-xs font-medium text-slate-300">Titre</span>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Ex. Rocher de Chalves"
                                    autoFocus
                                    className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white ring-1 ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-slate-300">Description <span className="text-slate-500">(optionnel)</span></span>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Ex. Les Rochers de Chalves, au coucher du soleil."
                                    rows={2}
                                    className="mt-1 w-full resize-none rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white ring-1 ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
                                />
                            </label>
                        </div>
                        <p className="mt-4 text-xs font-medium text-slate-400">Enregistrer&nbsp;:</p>
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
                        <div className="mt-4 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPrompting(false)}
                                className="flex-1 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/15 transition hover:bg-white/10"
                            >
                                Annuler
                            </button>
                            <button
                                type="button"
                                onClick={() => { runExport(); }}
                                disabled={!target.local && !target.download}
                                className="flex-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-400 disabled:opacity-40"
                            >
                                Exporter
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => { onDownloadImage(); }}
                            className="mt-3 w-full rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
                        >
                            Télécharger seulement l’image (.png)
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ExportChoice({
    checked,
    onChange,
    title,
    desc,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }>) {
    return (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-emerald-400/50">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={title}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-500"
            />
            <span>
                <span className="block text-sm font-medium text-white">{title}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{desc}</span>
            </span>
        </label>
    );
}
