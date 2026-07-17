import {
    RESOLUTION_OPTIONS,
    downloadMapScreenshot,
    readResolution,
    timestampId,
    writeResolution,
    type ExportResolutionScale,
} from '@/lib/screenshot';
import { useState } from 'react';
import { createPortal } from 'react-dom';

function DownloadIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
    );
}

/**
 * Itinéraire-view export: a screenshot-only counterpart to the Studio's
 * `ShowcaseExport`. Saving a LiDAR scene makes no sense for a route, but
 * exporting a `.png` of the current map view does. Theme-aware (follows
 * `uiTheme`), and lightweight — it pulls none of the scene-baking / zip code.
 */
export function ScreenshotButton() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resolution, setResolution] = useState<ExportResolutionScale>(() => readResolution());

    const download = async () => {
        setBusy(true);
        setError(null);
        const ok = await downloadMapScreenshot(`${timestampId()}.png`, resolution);
        setBusy(false);
        if (ok) setOpen(false);
        else setError('Capture d’écran indisponible.');
    };

    return (
        <>
            <button
                type="button"
                onClick={() => { setError(null); setOpen(true); }}
                title="Exporter une image de la vue actuelle"
                className="inline-flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
            >
                <DownloadIcon className="h-4 w-4" />
                <span>Exporter l’image</span>
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Exporter l’image</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Télécharge une capture <code>.png</code> de la vue actuelle de la carte.
                        </p>
                        <label className="mt-4 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Résolution de l’image</span>
                            <select
                                value={resolution}
                                onChange={(e) => {
                                    const v = Number(e.target.value) as ExportResolutionScale;
                                    setResolution(v);
                                    writeResolution(v);
                                }}
                                className="rounded-md bg-gray-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-gray-200 focus:outline-none focus:ring-green-400/60 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600"
                            >
                                {RESOLUTION_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {error && <p className="mt-3 text-center text-xs text-rose-500 dark:text-rose-300">{error}</p>}
                        <div className="mt-4 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="flex-1 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-300 dark:ring-white/15 dark:hover:bg-white/10"
                            >
                                Annuler
                            </button>
                            <button
                                type="button"
                                onClick={download}
                                disabled={busy}
                                className="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-green-500 disabled:opacity-50"
                            >
                                {busy ? 'Export…' : 'Télécharger (.png)'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
