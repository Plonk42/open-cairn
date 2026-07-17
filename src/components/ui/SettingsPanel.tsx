import {
    BLEND_MODES,
    BLEND_MODE_LABELS,
    clearTileCache,
    type BlendMode,
} from '@/lib/compositeProtocol';
import { RENDER_QUALITY_LABELS, TERRAIN_DEM_SOURCE_LABELS, useMapStore, type RenderQuality, type TerrainDemSource, type UiTheme } from '@/stores/mapStore';

const RENDER_QUALITIES: RenderQuality[] = ['balanced', 'sharp'];
const TERRAIN_DEM_SOURCES: TerrainDemSource[] = ['auto', 'ign', 'mapterhorn'];

/** Human-readable description of the active terrain DEM source. */
function terrainDemHint(source: TerrainDemSource, hasIgnKey: boolean): string {
    if (source === 'ign') return 'IGN RGE ALTI — France uniquement.';
    if (source === 'mapterhorn') return 'Mapterhorn — couverture mondiale, identique aux courbes de niveau.';
    return hasIgnKey
        ? 'Auto : IGN RGE ALTI (clé fournie).'
        : 'Auto : Mapterhorn (aucune clé IGN fournie).';
}
const UI_THEMES: Array<{ id: UiTheme; label: string }> = [
    { id: 'light', label: 'Clair' },
    { id: 'dark', label: 'Sombre' },
];

/** UI theme picker (Clair / Sombre). */
export function AppearanceSection() {
    const uiTheme = useMapStore((s) => s.uiTheme);
    const setUiTheme = useMapStore((s) => s.setUiTheme);

    return (
        <div>
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
    );
}

/** Hillshade blend-mode selector. */
export function ShadingBlendSection() {
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const baseLayer = useMapStore((s) => s.baseLayer);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const setHillshadeBlend = useMapStore((s) => s.setHillshadeBlend);

    return (
        <div>
            <div>
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
    );
}

/** Render quality + composite tile cache size. */
export function RenderSection() {
    const renderQuality = useMapStore((s) => s.renderQuality);
    const setRenderQuality = useMapStore((s) => s.setRenderQuality);
    const tileCacheSize = useMapStore((s) => s.tileCacheSize);
    const setTileCacheSize = useMapStore((s) => s.setTileCacheSize);

    return (
        <div>
            <div className="mb-2 text-xs font-medium text-slate-500">Qualité de rendu</div>
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
                <div className="flex items-center gap-1.5">
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
                    <button
                        type="button"
                        onClick={clearTileCache}
                        className="rounded-md bg-gray-50 px-2 py-1 text-xs text-slate-500 ring-1 ring-gray-200 transition hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-600 dark:hover:bg-rose-900/30"
                        title="Vider le cache et recharger les tuiles"
                    >
                        Vider
                    </button>
                </div>
            </label>
        </div>
    );
}

/** 3D relief DEM source (Auto / IGN / Mapterhorn). */
export function TerrainDemSection() {
    const ignDemApiKey = useMapStore((s) => s.ignDemApiKey);
    const terrainDemSource = useMapStore((s) => s.terrainDemSource);
    const setTerrainDemSource = useMapStore((s) => s.setTerrainDemSource);

    return (
        <div>
            <div className="grid grid-cols-3 gap-1.5">
                {TERRAIN_DEM_SOURCES.map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTerrainDemSource(id)}
                        className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${terrainDemSource === id
                            ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                            : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                            }`}
                    >
                        {TERRAIN_DEM_SOURCE_LABELS[id]}
                    </button>
                ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                {terrainDemHint(terrainDemSource, !!ignDemApiKey)}
            </p>
        </div>
    );
}

/** IGN API keys (SCAN 25 WMTS + Terrain 3D WMS-r). */
export function ApiKeysSection() {
    const ignScanApiKey = useMapStore((s) => s.ignScanApiKey);
    const setIgnScanApiKey = useMapStore((s) => s.setIgnScanApiKey);
    const ignDemApiKey = useMapStore((s) => s.ignDemApiKey);
    const setIgnDemApiKey = useMapStore((s) => s.setIgnDemApiKey);

    return (
        <div>
            <div className="mb-2 text-xs font-medium text-slate-500">Clés API IGN</div>
            <label className="mb-2 block text-sm text-slate-700 dark:text-slate-300">
                <span className="mb-1 block text-xs text-slate-500">SCAN 25 (WMTS privé)</span>
                <input
                    type="text"
                    value={ignScanApiKey}
                    onChange={(e) => setIgnScanApiKey(e.target.value.trim())}
                    placeholder="Votre clé API IGN"
                    className="w-full rounded-md bg-gray-50 px-2 py-1.5 text-xs text-slate-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
                />
            </label>
            <label className="mb-2 block text-sm text-slate-700 dark:text-slate-300">
                <span className="mb-1 block text-xs text-slate-500">Terrain 3D (WMS-r privé)</span>
                <input
                    type="text"
                    value={ignDemApiKey}
                    onChange={(e) => setIgnDemApiKey(e.target.value.trim())}
                    placeholder="Clé pour terrain lisse (optionnel)"
                    className="w-full rounded-md bg-gray-50 px-2 py-1.5 text-xs text-slate-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"
                />
            </label>
        </div>
    );
}

/**
 * Full "Réglages" panel — composes every settings section with dividers. Used
 * by the mobile bottom sheet; the desktop bottom bar splits these sections
 * across individual pills instead.
 */
export function SettingsPanel() {
    return (
        <div className="space-y-4">
            <AppearanceSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <ShadingBlendSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <RenderSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <TerrainDemSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <ApiKeysSection />
        </div>
    );
}
