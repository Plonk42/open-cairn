import {
    BLEND_MODES,
    BLEND_MODE_LABELS,
    type BlendMode,
} from '@/lib/compositeProtocol';
import { RENDER_QUALITY_LABELS, useMapStore, type RenderQuality } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';

const RENDER_QUALITIES: RenderQuality[] = ['balanced', 'sharp'];

export function SettingsPanel() {
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const baseLayer = useMapStore((s) => s.baseLayer);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const setHillshadeIntensity = useMapStore((s) => s.setHillshadeIntensity);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const setHillshadeBlend = useMapStore((s) => s.setHillshadeBlend);
    const renderQuality = useMapStore((s) => s.renderQuality);
    const setRenderQuality = useMapStore((s) => s.setRenderQuality);
    const colorElevationBySlope = useRouteStore((s) => s.colorElevationBySlope);
    const setColorElevationBySlope = useRouteStore((s) => s.setColorElevationBySlope);

    return (
        <div className="space-y-4">
            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path d="M10 3.75a2 2 0 10-4 0 2 2 0 004 0zM17.25 4.5a.75.75 0 000-1.5h-5.5a.75.75 0 000 1.5h5.5zM5 3.75a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zM4.25 17a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM17.25 17a.75.75 0 000-1.5h-5.5a.75.75 0 000 1.5h5.5zM9 10a.75.75 0 01-.75.75h-5.5a.75.75 0 010-1.5h5.5A.75.75 0 019 10zM17.25 10.75a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM14 10a2 2 0 10-4 0 2 2 0 004 0zM10 16.25a2 2 0 10-4 0 2 2 0 004 0z" />
                    </svg>
                    Ombrage
                </h3>
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-200">
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
                        className="mt-1 w-full accent-emerald-500"
                    />
                </label>
                <div className="mt-3">
                    <div className="mb-1 text-xs text-slate-400">Mode de fusion</div>
                    <select
                        value={hillshadeBlend}
                        disabled={!hillshadeEnabled || baseLayer === 'lidar'}
                        onChange={(e) => setHillshadeBlend(e.target.value as BlendMode)}
                        className="w-full rounded-md bg-slate-800/60 px-2 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
                    >
                        {BLEND_MODES.map((id) => (
                            <option key={id} value={id} className="bg-slate-900">
                                {BLEND_MODE_LABELS[id]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="h-px bg-white/10" />

            <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Rendu
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                    {RENDER_QUALITIES.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setRenderQuality(id)}
                            className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${renderQuality === id
                                ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                                : 'bg-slate-800/40 text-slate-300 ring-white/5 hover:bg-slate-700/60'
                                }`}
                        >
                            {RENDER_QUALITY_LABELS[id]}
                        </button>
                    ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                    Net charge plus de tuiles pour les vues inclinées.
                </p>
            </div>

            <div className="h-px bg-white/10" />

            <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Itinéraire
                </h3>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                    <span>Pente colorée sur le profil</span>
                    <input
                        type="checkbox"
                        checked={colorElevationBySlope}
                        onChange={(event) => setColorElevationBySlope(event.target.checked)}
                        className="h-4 w-4 accent-emerald-500"
                    />
                </label>
            </div>
        </div>
    );
}
