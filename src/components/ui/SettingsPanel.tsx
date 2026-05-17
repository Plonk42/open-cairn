import { RENDER_QUALITY_LABELS, useMapStore, type RenderQuality } from '@/stores/mapStore';

const RENDER_QUALITIES: RenderQuality[] = ['balanced', 'sharp'];

type SettingsPanelProps = Readonly<{
    open: boolean;
    onToggle: () => void;
}>;

export function SettingsPanel({ open, onToggle }: SettingsPanelProps) {
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const setHillshadeIntensity = useMapStore((s) => s.setHillshadeIntensity);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const setTerrainEnabled = useMapStore((s) => s.setTerrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
    const setTerrainExaggeration = useMapStore((s) => s.setTerrainExaggeration);
    const renderQuality = useMapStore((s) => s.renderQuality);
    const setRenderQuality = useMapStore((s) => s.setRenderQuality);

    return (
        <div className="w-full">
            <button
                type="button"
                onClick={onToggle}
                className="ml-auto block rounded-lg bg-slate-900/70 px-3 py-2 text-sm font-medium backdrop-blur-md ring-1 ring-white/10 hover:bg-slate-800/80"
                aria-label="Réglages"
            >
                Réglages
            </button>
            {open && (
                <div className="mt-2 w-full rounded-lg bg-slate-900/85 p-3 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
                        Composition
                    </div>
                    <label className="block">
                        <div className="flex items-center justify-between text-slate-200">
                            <span>Intensité ombrage</span>
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

                    <div className="my-3 h-px bg-white/10" />

                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
                        Rendu
                    </div>
                    <div className="grid grid-cols-2 gap-2">
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
                    <p className="mt-2 text-[11px] leading-snug text-slate-400">
                        Net charge plus de tuiles pour les vues inclinées.
                    </p>

                    <div className="my-3 h-px bg-white/10" />

                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
                        Terrain 3D
                    </div>
                    <label className="flex items-center justify-between">
                        <span className="text-slate-200">Activer</span>
                        <input
                            aria-label="Activer terrain 3D"
                            type="checkbox"
                            checked={terrainEnabled}
                            onChange={(e) => setTerrainEnabled(e.target.checked)}
                            className="h-4 w-4 accent-emerald-500"
                        />
                    </label>
                    <label className="mt-2 block">
                        <div className="flex items-center justify-between text-slate-200">
                            <span>Exagération</span>
                            <span className="font-mono text-xs text-slate-400">
                                ×{terrainExaggeration.toFixed(1)}
                            </span>
                        </div>
                        <input
                            aria-label="Exagération terrain 3D"
                            type="range"
                            min={0.5}
                            max={3}
                            step={0.1}
                            value={terrainExaggeration}
                            onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
                            disabled={!terrainEnabled}
                            className="mt-1 w-full accent-emerald-500 disabled:opacity-40"
                        />
                    </label>
                </div>
            )}
        </div>
    );
}
