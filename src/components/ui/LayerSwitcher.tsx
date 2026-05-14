import type { BaseLayerId } from '@/lib/mapStyle';
import { BASE_LAYER_LABELS } from '@/lib/mapStyle';
import { HILLSHADE_SOURCE_LABELS, useMapStore, type HillshadeSource } from '@/stores/mapStore';
import { useState } from 'react';

const BASES: BaseLayerId[] = ['scan25', 'plan', 'ortho'];
const SHADOWS: HillshadeSource[] = ['mns', 'mnt', 'mnh'];

export function LayerSwitcher() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const setHillshadeEnabled = useMapStore((s) => s.setHillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const setHillshadeSource = useMapStore((s) => s.setHillshadeSource);
    const [open, setOpen] = useState(false);

    return (
        <div className="pointer-events-auto absolute right-3 top-3 z-10">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="rounded-lg bg-slate-900/70 px-3 py-2 text-sm font-medium backdrop-blur-md ring-1 ring-white/10 hover:bg-slate-800/80"
                aria-label="Couches"
            >
                Couches
            </button>
            {open && (
                <div className="mt-2 w-64 rounded-lg bg-slate-900/85 p-3 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
                        Fond de carte
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {BASES.map((id) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setBaseLayer(id)}
                                className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${baseLayer === id
                                        ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                                        : 'bg-slate-800/40 text-slate-300 ring-white/5 hover:bg-slate-700/60'
                                    }`}
                            >
                                {BASE_LAYER_LABELS[id]}
                            </button>
                        ))}
                    </div>

                    <div className="my-3 h-px bg-white/10" />

                    <label className="flex items-center justify-between gap-3">
                        <span className="text-slate-200">Ombrage LiDAR HD ×</span>
                        <input
                            type="checkbox"
                            checked={hillshadeEnabled}
                            onChange={(e) => setHillshadeEnabled(e.target.checked)}
                            className="h-4 w-4 accent-emerald-500"
                        />
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        {SHADOWS.map((id) => (
                            <button
                                key={id}
                                type="button"
                                disabled={!hillshadeEnabled}
                                onClick={() => setHillshadeSource(id)}
                                className={`rounded-md px-2 py-1.5 text-xs ring-1 transition disabled:opacity-40 ${
                                    hillshadeSource === id
                                        ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                                        : 'bg-slate-800/40 text-slate-300 ring-white/5 hover:bg-slate-700/60'
                                }`}
                                title={
                                    id === 'mns'
                                        ? 'Modèle Numérique de Surface (sursol : bâtiments, végétation)'
                                        : id === 'mnt'
                                        ? 'Modèle Numérique de Terrain (sol nu)'
                                        : 'Modèle Numérique de Hauteur (canopée)'
                                }
                            >
                                {HILLSHADE_SOURCE_LABELS[id]}
                            </button>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-slate-400">
                        Composé en <em>multiply</em> avec le fond — pas une simple opacité.
                    </p>
                </div>
            )}
        </div>
    );
}
