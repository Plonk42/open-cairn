import {
    BLEND_MODES,
    BLEND_MODE_LABELS,
    type BlendMode,
} from '@/lib/compositeProtocol';
import { RENDER_QUALITY_LABELS, useMapStore, type RenderQuality, type UiTheme } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';

const RENDER_QUALITIES: RenderQuality[] = ['balanced', 'sharp'];
const UI_THEMES: Array<{ id: UiTheme; label: string }> = [
    { id: 'light', label: 'Clair' },
    { id: 'dark', label: 'Sombre' },
];

export function SettingsPanel() {
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const baseLayer = useMapStore((s) => s.baseLayer);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const setHillshadeIntensity = useMapStore((s) => s.setHillshadeIntensity);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const setHillshadeBlend = useMapStore((s) => s.setHillshadeBlend);
    const renderQuality = useMapStore((s) => s.renderQuality);
    const setRenderQuality = useMapStore((s) => s.setRenderQuality);
    const tileCacheSize = useMapStore((s) => s.tileCacheSize);
    const setTileCacheSize = useMapStore((s) => s.setTileCacheSize);
    const uiTheme = useMapStore((s) => s.uiTheme);
    const setUiTheme = useMapStore((s) => s.setUiTheme);
    const colorElevationBySlope = useRouteStore((s) => s.colorElevationBySlope);
    const setColorElevationBySlope = useRouteStore((s) => s.setColorElevationBySlope);
    const gpxImportWaypoints = useRouteStore((s) => s.gpxImportWaypoints);
    const setGpxImportWaypoints = useRouteStore((s) => s.setGpxImportWaypoints);

    return (
        <div className="space-y-4">
            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zm0 13a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zm-7-5a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 013 10zm13 0a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 0116 10zm-1.464-4.536a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 01-1.061-1.06l1.06-1.061a.75.75 0 011.061 0zm-9.193 9.193a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.061-1.06l1.06-1.06a.75.75 0 011.061 0zm9.193 0a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.061zM5.464 5.464a.75.75 0 011.06 0l1.061 1.061a.75.75 0 11-1.06 1.06L5.464 6.525a.75.75 0 010-1.06zM10 7a3 3 0 100 6 3 3 0 000-6z" />
                    </svg>
                    Apparence
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                    {UI_THEMES.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setUiTheme(id)}
                            className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${uiTheme === id
                                ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                                : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path d="M10 2a1 1 0 011 1v1.323a7.022 7.022 0 013.927 2.07l.936-.935a1 1 0 111.414 1.414l-.935.936A7.022 7.022 0 0118.412 12H19a1 1 0 110 2h-1.27a7.024 7.024 0 01-5.32 5.32V20a1 1 0 11-2 0v-.68A7.02 7.02 0 014.07 14H3a1 1 0 110-2h.588a7.022 7.022 0 012.07-3.927l-.936-.936a1 1 0 011.414-1.414l.936.935A7.022 7.022 0 019 4.323V3a1 1 0 011-1zm0 4a5 5 0 100 10 5 5 0 000-10z" />
                    </svg>
                    Ombrage
                </h3>
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Intensité</span>
                        <span className="font-mono text-xs text-slate-400">
                            {Math.round(hillshadeIntensity * 100)}%
                        </span>
                    </div>
                    <input
                        aria-label="Intensité ombrage"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={hillshadeIntensity}
                        onChange={(e) => setHillshadeIntensity(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
                <div className="mt-3">
                    <div className="mb-1 text-xs text-slate-500">Mode de fusion</div>
                    <select
                        value={hillshadeBlend}
                        disabled={!hillshadeEnabled || baseLayer === 'lidar'}
                        onChange={(e) => setHillshadeBlend(e.target.value as BlendMode)}
                        className="w-full rounded-md bg-gray-50 px-2 py-1.5 text-xs text-slate-700 ring-1 ring-gray-200 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
                    >
                        {BLEND_MODES.map((id) => (
                            <option key={id} value={id}>
                                {BLEND_MODE_LABELS[id]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909.47.47a.75.75 0 11-1.06 1.06L6.53 8.091a.75.75 0 00-1.06 0L2.5 11.06zm11-4.31a1.25 1.25 0 112.5 0 1.25 1.25 0 01-2.5 0z" clipRule="evenodd" />
                    </svg>
                    Rendu
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                    {RENDER_QUALITIES.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setRenderQuality(id)}
                            className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${renderQuality === id
                                ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                                : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {RENDER_QUALITY_LABELS[id]}
                        </button>
                    ))}
                </div>
                <label className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <span>Cache tuiles</span>
                    <input
                        aria-label="Taille du cache de tuiles composites"
                        type="number"
                        min={0}
                        max={1024}
                        step={32}
                        value={tileCacheSize}
                        onChange={(e) => {
                            const v = Math.max(0, Math.min(1024, Number(e.target.value) || 0));
                            setTileCacheSize(v);
                        }}
                        className="w-16 rounded-md bg-gray-50 px-2 py-1 text-center text-xs text-slate-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
                    />
                </label>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 00-1.147 0l-4.084 1.69A1.5 1.5 0 002 5.25v10.877a1.5 1.5 0 002.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 001.146 0l4.083-1.69A1.5 1.5 0 0018 14.75V3.872a1.5 1.5 0 00-2.073-1.386l-3.51 1.452-4.26-1.762zM7.58 5a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 017.58 5zm5.59 2.75a.75.75 0 00-1.5 0v6.5a.75.75 0 001.5 0v-6.5z" clipRule="evenodd" />
                    </svg>
                    Itinéraire
                </h3>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <span>Pente colorée sur le profil</span>
                    <input
                        type="checkbox"
                        checked={colorElevationBySlope}
                        onChange={(event) => setColorElevationBySlope(event.target.checked)}
                        className="h-4 w-4 accent-green-600"
                    />
                </label>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                    </svg>
                    Import / Export GPX
                </h3>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <span>Points intermédiaires</span>
                    <input
                        aria-label="Nombre de points intermédiaires à l'import GPX"
                        type="number"
                        min={0}
                        max={100}
                        value={gpxImportWaypoints}
                        onChange={(e) => {
                            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                            setGpxImportWaypoints(v);
                        }}
                        className="w-14 rounded-md bg-gray-50 px-2 py-1 text-center text-xs text-slate-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
                    />
                </label>
            </div>
        </div>
    );
}
