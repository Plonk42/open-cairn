import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
import { SegmentedControl } from '@/components/ui/common/SegmentedControl';
import { forestLegendEntries, type ForestEdgeBlend, type ForestGrouping } from '@/lib/lidarBrowser/bdforet';
import type { ShaderPreset } from '@/lib/lidarBrowser/slope';
import { LAS_CLASS_LABELS, type VegColorMode } from '@/lib/lidarCloud';
import { useMapStore } from '@/stores/mapStore';

/** LAS classes available for filtering in the UI. */
const AVAILABLE_CLASSES = [2, 3, 4, 5, 6, 9, 17, 64, 66] as const;

/** Chip choices for the LiDAR class filter — same visual as the cliff-slice panel. */
const LIDAR_CLASS_CHOICES: ReadonlyArray<ClassChoice> = AVAILABLE_CLASSES.map((cls) => ({
    id: cls,
    label: LAS_CLASS_LABELS[cls] ?? `Classe ${cls}`,
}));

const SHADER_OPTIONS = [
    { value: 'base', label: 'Mono', title: 'Dégradé chaud sable / brun' },
    { value: 'cliff', label: 'Été', title: 'Rupture nette herbe/calcaire gris avec texture rocheuse' },
    { value: 'winter', label: 'Hiver', title: 'Neige sur pentes douces/expositions nord, falaise brun rocheux' },
] as const satisfies ReadonlyArray<{ value: ShaderPreset; label: string; title: string }>;

const VEG_COLOR_OPTIONS = [
    { value: 'natural', label: 'Naturel', title: 'Tons verts naturels, dégradé tronc → cime' },
    { value: 'height', label: 'Hauteur', title: 'Colormap viridis par hauteur (rendu IGN LiDAR HD), relief par EDL' },
    { value: 'species', label: 'Essence', title: 'Coloration par essence réelle (IGN BD Forêt® v2) : feuillus, conifères, chêne, hêtre, pin, douglas…' },
] as const satisfies ReadonlyArray<{ value: VegColorMode; label: string; title: string }>;

const FOREST_GROUPING_OPTIONS = [
    { value: 'group', label: 'Groupes', title: 'Colorer par grande formation : feuillus, conifères, mixte, peupleraie, milieu ouvert' },
    { value: 'species', label: 'Essences', title: 'Colorer par essence dominante : chêne, hêtre, châtaignier, pin sylvestre, douglas… (mosaïque procédurale dans les peuplements mixtes)' },
] as const satisfies ReadonlyArray<{ value: ForestGrouping; label: string; title: string }>;

const FOREST_EDGE_OPTIONS = [
    { value: 'sharp', label: 'Net', title: 'Limites de peuplement brutes (contour exact des polygones BD Forêt)' },
    { value: 'feather', label: 'Feutré', title: 'Lisière douce : la limite ondule de façon cohérente sur la largeur choisie (les couronnes voisines basculent ensemble)' },
    { value: 'scatter', label: 'Dispersé', title: 'Les essences s’entremêlent point par point de part et d’autre de la limite sur la largeur choisie' },
] as const satisfies ReadonlyArray<{ value: ForestEdgeBlend; label: string; title: string }>;

export function ClassFilterSection() {
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const setClasses = useMapStore((s) => s.setLidarCloudClasses);
    const toggleClass = (cls: number) => {
        if (classes.includes(cls)) setClasses(classes.filter((c) => c !== cls));
        else setClasses([...classes, cls].sort((a, b) => a - b));
    };
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Classes</span>
                <div className="flex gap-1 text-[10px]">
                    <button type="button" onClick={() => setClasses([...AVAILABLE_CLASSES])} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Tout</button>
                    <button type="button" onClick={() => setClasses([2, 9])} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Sol</button>
                    <button type="button" onClick={() => setClasses([3, 4, 5])} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Végétation</button>
                    <button type="button" onClick={() => setClasses([6, 17, 64, 66])} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Bâti</button>
                </div>
            </div>
            <ClassFilterChips choices={LIDAR_CLASS_CHOICES} selected={classes} onToggle={toggleClass} />
            {classes.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                    Aucune classe sélectionnée — tous les points seront chargés.
                </p>
            )}
        </div>
    );
}

/** Layer opacity slider + draped photo-texture opacity (all render modes). */
export function OpacityControls() {
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const setOpacity = useMapStore((s) => s.setLidarCloudOpacity);
    const photoOpacity = useMapStore((s) => s.lidarCloudPhotoOpacity);
    const setPhotoOpacity = useMapStore((s) => s.setLidarCloudPhotoOpacity);
    const photoOpacityNonGround = useMapStore((s) => s.lidarCloudPhotoOpacityNonGround);
    const setPhotoOpacityNonGround = useMapStore((s) => s.setLidarCloudPhotoOpacityNonGround);
    const basemapOpacity = useMapStore((s) => s.lidarCloudBasemapOpacity);
    const setBasemapOpacity = useMapStore((s) => s.setLidarCloudBasemapOpacity);
    const contourEnabled = useMapStore((s) => s.contourLinesEnabled);
    const setContourEnabled = useMapStore((s) => s.setContourLinesEnabled);
    const contourOpacity = useMapStore((s) => s.contourLinesOpacity);
    const setContourOpacity = useMapStore((s) => s.setContourLinesOpacity);
    // A single slider drives the contour lines: 0 = off, >0 = on at that opacity.
    const contourValue = contourEnabled ? contourOpacity : 0;
    const onContourChange = (v: number) => {
        if (v <= 0) {
            setContourEnabled(false);
        } else {
            if (!contourEnabled) setContourEnabled(true);
            setContourOpacity(v);
        }
    };

    return (
        <div className="space-y-3">
            {/* Fond de carte (estompage de l'orthophoto/plan IGN sous le nuage) */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Fond de carte</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(basemapOpacity * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité du fond de carte sous le nuage"
                    type="range" min={0} max={1} step={0.05}
                    value={basemapOpacity}
                    onChange={(e) => setBasemapOpacity(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Courbes de niveau — slider 0 = masquées */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Courbes de niveau</span>
                    <span className="font-mono text-xs text-slate-400">
                        {contourValue <= 0 ? 'off' : `${Math.round(contourValue * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Opacité des courbes de niveau"
                    type="range" min={0} max={1} step={0.05}
                    value={contourValue}
                    onChange={(e) => onContourChange(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Opacité */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Rendu LiDAR</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(opacity * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité du calque LiDAR"
                    type="range" min={0} max={1} step={0.05}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Texture photo — drapage orthophoto IGN, séparé sol / hors-sol */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Texture photo (sol)</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(photoOpacity * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité de la texture photo sur le sol (orthophoto IGN)"
                    type="range" min={0} max={1} step={0.05}
                    value={photoOpacity}
                    onChange={(e) => setPhotoOpacity(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Texture photo hors-sol (végétation, bâti, …) */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Texture photo (non-sol)</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(photoOpacityNonGround * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité de la texture photo hors-sol (orthophoto IGN)"
                    type="range" min={0} max={1} step={0.05}
                    value={photoOpacityNonGround}
                    onChange={(e) => setPhotoOpacityNonGround(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
        </div>
    );
}

/** Shader preset selector: base / cliff / winter. */
export function ShaderControls() {
    const shader = useMapStore((s) => s.lidarShader);
    const setShader = useMapStore((s) => s.setLidarShader);

    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700 dark:text-slate-300">Shader</span>
            <SegmentedControl value={shader} options={SHADER_OPTIONS} onChange={setShader} />
        </div>
    );
}

/** Point size slider + adaptive (decimation-compensating) sizing toggle. */
export function PointSizeControls() {
    const pointSize = useMapStore((s) => s.lidarCloudPointSize);
    const setPointSize = useMapStore((s) => s.setLidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const setSizeCompensation = useMapStore((s) => s.setLidarCloudSizeCompensation);

    return (
        <div className="space-y-3">
            {/* Taille des points */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Taille points</span>
                    <span className="font-mono text-xs text-slate-400">{pointSize.toFixed(1)}px</span>
                </div>
                <input
                    aria-label="Taille des points LiDAR"
                    type="range" min={0.3} max={8} step={0.1}
                    value={pointSize}
                    onChange={(e) => setPointSize(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Taille adaptative */}
            <label className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300" title="Grossit les points quand la décimation augmente">
                    Taille adaptative
                </span>
                <input
                    type="checkbox"
                    checked={sizeCompensation}
                    onChange={(e) => setSizeCompensation(e.target.checked)}
                    className="h-4 w-4 accent-green-600"
                />
            </label>
        </div>
    );
}

/**
 * IGN BD Forêt® species rendering controls, shown only when the foliage
 * coloration is set to "Essence". The legend doubles as the filter: unchecking
 * an essence/formation hides its points (GPU-side, no re-fetch). An "Avancé"
 * section exposes the treetop-detection sensitivity and the mix-mosaic cell
 * size used to paint plausible species inside mixed stands.
 */
export function ForestSpeciesControls() {
    const grouping = useMapStore((s) => s.lidarForestGrouping);
    const setGrouping = useMapStore((s) => s.setLidarForestGrouping);
    const hidden = useMapStore((s) => s.lidarForestHiddenLegend);
    const setHidden = useMapStore((s) => s.setLidarForestHiddenLegend);
    const setFilterOn = useMapStore((s) => s.setLidarForestSpeciesFilterOn);
    const mixCell = useMapStore((s) => s.lidarForestMixCellSize);
    const setMixCell = useMapStore((s) => s.setLidarForestMixCellSize);
    const sensitivity = useMapStore((s) => s.lidarForestTreetopSensitivity);
    const setSensitivity = useMapStore((s) => s.setLidarForestTreetopSensitivity);
    const edgeBlend = useMapStore((s) => s.lidarForestEdgeBlend);
    const setEdgeBlend = useMapStore((s) => s.setLidarForestEdgeBlend);
    const edgeBandM = useMapStore((s) => s.lidarForestEdgeBandM);
    const setEdgeBandM = useMapStore((s) => s.setLidarForestEdgeBandM);

    const legend = forestLegendEntries(grouping);
    const choices: ReadonlyArray<ClassChoice> = legend.map((e) => ({ id: e.id, label: e.label, color: e.color }));
    // "Legend IS the filter": a chip is selected when its id is NOT hidden.
    const selected = legend.filter((e) => !hidden.includes(e.id)).map((e) => e.id);

    const toggleLegend = (id: number) => {
        const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
        setHidden(next);
        setFilterOn(next.length > 0);
    };
    const showAll = () => { setHidden([]); setFilterOn(false); };

    // Changing the grouping switches legend-id space (6 groups ↔ 16 essences),
    // so a stale hidden list would hide the wrong entries — reset it.
    const onGroupingChange = (g: ForestGrouping) => {
        setGrouping(g);
        setHidden([]);
        setFilterOn(false);
    };

    return (
        <div className="space-y-2 rounded-lg bg-emerald-50/60 p-2 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:ring-emerald-900/40">
            <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300" title="Niveau de détail de la légende BD Forêt : grandes formations ou essences dominantes">
                    Détail
                </span>
                <SegmentedControl
                    value={grouping}
                    options={FOREST_GROUPING_OPTIONS}
                    onChange={onGroupingChange}
                />
            </div>

            {/* Légende-filtre : décocher une essence la masque (GPU, sans recalcul) */}
            <div>
                <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Légende · cliquer pour filtrer</span>
                    {hidden.length > 0 && (
                        <button
                            type="button"
                            onClick={showAll}
                            className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                        >
                            Tout afficher
                        </button>
                    )}
                </div>
                <ClassFilterChips choices={choices} selected={selected} onToggle={toggleLegend} />
            </div>

            <details className="group">
                <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                    Avancé
                </summary>
                <div className="mt-2 space-y-3">
                    {/* Mélange des limites d'essence : net / feutré / dispersé */}
                    <div>
                        <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                            <span title="Comment traiter les limites entre peuplements d'essences différentes : net (contour brut), feutré (lisière ondulée cohérente) ou dispersé (essences entremêlées point par point).">Limites d'essence</span>
                            <SegmentedControl
                                value={edgeBlend}
                                options={FOREST_EDGE_OPTIONS}
                                onChange={setEdgeBlend}
                            />
                        </div>
                        {edgeBlend !== 'sharp' && (
                            <label className="mt-2 block">
                                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                                    <span title="Largeur de la bande de transition de part et d'autre de la limite.">Largeur de transition</span>
                                    <span className="font-mono text-xs text-slate-400">{Math.round(edgeBandM)} m</span>
                                </div>
                                <input
                                    aria-label="Largeur de la bande de transition entre essences"
                                    type="range" min={1} max={30} step={1}
                                    value={edgeBandM}
                                    onChange={(e) => setEdgeBandM(Number(e.target.value))}
                                    className="mt-1 w-full accent-emerald-600"
                                />
                                <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                                    {edgeBlend === 'feather'
                                        ? 'La limite ondule de façon cohérente : des couronnes entières basculent d’une essence à l’autre.'
                                        : 'Les points changent d’essence individuellement, créant un dégradé poivre-et-sel autour de la limite.'}
                                </p>
                            </label>
                        )}
                    </div>

                    {/* Mosaïque d'essences : ne s'applique qu'en mode « Essences »,
                       et seulement dans les peuplements mélangés. En mode
                       « Groupes » la couleur est plate par peuplement, donc ces
                       deux réglages n'ont aucun effet → on les désactive. */}
                    <fieldset
                        disabled={grouping !== 'species'}
                        className="space-y-3 border-0 p-0 transition-opacity disabled:opacity-40"
                    >
                        {grouping !== 'species' && (
                            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                                Réglages de la mosaïque d'essences — disponibles en mode « Essences ».
                            </p>
                        )}
                        {/* Sensibilité de détection des cimes (CHM) — pilote la mosaïque mixte */}
                        <label className="block">
                            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                                <span title="Dans un peuplement mélangé, chaque cime d'arbre reçoit une essence tirée au sort parmi celles du peuplement. Ce curseur règle la sensibilité de la détection des cimes (sur le modèle de hauteur de canopée) : plus il est haut, plus on détecte d'arbres et plus les couronnes colorées sont fines.">Détection des cimes</span>
                                <span className="font-mono text-xs text-slate-400">{Math.round(sensitivity * 100)}%</span>
                            </div>
                            <input
                                aria-label="Sensibilité de détection des cimes"
                                type="range" min={0} max={1} step={0.05}
                                value={sensitivity}
                                onChange={(e) => setSensitivity(Number(e.target.value))}
                                className="mt-1 w-full accent-emerald-600"
                            />
                            <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                                Taille des couronnes colorées par essence dans les peuplements mélangés (plus haut = arbres plus nombreux et plus fins).
                            </p>
                        </label>

                        {/* Taille des taches d'essence dans les peuplements mixtes */}
                        <label className="block">
                            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                                <span title="Repli quand aucune cime n'est détectée : les essences sont alors réparties par une mosaïque procédurale régulière. Ce curseur fixe la taille des taches de cette mosaïque.">Taille des taches</span>
                                <span className="font-mono text-xs text-slate-400">{Math.round(mixCell)} m</span>
                            </div>
                            <input
                                aria-label="Taille des taches d'essence en peuplement mixte"
                                type="range" min={2} max={20} step={1}
                                value={mixCell}
                                onChange={(e) => setMixCell(Number(e.target.value))}
                                className="mt-1 w-full accent-emerald-600"
                            />
                            <p className="mt-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                                Taille des taches d'essence du repli procédural, utilisé seulement là où aucune cime n'a été détectée.
                            </p>
                        </label>
                    </fieldset>
                </div>
            </details>
        </div>
    );
}

/**
 * Enhanced vegetation rendering controls: master toggle + height-ramp intensity,
 * round leaf splats, per-leaf jitter and a canopy-filling size boost. When the
 * master toggle is off, vegetation falls back to flat per-class colours and
 * square splats and the detail sliders are disabled.
 */
export function VegetationControls() {
    const enhance = useMapStore((s) => s.lidarVegEnhance);
    const setEnhance = useMapStore((s) => s.setLidarVegEnhance);
    const colorMode = useMapStore((s) => s.lidarVegColorMode);
    const setColorMode = useMapStore((s) => s.setLidarVegColorMode);
    const heightScale = useMapStore((s) => s.lidarVegHeightScale);
    const setHeightScale = useMapStore((s) => s.setLidarVegHeightScale);
    const heightAuto = useMapStore((s) => s.lidarVegHeightAuto);
    const setHeightAuto = useMapStore((s) => s.setLidarVegHeightAuto);
    const intensity = useMapStore((s) => s.lidarVegIntensity);
    const setIntensity = useMapStore((s) => s.setLidarVegIntensity);
    const normalShade = useMapStore((s) => s.lidarVegNormalShade);
    const setNormalShade = useMapStore((s) => s.setLidarVegNormalShade);
    const sizeBoost = useMapStore((s) => s.lidarVegSizeBoost);
    const setSizeBoost = useMapStore((s) => s.setLidarVegSizeBoost);

    return (
        <div className="space-y-3">
            {/* Master toggle */}
            <label className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300" title="Coloration par hauteur, feuilles rondes, variation et grossissement du feuillage">
                    Végétation enrichie
                </span>
                <input
                    type="checkbox"
                    checked={enhance}
                    onChange={(e) => setEnhance(e.target.checked)}
                    className="h-4 w-4 accent-green-600"
                />
            </label>

            <fieldset disabled={!enhance} className="space-y-3 disabled:opacity-40">
                {/* Mode de coloration : naturel (vert tronc→cime) ou hauteur (viridis IGN) */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300" title="Coloration du feuillage : tons verts naturels ou colormap viridis par hauteur (rendu IGN LiDAR HD)">
                        Coloration
                    </span>
                    <SegmentedControl
                        value={colorMode}
                        options={VEG_COLOR_OPTIONS}
                        onChange={setColorMode}
                    />
                </div>

                {/* Légende + filtre + réglages BD Forêt, uniquement en mode « Essence » */}
                {colorMode === 'species' && <ForestSpeciesControls />}

                {/* Intensité du dégradé de hauteur. En mode « essence » la couleur
                    d'essence reste toujours visible : le slider ne pilote que le
                    dégradé tronc→cime ajouté par-dessus. En naturel/hauteur il
                    mélange le dégradé avec la couleur de classe. */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span title="Amplitude du dégradé de hauteur (tronc sombre → cime claire). En mode « essence », n'affecte pas la coloration par essence, seulement le dégradé.">Dégradé feuillage</span>
                        <span className="font-mono text-xs text-slate-400">{Math.round(intensity * 100)}%</span>
                    </div>
                    <input
                        aria-label="Intensité du dégradé par hauteur"
                        type="range" min={0} max={1} step={0.05}
                        value={intensity}
                        onChange={(e) => setIntensity(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

                {/* Hauteur de référence du dégradé (les deux modes) : étire la palette
                    sur des feuillages plus hauts → moins d'aplat uniforme. En mode
                    « auto », elle suit l'arbre le plus haut du nuage chargé. */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Hauteur max</span>
                        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" title="Caler automatiquement l'échelle de hauteur sur l'arbre le plus haut du nuage">
                            <input
                                type="checkbox"
                                checked={heightAuto}
                                onChange={(e) => setHeightAuto(e.target.checked)}
                                className="h-3.5 w-3.5 accent-green-600"
                            />
                            <span>Auto</span>
                            <span className="font-mono text-slate-400">{Math.round(heightScale)} m</span>
                        </label>
                    </div>
                    <input
                        aria-label="Hauteur mappée au sommet du dégradé"
                        type="range" min={5} max={40} step={1}
                        value={heightScale}
                        onChange={(e) => {
                            // Régler la hauteur la passe d'office en manuel : décoche
                            // « Auto » pour éviter un clic supplémentaire.
                            if (heightAuto) setHeightAuto(false);
                            setHeightScale(Number(e.target.value));
                        }}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

                {/* Ombrage par normale : intensité du relief calculé sur la normale
                    des feuilles (en plus de l'EDL). 0 % = aplat (EDL seul). */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Ombrage par normale</span>
                        <span className="font-mono text-xs text-slate-400">{Math.round(normalShade * 100)}%</span>
                    </div>
                    <input
                        aria-label="Intensité de l'ombrage par normale"
                        type="range" min={0} max={1} step={0.05}
                        value={normalShade}
                        onChange={(e) => setNormalShade(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

                {/* Grossissement du feuillage */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Densité feuillage</span>
                        <span className="font-mono text-xs text-slate-400">×{sizeBoost.toFixed(1)}</span>
                    </div>
                    <input
                        aria-label="Grossissement des points de végétation"
                        type="range" min={1} max={3} step={0.1}
                        value={sizeBoost}
                        onChange={(e) => setSizeBoost(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
            </fieldset>
        </div>
    );
}
