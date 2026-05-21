import type { BaseLayerId } from '@/lib/mapStyle';
import { BASE_LAYER_LABELS } from '@/lib/mapStyle';
import { HILLSHADE_SOURCE_LABELS, useMapStore, type HillshadeSource } from '@/stores/mapStore';

const BASES: BaseLayerId[] = ['scan25', 'plan', 'ortho', 'osm', 'lidar'];
const SHADOWS: HillshadeSource[] = ['mns', 'mnt', 'mnh'];

const SHADOW_TITLES: Record<HillshadeSource, string> = {
    mns: 'Modèle Numérique de Surface (sursol : bâtiments, végétation)',
    mnt: 'Modèle Numérique de Terrain (sol nu)',
    mnh: 'Modèle Numérique de Hauteur (canopée)',
};

export function LayerSwitcher() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const setHillshadeEnabled = useMapStore((s) => s.setHillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const setHillshadeSource = useMapStore((s) => s.setHillshadeSource);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const setTerrainEnabled = useMapStore((s) => s.setTerrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
    const setTerrainExaggeration = useMapStore((s) => s.setTerrainExaggeration);
    const contourLinesEnabled = useMapStore((s) => s.contourLinesEnabled);
    const setContourLinesEnabled = useMapStore((s) => s.setContourLinesEnabled);
    const contourLinesOpacity = useMapStore((s) => s.contourLinesOpacity);
    const setContourLinesOpacity = useMapStore((s) => s.setContourLinesOpacity);

    return (
        <div className="space-y-4">
            <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    </svg>
                    Fond de carte
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                    {BASES.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setBaseLayer(id)}
                            className={`rounded-md px-2.5 py-1.5 text-xs ring-1 transition ${baseLayer === id
                                ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                                : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {BASE_LAYER_LABELS[id]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <label className={`flex items-center justify-between gap-3 ${baseLayer === 'lidar' ? 'opacity-45' : ''}`}>
                    <span className="text-sm text-slate-700 dark:text-slate-300">Ombrage LiDAR HD</span>
                    <input
                        type="checkbox"
                        checked={baseLayer === 'lidar' ? false : hillshadeEnabled}
                        disabled={baseLayer === 'lidar'}
                        onChange={(e) => setHillshadeEnabled(e.target.checked)}
                        className="h-4 w-4 accent-green-600 disabled:cursor-not-allowed"
                    />
                </label>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {SHADOWS.map((id) => (
                        <button
                            key={id}
                            type="button"
                            disabled={!hillshadeEnabled && baseLayer !== 'lidar'}
                            onClick={() => setHillshadeSource(id)}
                            className={`rounded-md px-2 py-1.5 text-xs ring-1 transition disabled:opacity-40 ${hillshadeSource === id
                                ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                                : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                                }`}
                            title={SHADOW_TITLES[id]}
                        >
                            {HILLSHADE_SOURCE_LABELS[id]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <label className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Courbes de niveau</span>
                    <input
                        type="checkbox"
                        checked={contourLinesEnabled}
                        onChange={(e) => setContourLinesEnabled(e.target.checked)}
                        className="h-4 w-4 accent-green-600"
                    />
                </label>
                <label className="mt-2 block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Opacité</span>
                        <span className="font-mono text-xs text-slate-400">
                            {Math.round(contourLinesOpacity * 100)}%
                        </span>
                    </div>
                    <input
                        aria-label="Opacité courbes de niveau"
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={contourLinesOpacity}
                        onChange={(e) => setContourLinesOpacity(Number(e.target.value))}
                        disabled={!contourLinesEnabled}
                        className="mt-1 w-full accent-green-600 disabled:opacity-40"
                    />
                </label>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700" />

            <div>
                <label className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Terrain 3D
                    </h3>
                    <input
                        aria-label="Activer terrain 3D"
                        type="checkbox"
                        checked={terrainEnabled}
                        onChange={(e) => setTerrainEnabled(e.target.checked)}
                        className="h-4 w-4 accent-green-600"
                    />
                </label>
                <label className="mt-2 block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
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
                        className="mt-1 w-full accent-green-600 disabled:opacity-40"
                    />
                </label>
            </div>
        </div>
    );
}
