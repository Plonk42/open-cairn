import { SunDateControl } from '@/components/ui/lidar/SunDateControl';
import { BASE_LAYER_IDS, BASE_LAYERS, IGN_KEY_REQUIRED_HINT, requiresIgnKey } from '@/lib/baseLayers';
import { HILLSHADE_SOURCE_LABELS, useMapStore, type HillshadeSource } from '@/stores/mapStore';

const SHADOWS: HillshadeSource[] = ['mns', 'mnt', 'mnh'];

const SHADOW_TITLES: Record<HillshadeSource, string> = {
    mns: 'Modèle Numérique de Surface (sursol : bâtiments, végétation)',
    mnt: 'Modèle Numérique de Terrain (sol nu)',
    mnh: 'Modèle Numérique de Hauteur (canopée)',
};

const TOPONYMS_HINT = 'Superpose les noms de lieux issus des tuiles vectorielles IGN. Proposé sur les fonds qui ne portent aucun texte : décochez pour retrouver l’image nue.';

/** Base-map picker (SCAN 25 / Plan / Ortho / OSM / LiDAR). */
export function BaseLayerSection() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    const ignApiKey = useMapStore((s) => s.ignApiKey);
    const toponymsEnabled = useMapStore((s) => s.toponymsEnabled);
    const setToponymsEnabled = useMapStore((s) => s.setToponymsEnabled);

    return (
        <div>
            <div className="grid grid-cols-2 gap-1.5">
                {BASE_LAYER_IDS.map((id) => {
                    const { label, description } = BASE_LAYERS[id];
                    const disabled = requiresIgnKey(id) && !ignApiKey;
                    return (
                        <button
                            key={id}
                            type="button"
                            disabled={disabled}
                            onClick={() => setBaseLayer(id)}
                            title={disabled ? `${description} · ${IGN_KEY_REQUIRED_HINT}` : description}
                            className={`rounded-md px-2.5 py-1.5 text-xs ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${baseLayer === id
                                ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700'
                                : 'bg-gray-50 text-slate-600 ring-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
            {BASE_LAYERS[baseLayer].textless && (
                <label className="mt-2 flex items-center justify-between gap-3" title={TOPONYMS_HINT}>
                    <span className="text-sm text-slate-700 dark:text-slate-300">Toponymes</span>
                    <input
                        aria-label="Afficher les toponymes"
                        type="checkbox"
                        checked={toponymsEnabled}
                        onChange={(e) => setToponymsEnabled(e.target.checked)}
                        className="h-4 w-4 accent-green-600"
                    />
                </label>
            )}
        </div>
    );
}

/** LiDAR HD hillshade toggle + source (MNS/MNT/MNH) + intensity. */
export function HillshadeSection() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const setHillshadeEnabled = useMapStore((s) => s.setHillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const setHillshadeSource = useMapStore((s) => s.setHillshadeSource);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const setHillshadeIntensity = useMapStore((s) => s.setHillshadeIntensity);

    return (
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
            <label className="mt-2 block">
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
                    disabled={!hillshadeEnabled && baseLayer !== 'lidar'}
                    className="mt-1 w-full accent-green-600 disabled:opacity-40"
                />
            </label>
        </div>
    );
}

/** Contour lines opacity (0 % disables the layer, à la Studio). */
export function ContourSection() {
    const contourLinesOpacity = useMapStore((s) => s.contourLinesOpacity);
    const setContourLinesOpacity = useMapStore((s) => s.setContourLinesOpacity);
    const setContourLinesEnabled = useMapStore((s) => s.setContourLinesEnabled);

    const applyOpacity = (v: number) => {
        setContourLinesOpacity(v);
        // Opacity is the single control: any value above 0 turns the layer on,
        // 0 turns it off — no separate enable checkbox (mirrors the Studio).
        setContourLinesEnabled(v > 0);
    };

    return (
        <div>
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Opacité courbes de niveau</span>
                    <span className="font-mono text-xs text-slate-400">
                        {Math.round(contourLinesOpacity * 100)}%
                    </span>
                </div>
                <input
                    aria-label="Opacité courbes de niveau"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={contourLinesOpacity}
                    onChange={(e) => applyOpacity(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
        </div>
    );
}

/** 3D terrain toggle + exaggeration. */
export function Terrain3DSection() {
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const setTerrainEnabled = useMapStore((s) => s.setTerrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
    const setTerrainExaggeration = useMapStore((s) => s.setTerrainExaggeration);

    return (
        <div>
            <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700 dark:text-slate-300">Terrain 3D</span>
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
    );
}

/**
 * Sun and moon sky tracks. Shown in both views, so the hint is written once
 * here and reused by the Studio's own compact checkboxes.
 */
const SKY_PATH_HINT = 'Dessine la course de l’astre dans le ciel pour la date choisie, le disque à sa taille réelle et les heures pleines graduées. Les portions cachées par le relief sont en pointillé. Demande le terrain 3D.';

const HIDDEN_PATH_HINT = 'Prolonge la trajectoire en pointillé derrière le relief, là où l’astre est masqué. Décochez pour ne garder que la portion réellement visible depuis ce point.';

const ATMOSPHERIC_SKY_HINT = 'Peint le ciel d’après la position du soleil à l’heure choisie, au lieu du bleu nuit neutre. Visible surtout quand la carte est inclinée vers le haut.';

export const PEAK_LABELS_HINT = 'Nomme les sommets réellement visibles d’ici, ceux qu’aucune crête ne masque (IGN BD TOPO®, couverture française).';

/** One labelled checkbox row, the shape every switch in this section takes. */
function SkyToggle({ label, title, checked, disabled, onChange }: Readonly<{
    label: string;
    title: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (v: boolean) => void;
}>) {
    return (
        <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700 dark:text-slate-300" title={title}>{label}</span>
            <input
                aria-label={label}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="h-4 w-4 accent-green-600 disabled:opacity-40"
            />
        </label>
    );
}

/**
 * Sky-track toggles + the date/time picker they read. The tracks are drawn
 * against the 3D terrain (hidden-line pass, skyline times), so they are
 * disabled when the relief is off — the atmospheric sky is not, it needs no
 * terrain. The Studio forces the terrain on, and has its own sky switch
 * (photoreal render), so it gets neither the terrain guard nor that row.
 */
export function SkyPathSection({ studio = false }: Readonly<{ studio?: boolean }>) {
    const sunPath = useMapStore((s) => s.skySunPath);
    const setSunPath = useMapStore((s) => s.setSkySunPath);
    const moonPath = useMapStore((s) => s.skyMoonPath);
    const setMoonPath = useMapStore((s) => s.setSkyMoonPath);
    const hiddenPath = useMapStore((s) => s.skyHiddenPath);
    const setHiddenPath = useMapStore((s) => s.setSkyHiddenPath);
    const atmosphericSky = useMapStore((s) => s.atmosphericSky);
    const setAtmosphericSky = useMapStore((s) => s.setAtmosphericSky);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled) || studio;

    const noTerrain = 'Activez le terrain 3D pour afficher les trajectoires.';
    const tracksOn = terrainEnabled && (sunPath || moonPath);
    const skyOn = atmosphericSky && !studio;

    return (
        <div className="space-y-2">
            <SkyToggle
                label="Trajectoire du soleil"
                title={terrainEnabled ? SKY_PATH_HINT : noTerrain}
                checked={sunPath && terrainEnabled}
                disabled={!terrainEnabled}
                onChange={setSunPath}
            />
            <SkyToggle
                label="Trajectoire de la lune"
                title={terrainEnabled ? `${SKY_PATH_HINT} Le disque porte la phase, corne brillante tournée vers le soleil.` : noTerrain}
                checked={moonPath && terrainEnabled}
                disabled={!terrainEnabled}
                onChange={setMoonPath}
            />
            {!studio && (
                <SkyToggle
                    label="Ciel atmosphérique"
                    title={ATMOSPHERIC_SKY_HINT}
                    checked={atmosphericSky}
                    onChange={setAtmosphericSky}
                />
            )}
            {/* Greyed rather than unmounted: the panel is anchored by its
                bottom edge, so hiding a row makes it jump under the cursor. */}
            <SkyToggle
                label="Portions cachées"
                title={HIDDEN_PATH_HINT}
                checked={hiddenPath}
                disabled={!tracksOn}
                onChange={setHiddenPath}
            />
            <SunDateControl disabled={!tracksOn && !skyOn} />
        </div>
    );
}

/**
 * Full "Couches" panel — composes every layer section with dividers. Used by
 * the mobile bottom sheet; the desktop bottom bar splits these sections across
 * individual pills instead.
 */
export function LayerSwitcher() {
    return (
        <div className="space-y-4">
            <BaseLayerSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <HillshadeSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <ContourSection />
            <div className="h-px bg-gray-200 dark:bg-slate-700" />
            <Terrain3DSection />
        </div>
    );
}
