import {
    RESOLUTION_OPTIONS,
    downloadMapScreenshot,
    readResolution,
    timestampId,
    writeResolution,
    type ExportResolutionScale,
} from '@/lib/screenshot';
import { useState } from 'react';

/**
 * Shared screenshot export UI: pick a resolution and download a `.png` of the
 * current rendered map frame. This is the single source of truth for the
 * "Image" tab of the export dialog in *both* views (Itinéraire + LiDAR Studio)
 * — the resolution select + download button used to be duplicated in each
 * view's dialog. Self-contained (owns its own busy/error state) and
 * theme-aware (light default + `dark:` variants).
 */
export function ScreenshotTab() {
    const [resolution, setResolution] = useState<ExportResolutionScale>(() => readResolution());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const download = async () => {
        setBusy(true);
        setError(null);
        const ok = await downloadMapScreenshot(`${timestampId()}.png`, resolution);
        setBusy(false);
        if (!ok) setError('Capture d’écran indisponible.');
    };

    return (
        <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
            <button
                type="button"
                onClick={download}
                disabled={busy}
                className="mt-4 w-full rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-green-500 disabled:opacity-50"
            >
                {busy ? 'Export…' : 'Télécharger l’image (.png)'}
            </button>
        </div>
    );
}
