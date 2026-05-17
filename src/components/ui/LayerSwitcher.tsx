import {
    BLEND_MODES,
    BLEND_MODE_LABELS,
    type BlendMode,
} from '@/lib/compositeProtocol';
import type { BaseLayerId } from '@/lib/mapStyle';
import { BASE_LAYER_LABELS } from '@/lib/mapStyle';
import { HILLSHADE_SOURCE_LABELS, useMapStore, type HillshadeSource } from '@/stores/mapStore';

const BASES: BaseLayerId[] = ['scan25', 'plan', 'ortho', 'osm', 'lidar'];
const SHADOWS: HillshadeSource[] = ['mns', 'mnt', 'mnh'];
const BLEND_OPTIONS: BlendMode[] = [...BLEND_MODES];

type LayerSwitcherProps = Readonly<{
    open: boolean;
    onToggle: () => void;
}>;

const SHADOW_TITLES: Record<HillshadeSource, string> = {
    mns: 'Modèle Numérique de Surface (sursol : bâtiments, végétation)',
    mnt: 'Modèle Numérique de Terrain (sol nu)',
    mnh: 'Modèle Numérique de Hauteur (canopée)',
};

export function LayerSwitcher({ open, onToggle }: LayerSwitcherProps) {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const setHillshadeEnabled = useMapStore((s) => s.setHillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const setHillshadeSource = useMapStore((s) => s.setHillshadeSource);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const setHillshadeBlend = useMapStore((s) => s.setHillshadeBlend);

    return (
        <div className="w-full">
            <button
                type="button"
                onClick={onToggle}
                className="ml-auto block rounded-lg bg-slate-900/70 px-3 py-2 text-sm font-medium backdrop-blur-md ring-1 ring-white/10 hover:bg-slate-800/80"
                aria-label="Couches"
            >
                Couches
            </button>
            {open && (
                <div className="mt-2 w-full rounded-lg bg-slate-900/85 p-3 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
                        Fond de carte
                    </div>
                    <div className="grid grid-cols-2 gap-2">
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

                    <label className={`flex items-center justify-between gap-3 ${baseLayer === 'lidar' ? 'opacity-45' : ''}`}>
                        <span className="text-slate-200">Ombrage LiDAR HD ×</span>
                        <input
                            type="checkbox"
                            checked={baseLayer === 'lidar' ? false : hillshadeEnabled}
                            disabled={baseLayer === 'lidar'}
                            onChange={(e) => setHillshadeEnabled(e.target.checked)}
                            className="h-4 w-4 accent-emerald-500 disabled:cursor-not-allowed"
                        />
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        {SHADOWS.map((id) => (
                            <button
                                key={id}
                                type="button"
                                disabled={!hillshadeEnabled && baseLayer !== 'lidar'}
                                onClick={() => setHillshadeSource(id)}
                                className={`rounded-md px-2 py-1.5 text-xs ring-1 transition disabled:opacity-40 ${hillshadeSource === id
                                    ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                                    : 'bg-slate-800/40 text-slate-300 ring-white/5 hover:bg-slate-700/60'
                                    }`}
                                title={SHADOW_TITLES[id]}
                            >
                                {HILLSHADE_SOURCE_LABELS[id]}
                            </button>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-slate-400">
                        {baseLayer === 'lidar'
                            ? 'Fond LiDAR seul, sans fond cartographique dessous.'
                            : 'Pré-composé tuile par tuile avec le fond — pas une simple opacité.'}
                    </p>
                    <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-400">
                        Mode de fusion
                    </div>
                    <select
                        value={hillshadeBlend}
                        disabled={!hillshadeEnabled || baseLayer === 'lidar'}
                        onChange={(e) => setHillshadeBlend(e.target.value as BlendMode)}
                        className="mt-1 w-full rounded-md bg-slate-800/60 px-2 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
                    >
                        {BLEND_OPTIONS.map((id) => (
                            <option key={id} value={id} className="bg-slate-900">
                                {BLEND_MODE_LABELS[id]}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">
                        {baseLayer === 'lidar' ? (
                            'Le mode de fusion est ignoré sur le fond LiDAR seul.'
                        ) : (
                            <>
                                <em>Relief LiDAR neutre 180</em> garde les champs plats neutres et conserve ombres/lumières.
                            </>
                        )}
                    </p>
                </div>
            )}
        </div>
    );
}
