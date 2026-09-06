import { LOD_LEVEL_COUNT } from '@/components/map/LidarWebGLLayer';
import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
import { SegmentedControl } from '@/components/ui/common/SegmentedControl';
import { isHeightDebugEnabled, isLodDebugEnabled, isMeshWireframeDebugEnabled } from '@/lib/debugFlags';
import { forestLegendEntries, type ForestEdgeBlend, type ForestGrouping } from '@/lib/lidarBrowser/bdforet';
import type { VegCliffDistMode } from '@/lib/lidarBrowser/groundHeight';
import type { RockType, ShaderPreset } from '@/lib/lidarBrowser/slope';
import { LAS_CLASS_LABELS, type VegColorMode } from '@/lib/lidarCloud';
import type { DrapeSource } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import type { LidarVegDiagMode } from '@/stores/slices/lidarSlice';
import { useEffect, useState } from 'react';

/**
 * Shared visual treatment for controls gated behind `?debug=`: a dashed amber
 * accent + a small "debug" pill, so dev-only knobs read visually distinct
 * from the normal, always-on settings around them.
 */
const DEBUG_WRAP_CLASS = 'space-y-2 rounded-md border border-dashed border-amber-400/60 bg-amber-50/60 p-2 dark:border-amber-500/40 dark:bg-amber-950/20';

/** LAS classes available for filtering in the UI. */
const AVAILABLE_CLASSES = [2, 3, 4, 5, 6, 9, 17, 64, 66] as const;

/** Chip choices for the LiDAR class filter — same visual as the cliff-slice panel. */
const LIDAR_CLASS_CHOICES: ReadonlyArray<ClassChoice> = AVAILABLE_CLASSES.map((cls) => ({
    id: cls,
    label: LAS_CLASS_LABELS[cls] ?? `Classe ${cls}`,
}));

const SHADER_OPTIONS = [
    { value: 'base', label: 'Mono', title: 'Dégradé chaud sable / brun' },
    { value: 'terrain', label: 'Terrain', title: 'Albédo physique roche / pelouse alpine / neige, piloté par la pente, l’altitude et l’orientation. La saison n’est pas un preset : c’est le curseur « Ligne de neige » qui la fait, d’un août sans névé à un massif enneigé. Sans ombrage peint — à utiliser avec le rendu photoréaliste et sans texture drapée' },
    { value: 'slope', label: 'Pente', title: 'Dégradé standard par inclinaison : vert (plat) → jaune → orange → rouge → violet/noir (vertical)' },
] as const satisfies ReadonlyArray<{ value: ShaderPreset; label: string; title: string }>;

/** Lithologie du massif : change la rampe de roche nue du preset Terrain. */
const ROCK_OPTIONS = [
    { value: 'limestone', label: 'Calcaire', title: 'Calcaire urgonien (Chartreuse, Vercors, Dvoluy) : gris clair légèrement chaud, et il s’éclaircit sur les barres verticales, lavées par le ruissellement' },
    { value: 'granite', label: 'Granite', title: 'Cristallin (Belledonne, cluses, Mont-Blanc) : beige patiné en pied de pente, qui fonce vers le gris fer sur les parois fraîchement fracturées' },
    { value: 'schist', label: 'Schiste', title: 'Sédimentaire sombre (schistes ardoisiers, flysch) : gris froid d’emblée, deux fois moins réfléchissant que le calcaire' },
] as const satisfies ReadonlyArray<{ value: RockType; label: string; title: string }>;

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

/** Fonds de carte drapables sur la géométrie 3D (voir `fetchDrapeMosaic`). */
const DRAPE_SOURCE_OPTIONS = [
    { value: 'ortho', label: 'Photo', title: 'Orthophotos IGN (BD ORTHO) — rendu photo-réaliste' },
    { value: 'scan25', label: 'SCAN 25', title: 'Carte topographique SCAN 25 IGN drapée sur le relief (nécessite une clé IGN)' },
    { value: 'plan', label: 'Plan', title: 'Plan IGN v2 drapé sur le relief' },
    { value: 'osm', label: 'OSM', title: 'OpenStreetMap drapé sur le relief' },
] as const satisfies ReadonlyArray<{ value: DrapeSource; label: string; title: string }>;

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
    const photoSource = useMapStore((s) => s.lidarCloudPhotoSource);
    const setPhotoSource = useMapStore((s) => s.setLidarCloudPhotoSource);
    const ignScanApiKey = useMapStore((s) => s.ignScanApiKey);
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

            {/* Texture drapée — fond de carte projeté en nadir sur la géométrie,
                séparé sol / hors-sol. */}
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-700 dark:text-slate-300">Texture drapée</span>
                <SegmentedControl
                    value={photoSource}
                    options={DRAPE_SOURCE_OPTIONS.map((opt) => (
                        opt.value === 'scan25' && !ignScanApiKey
                            ? { ...opt, disabled: true, title: 'Nécessite une clé IGN (voir Réglages)' }
                            : opt
                    ))}
                    onChange={setPhotoSource}
                />
            </div>

            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Texture (sol)</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(photoOpacity * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité de la texture drapée sur le sol"
                    type="range" min={0} max={1} step={0.05}
                    value={photoOpacity}
                    onChange={(e) => setPhotoOpacity(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Texture hors-sol (végétation, bâti, …) */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Texture (non-sol)</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(photoOpacityNonGround * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité de la texture drapée hors-sol"
                    type="range" min={0} max={1} step={0.05}
                    value={photoOpacityNonGround}
                    onChange={(e) => setPhotoOpacityNonGround(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
        </div>
    );
}

/** Shader preset selector + rock/cliff surface detail (see docs/ROCK_AND_CLIFF_DETAIL.md). */
export function ShaderControls() {
    const shader = useMapStore((s) => s.lidarShader);
    const setShader = useMapStore((s) => s.setLidarShader);
    const snowLine = useMapStore((s) => s.lidarSnowLine);
    const setSnowLine = useMapStore((s) => s.setLidarSnowLine);
    // Changer la ligne de neige repeint chaque sommet chargé sur le thread
    // principal (~0,4 s sur un maillage de 1,5 M sommets) : le curseur affiche
    // sa valeur immédiatement mais ne recolorie qu'une fois le geste stabilisé,
    // sinon le glissement se fige. Même parti pris que les curseurs forêt.
    const [snowLineDraft, setSnowLineDraft] = useState(snowLine);
    useEffect(() => setSnowLineDraft(snowLine), [snowLine]);
    useEffect(() => {
        if (snowLineDraft === snowLine) return undefined;
        const handle = globalThis.setTimeout(() => setSnowLine(snowLineDraft), 150);
        return () => globalThis.clearTimeout(handle);
    }, [snowLineDraft, snowLine, setSnowLine]);
    const snowAmount = useMapStore((s) => s.lidarSnowAmount);
    const setSnowAmount = useMapStore((s) => s.setLidarSnowAmount);
    const [snowAmountDraft, setSnowAmountDraft] = useState(snowAmount);
    useEffect(() => setSnowAmountDraft(snowAmount), [snowAmount]);
    useEffect(() => {
        if (snowAmountDraft === snowAmount) return undefined;
        const handle = globalThis.setTimeout(() => setSnowAmount(snowAmountDraft), 150);
        return () => globalThis.clearTimeout(handle);
    }, [snowAmountDraft, snowAmount, setSnowAmount]);
    const rockType = useMapStore((s) => s.lidarRockType);
    const setRockType = useMapStore((s) => s.setLidarRockType);
    const rockFacet = useMapStore((s) => s.lidarRockFacet);
    const setRockFacet = useMapStore((s) => s.setLidarRockFacet);
    const rockMicro = useMapStore((s) => s.lidarRockMicro);
    const setRockMicro = useMapStore((s) => s.setLidarRockMicro);
    const rockBreak = useMapStore((s) => s.lidarRockBreak);
    const setRockBreak = useMapStore((s) => s.setLidarRockBreak);
    const specular = useMapStore((s) => s.lidarRockSpecular);
    const setSpecular = useMapStore((s) => s.setLidarRockSpecular);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Shader</span>
                <SegmentedControl value={shader} options={SHADER_OPTIONS} onChange={setShader} />
            </div>

            {/* Limite climatique commune aux palettes : neige, alpage, pelouse */}
            {shader === 'terrain' && (
                <div className="flex items-center justify-between">
                    <span
                        className="text-sm text-slate-700 dark:text-slate-300"
                        title="Lithologie du massif. Ce n’est ni une saison ni une ambiance : la roche ne dépend que du massif, et c’est le seul écart qu’un curseur ne pouvait pas combler. Un calcaire lavé est deux fois plus clair qu’un schiste, et il s’éclaircit avec la pente là où le cristallin et le schiste s’assombrissent."
                    >
                        Roche
                    </span>
                    <SegmentedControl value={rockType} options={ROCK_OPTIONS} onChange={setRockType} />
                </div>
            )}

            {shader === 'terrain' && (
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span title="Altitude des derniers névés sur une face sud — les faces nord les tiennent 300 m plus bas. C’est ce curseur qui fait la saison : la neige, la limite de l’alpage et le dessèchement de la pelouse s’y calent tous. Plus on s’en approche, plus l’herbe se clairseme et vire au paillé. À 5000 m il passe au-dessus du mont Blanc : plus un flocon nulle part.">
                            Ligne de neige
                        </span>
                        <span className="font-mono text-xs text-slate-400">{snowLineDraft} m</span>
                    </div>
                    <input
                        aria-label="Altitude de la ligne de neige"
                        type="range" min={0} max={5000} step={50}
                        value={snowLineDraft}
                        onChange={(e) => setSnowLineDraft(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
            )}

            {shader === 'terrain' && (
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span title="Épaisseur du manteau, indépendante de son altitude : jusqu’où la neige plâtre la pente, et si sa limite basse est franche ou traîne en névés épars. Une pellicule ne se pose que sur les replats et ne masque rien du relief ; un gros manteau couvre les vires et les dalles et ne cède que dans le surplomb. Descendre la ligne de neige ne saura jamais imiter ça : une paroi raide reste nue à toute altitude.">
                            Enneigement
                        </span>
                        <span className="font-mono text-xs text-slate-400">{Math.round(snowAmountDraft * 100)}%</span>
                    </div>
                    <input
                        aria-label="Épaisseur du manteau neigeux"
                        type="range" min={0} max={1} step={0.05}
                        value={snowAmountDraft}
                        onChange={(e) => setSnowAmountDraft(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
            )}

            {/* Facettisation du maillage reconstruit */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span title="Éclaire le maillage sur la normale géométrique de chaque triangle plutôt que sur la normale lissée. La reconstruction Poisson est continue par construction, ce qui donne au rocher un aspect de cire ; les facettes lui rendent son grain.">
                        Facettes
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                        {rockFacet <= 0 ? 'off' : `${Math.round(rockFacet * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Facettisation du maillage"
                    type="range" min={0} max={1} step={0.05}
                    value={rockFacet}
                    onChange={(e) => setRockFacet(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Micro-relief procédural sur la roche */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span title="Grain décimétrique de la roche, restitué en éclairage : le LiDAR ne descend pas sous ~45 cm d'échantillonnage, et bien moins sur les parois. N'affecte ni la silhouette ni les ombres portées, et épargne la neige.">
                        Micro-relief
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                        {rockMicro <= 0 ? 'off' : `${Math.round(rockMicro * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Micro-relief de la roche"
                    type="range" min={0} max={2} step={0.05}
                    value={rockMicro}
                    onChange={(e) => setRockMicro(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Cassure d'albédo : patine du rocher + bord de névé */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span title="Casse l'aplat de la palette : patine fractale sur le rocher (bancs, veines, oxydation) et bord de névé dentelé au lieu d'un dégradé lisse. Couleur seulement, aucune lumière n'est cuite.">
                        Patine
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                        {rockBreak <= 0 ? 'off' : `${Math.round(rockBreak * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Cassure d'albédo de la roche"
                    type="range" min={0} max={2} step={0.05}
                    value={rockBreak}
                    onChange={(e) => setRockBreak(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            {/* Lobe spéculaire GGX (chemin photoréaliste) */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span title="Reflet minéral large, plus serré sur la neige que sur la roche. C'est ce qui distingue la pierre de l'argile : sans lui l'éclairage est purement diffus. N'agit que sur le rendu photoréaliste.">
                        Spéculaire
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                        {specular <= 0 ? 'off' : `${Math.round(specular * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Lobe spéculaire de la roche"
                    type="range" min={0} max={2} step={0.05}
                    value={specular}
                    onChange={(e) => setSpecular(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
        </div>
    );
}

/** Point size slider + adaptive (decimation-compensating) sizing toggle. */
export function PointSizeControls() {
    const pointSize = useMapStore((s) => s.lidarCloudPointSize);
    const setPointSize = useMapStore((s) => s.setLidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const setSizeCompensation = useMapStore((s) => s.setLidarCloudSizeCompensation);
    const lodEnabled = useMapStore((s) => s.lidarLodEnabled);
    const setLodEnabled = useMapStore((s) => s.setLidarLodEnabled);
    const lodForceLevel = useMapStore((s) => s.lidarLodForceLevel);
    const setLodForceLevel = useMapStore((s) => s.setLidarLodForceLevel);
    const lodDebugInfo = useMapStore((s) => s.lidarLodDebugInfo);
    const meshWireframe = useMapStore((s) => s.lidarMeshWireframe);
    const setMeshWireframe = useMapStore((s) => s.setLidarMeshWireframe);

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

            {/* Debug uniquement : ?debug=true ou ?debug=lod. Décime le nuage et
                le maillage quand la caméra s'éloigne (niveau de détail). */}
            {isLodDebugEnabled() && (
                <div className={DEBUG_WRAP_CLASS}>
                    <label className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300" title="Décime points et maillage selon le zoom (niveau de détail). Débogage uniquement — toujours actif hors debug.">
                            LOD distance
                        </span>
                        <input
                            type="checkbox"
                            checked={lodEnabled}
                            onChange={(e) => setLodEnabled(e.target.checked)}
                            className="h-4 w-4 accent-amber-600"
                        />
                    </label>
                    {lodEnabled && (
                        <label className="block">
                            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                                <span className="flex items-center gap-1.5" title="Force le niveau de LOD affiché, indépendamment du zoom, pour voir son effet réel sur le maillage/nuage.">
                                    Niveau LOD forcé
                                </span>
                                <span className="font-mono text-xs text-slate-400">{lodForceLevel ?? 'Auto'}</span>
                            </div>
                            <input
                                aria-label="Niveau de LOD forcé"
                                type="range" min={-1} max={LOD_LEVEL_COUNT - 1} step={1}
                                value={lodForceLevel ?? -1}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setLodForceLevel(v < 0 ? null : v);
                                }}
                                className="mt-1 w-full accent-amber-600"
                            />
                        </label>
                    )}
                    {lodDebugInfo && (
                        <p className="font-mono text-[11px] text-amber-700/80 dark:text-amber-300/70">
                            Zoom {lodDebugInfo.zoom.toFixed(2)}
                            <br />
                            Points niv. {lodDebugInfo.pointLevel} ({Math.round(lodDebugInfo.pointRatio * 100)}%{lodDebugInfo.pointLevel > 0 && !lodDebugInfo.pointReady ? '…' : ''})
                            <br />
                            Maillage niv. {lodDebugInfo.meshLevel} ({Math.round(lodDebugInfo.meshRatio * 100)}%{lodDebugInfo.meshLevel > 0 && !lodDebugInfo.meshReady ? '…' : ''})
                            <br />
                            {lodDebugInfo.meshDisplayedTriangleCount.toLocaleString('fr-FR')} / {lodDebugInfo.meshTriangleCount.toLocaleString('fr-FR')} triangles
                        </p>
                    )}
                </div>
            )}

            {/* Debug uniquement : ?debug=true ou ?debug=mesh. Affiche le maillage
                sol en fil de fer (sans lumière ni texture) pour visualiser la
                densité des triangles. Le toggle apparaît seulement en debug ;
                il est éteint par défaut. */}
            {isMeshWireframeDebugEnabled() && (
                <div className={DEBUG_WRAP_CLASS}>
                    <label className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300" title="Dessine le maillage sol en fil de fer, sans éclairage ni texture. Débogage uniquement.">
                            Maillage fil de fer
                        </span>
                        <input
                            type="checkbox"
                            checked={meshWireframe}
                            onChange={(e) => setMeshWireframe(e.target.checked)}
                            className="h-4 w-4 accent-amber-600"
                        />
                    </label>
                </div>
            )}
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

const VEG_DIAG_OPTIONS = [
    { value: 'off', label: 'Off', title: 'Coloration normale du feuillage' },
    { value: 'decision', label: 'Mode', title: 'Mode de calcul de la hauteur : rouge = falaise (colonne) → vert = pente (vertical au sol), bleu = surplomb ancré au sommet de falaise, gris = aucun sol' },
    { value: 'clusters', label: 'Clusters', title: 'Couleur par cluster vertical (méthode colonne) : étages/arbres séparés par un vide vertical' },
    { value: 'roughness', label: 'Rugosité', title: 'Relief local du sol 3×3 (viridis 0 → 20 m) : ce qui discrimine pente et falaise' },
    { value: 'flags', label: 'Drapeaux', title: 'gris = sans sol / magenta = surplomb ancré / orange = flottant sur vide / vert = appuyé sur sol fiable' },
] as const satisfies ReadonlyArray<{ value: LidarVegDiagMode; label: string; title: string }>;

/** Cliff vegetation height mode selector (experimental). Each non-`column`
 *  option swaps the noisy per-column stacked height for a distance metric, only
 *  on points classified falaise. */
const VEG_CLIFF_DIST_OPTIONS = [
    { value: 'column', label: 'Colonne', title: 'Défaut : hauteur empilée par colonne (altitude au-dessus de la base du cluster). Le rendu falaise reste inchangé.' },
    { value: 'rimDepth', label: 'Sous crête', title: 'Profondeur verticale sous le sommet de falaise (rimMax − z) : lisse et toujours définie, 0 au sommet.' },
    { value: 'surface3d', label: 'Sol 3D', title: 'Distance 3D au point de sol/rocher (classes 2/9) le plus proche. ⚠ sur une paroi sans retour sol la distance sature au plafond.' },
    { value: 'wallHoriz', label: 'Mur', title: 'Distance horizontale à la paroi rocheuse à l’altitude du point : met en valeur ce qui dépasse du mur.' },
] as const satisfies ReadonlyArray<{ value: VegCliffDistMode; label: string; title: string }>;

/** Discrete-colour legends mirroring the diagnostic shader (decision / flags). */
const DIAG_LEGENDS: Partial<Record<LidarVegDiagMode, ReadonlyArray<{ c: string; t: string }>>> = {
    decision: [
        { c: 'rgb(235,56,51)', t: 'Falaise (colonne)' },
        { c: 'rgb(56,217,82)', t: 'Pente (vertical sol)' },
        { c: 'rgb(51,115,255)', t: 'Surplomb ancré' },
        { c: 'rgb(128,128,128)', t: 'Aucun sol' },
    ],
    flags: [
        { c: 'rgb(128,128,128)', t: 'Aucun sol' },
        { c: 'rgb(255,0,204)', t: 'Surplomb ancré' },
        { c: 'rgb(255,140,0)', t: 'Flottant sur vide' },
        { c: 'rgb(51,204,77)', t: 'Appuyé sur sol' },
    ],
};

/** Free-text note for the continuous diagnostic modes (clusters / roughness). */
const DIAG_NOTES: Partial<Record<LidarVegDiagMode, string>> = {
    clusters: 'Teinte arc-en-ciel stable par cluster vertical : des couleurs voisines très différentes signalent des étages/arbres séparés par un vide.',
    roughness: 'Relief local du sol (3×3) en viridis, 0 (violet) → 20 m (jaune). C’est ce relief qui bascule le calcul de « pente » vers « falaise ».',
};

/**
 * One labelled range slider with a formatted value readout. Factored out to keep
 * {@link HeightAnalysisControls} flat (many near-identical sliders).
 */
function DiagSlider(props: Readonly<{
    label: string; title: string; value: number;
    min: number; max: number; step: number;
    format: (v: number) => string; onChange: (v: number) => void;
}>) {
    const { label, title, value, min, max, step, format, onChange } = props;
    return (
        <label className="block">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span title={title}>{label}</span>
                <span className="font-mono text-xs text-slate-400">{format(value)}</span>
            </div>
            <input
                aria-label={label}
                type="range" min={min} max={max} step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="mt-1 w-full accent-green-600"
            />
        </label>
    );
}

/** Legend swatches / note for the active diagnostic mode. */
function DiagLegend({ mode }: Readonly<{ mode: LidarVegDiagMode }>) {
    const swatches = DIAG_LEGENDS[mode];
    const note = DIAG_NOTES[mode];
    if (!swatches && !note) return null;
    return (
        <div className="space-y-1 rounded-md bg-slate-100 p-2 dark:bg-slate-800/60">
            {swatches && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {swatches.map((s) => (
                        <span key={s.t} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.c }} />
                            {s.t}
                        </span>
                    ))}
                </div>
            )}
            {note && <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{note}</p>}
        </div>
    );
}

/**
 * « Analyse hauteur » — exposes every threshold of the vegetation-height
 * decision (stacked vs vertical-to-ground blend) as live sliders plus a
 * false-colour diagnostic render that reveals which branch, cluster, relief and
 * flags drove each point. All settings recompute the loaded cloud in place (no
 * re-capture). Lives outside the « Végétation enrichie » fieldset so it stays
 * usable for raw diagnostics.
 */
function HeightAnalysisControls() {
    const diagMode = useMapStore((s) => s.lidarVegDiagMode);
    const setDiagMode = useMapStore((s) => s.setLidarVegDiagMode);
    const groundGap = useMapStore((s) => s.lidarVegGroundGap);
    const setGroundGap = useMapStore((s) => s.setLidarVegGroundGap);
    const groundRough = useMapStore((s) => s.lidarVegGroundRough);
    const setGroundRough = useMapStore((s) => s.setLidarVegGroundRough);
    const columnCell = useMapStore((s) => s.lidarVegColumnCell);
    const setColumnCell = useMapStore((s) => s.setLidarVegColumnCell);
    const roughLowFrac = useMapStore((s) => s.lidarVegRoughLowFrac);
    const setRoughLowFrac = useMapStore((s) => s.setLidarVegRoughLowFrac);
    const overhangReach = useMapStore((s) => s.lidarVegOverhangReach);
    const setOverhangReach = useMapStore((s) => s.setLidarVegOverhangReach);
    const cliffDistMode = useMapStore((s) => s.lidarVegCliffDistMode);
    const setCliffDistMode = useMapStore((s) => s.setLidarVegCliffDistMode);
    const colorSmooth = useMapStore((s) => s.lidarVegColorSmooth);
    const setColorSmooth = useMapStore((s) => s.setLidarVegColorSmooth);
    const cliffSparse = useMapStore((s) => s.lidarVegCliffSparseFallback);
    const setCliffSparse = useMapStore((s) => s.setLidarVegCliffSparseFallback);
    const cliffSlopeDeg = useMapStore((s) => s.lidarVegCliffSlopeDeg);
    const setCliffSlopeDeg = useMapStore((s) => s.setLidarVegCliffSlopeDeg);
    const cliffSlopeSample = useMapStore((s) => s.lidarVegCliffSlopeSample);
    const setCliffSlopeSample = useMapStore((s) => s.setLidarVegCliffSlopeSample);
    const cliffSlopeMin = useMapStore((s) => s.lidarVegCliffSlopeMin);
    const setCliffSlopeMin = useMapStore((s) => s.setLidarVegCliffSlopeMin);

    return (
        <details className={`group mt-1 ${DEBUG_WRAP_CLASS}`} open>
            <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                Analyse hauteur
            </summary>
            <div className="mt-3 space-y-3">
                {/* Rendu diagnostic en fausses couleurs : révèle la décision de l'algo. */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300" title="Colorer le feuillage selon la décision de l'algorithme de hauteur, pour comprendre quel mode de calcul et quels seuils s'appliquent où.">
                        Diagnostic
                    </span>
                    <SegmentedControl
                        value={diagMode}
                        options={VEG_DIAG_OPTIONS}
                        onChange={setDiagMode}
                    />
                </div>
                <DiagLegend mode={diagMode} />

                {/* "Falaise simple" : classification basée UNIQUEMENT sur la pente
                    du sol, qui court-circuite tous les seuils détaillés ci-dessous. */}
                <DiagSlider
                    label="Falaise simple (pente)" title="Mode simplifié : au-delà de cet angle de pente du sol, la végétation est traitée en falaise (hauteur par colonne) ; en dessous en pente (hauteur verticale au sol). Court-circuite entièrement la logique détaillée (crête, étalement, surplomb) — un seul réglage. 0 = off (classification détaillée)."
                    value={cliffSlopeDeg} min={0} max={80} step={5}
                    format={(v) => (v <= 0 ? 'off' : `≥ ${v.toFixed(0)}°`)} onChange={setCliffSlopeDeg}
                />
                {/* Échelle de mesure de la pente : un grand rayon lit la pente de
                    loin, donc un petit talus raide mais bas reste « pente ». */}
                {cliffSlopeDeg > 0 && (
                    <DiagSlider
                        label="Échelle pente" title="Distance (m) sur laquelle la pente du sol est mesurée en mode falaise simple. Plus grande = pente lue à une échelle plus grossière, donc un petit talus raide mais peu haut reste classé en pente ; seules les ruptures raides sur toute cette distance (vraies falaises) restent en falaise."
                        value={cliffSlopeSample} min={1} max={20} step={1}
                        format={(v) => `${v.toFixed(0)} m`} onChange={setCliffSlopeSample}
                    />
                )}

                {/* Seuils de décision — recalcul instantané sur le nuage chargé. */}
                <DiagSlider
                    label="Étagement falaise" title="Écart vertical (m) au-delà duquel deux masses de végétation empilées (arbres sur des vires différentes d'une falaise) sont comptées séparément. Plus petit = sépare davantage les étages ; plus grand = fusionne tronc et cime."
                    value={groundGap} min={1} max={8} step={0.5}
                    format={(v) => `${v.toFixed(1)} m`} onChange={setGroundGap}
                />
                <DiagSlider
                    label="Relief sol max" title="Relief local du sol (m, 3×3) au-delà duquel la hauteur reste mesurée par colonne (falaises). En dessous elle est mesurée verticalement au sol — rendant leur vraie hauteur aux houppiers larges. 0 = colonnes seules."
                    value={groundRough} min={0} max={50} step={1}
                    format={(v) => (v <= 0 ? 'off' : `${v.toFixed(0)} m`)} onChange={setGroundRough}
                />
                {/* Plancher de pente du mode DÉTAILLÉ : force la falaise sur les
                    faces raides ouvertes que la logique crête/rebord reverdit. */}
                {cliffSlopeDeg <= 0 && (
                    <DiagSlider
                        label="Pente min falaise" title="Mode détaillé : au-delà de cet angle de pente du sol (mesuré sur 4 m), une cellule est forcée en falaise même quand la logique crête/rebord la classerait en pente — rattrape les faces raides ouvertes et les falaises talutées dont le sommet est à plus de 8 m horizontal de la base. S'ajoute à la logique existante (le surplomb reste surplomb). 0 = off (inchangé). Attention : trop bas sur un terrain globalement pentu, rougit aussi de la forêt légitime."
                        value={cliffSlopeMin} min={0} max={80} step={5}
                        format={(v) => (v <= 0 ? 'off' : `≥ ${v.toFixed(0)}°`)} onChange={setCliffSlopeMin}
                    />
                )}
                <DiagSlider
                    label="Transition relief" title="Bord bas de la transition de mélange, en fraction du « Relief sol max » : en dessous, la hauteur fait pleinement confiance au vertical-au-sol."
                    value={roughLowFrac} min={0} max={1} step={0.05}
                    format={(v) => `${Math.round(v * 100)} %`} onChange={setRoughLowFrac}
                />
                <DiagSlider
                    label="Maille colonne" title="Empreinte XY (m) des colonnes du regroupement vertical. Plus petit sépare davantage les troncs voisins ; plus grand les fusionne."
                    value={columnCell} min={0.5} max={4} step={0.5}
                    format={(v) => `${v.toFixed(1)} m`} onChange={setColumnCell}
                />
                <DiagSlider
                    label="Portée surplomb" title="Distance (m) sur laquelle un point de houppier en surplomb peut être rattaché au sol plus haut du sommet de falaise voisin."
                    value={overhangReach} min={0} max={20} step={1}
                    format={(v) => `${v.toFixed(0)} m`} onChange={setOverhangReach}
                />
                {/* Mode hauteur des points falaise : remplace (sur la falaise
                    uniquement) la hauteur par colonne par une distance. */}
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300" title="Sur les points classés falaise uniquement : abandonne le raisonnement en colonne et colore selon une distance à la falaise. Le reste de la végétation garde sa hauteur normale.">
                        Falaise : distance
                    </span>
                    <SegmentedControl
                        value={cliffDistMode}
                        options={VEG_CLIFF_DIST_OPTIONS}
                        onChange={setCliffDistMode}
                    />
                </div>
                <DiagSlider
                    label="Lissage couleur" title="Sur la végétation des falaises uniquement : supprime les petites tâches isolées très contrastées (souvent marron = hauteur très basse) en les ramenant vers leur voisinage, sans aplatir les transitions normales entre colonnes (un point à peine différent reste quasi intact même à fond). 0 = off ; plus haut = ramène plus fort les points aberrants."
                    value={colorSmooth} min={0} max={1} step={0.05}
                    format={(v) => (v <= 0 ? 'off' : `${Math.round(v * 100)} %`)} onChange={setColorSmooth}
                />
                <DiagSlider
                    label="Repli épars (Mur)" title="Sur les falaises (mode Colonne) : un point seul dans un cluster vertical d'au plus N retours — typiquement un point qui a volé au-dessus du vide — prend la distance horizontale à la paroi au lieu d'une hauteur de colonne nulle (la tâche marron sombre). N'affecte que ces clusters épars ; le reste reste identique. 0 = off ; plus haut = rattrape des clusters un peu plus gros."
                    value={cliffSparse} min={0} max={16} step={1}
                    format={(v) => (v <= 0 ? 'off' : `≤ ${v.toFixed(0)} pts`)} onChange={setCliffSparse}
                />
            </div>
        </details>
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

                {/* Étagement falaise, relief sol et tous les seuils de décision
                    de hauteur sont regroupés dans « Analyse hauteur » ci-dessous,
                    hors du fieldset (actifs même sans végétation enrichie). */}

                {/* Ombrage par normale : intensité du relief calculé sur la normale
                    des feuilles (en plus de l'EDL). 0 % = aplat (EDL seul). Pilote
                    aussi la part d'éclairage neutre sur le feuillage quand le soleil
                    est actif : sous 100 % le rendu est adouci par la lumière neutre. */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span title="Relief de feuillage par normale. Soleil éteint : 0 % = aplat, 100 % = relief complet. Soleil allumé : 100 % = soleil pur, sous 100 % mélange une part d'éclairage neutre pour adoucir.">Ombrage par normale</span>
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

            {/* Analyse hauteur — menu de debug caché, activé via le query param
                `?debug=true` (ou le token ciblé `?debug=hauteur`). Les seuils
                gardent leurs valeurs par défaut (persistées) quand il est masqué. */}
            {isHeightDebugEnabled() && <HeightAnalysisControls />}
        </div>
    );
}
