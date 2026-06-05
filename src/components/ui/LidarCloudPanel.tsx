import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
import { STAGE_LABELS, type LidarProgressStage } from '@/lib/lidarBrowser';
import { LAS_CLASS_LABELS, type LidarMeshData, type LidarShadedCloudData } from '@/lib/lidarCloud';
import { sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';

/** LAS classes available for filtering in the UI. */
const AVAILABLE_CLASSES = [2, 3, 4, 5, 6, 9, 17, 64, 66] as const;

/** Chip choices for the LiDAR class filter — same visual as the cliff-slice panel. */
const LIDAR_CLASS_CHOICES: ReadonlyArray<ClassChoice> = AVAILABLE_CLASSES.map((cls) => ({
    id: cls,
    label: LAS_CLASS_LABELS[cls] ?? `Classe ${cls}`,
}));

/** Progress stage ordering for the progress bar. */
const STAGE_ORDER: LidarProgressStage[] = ['wfs', 'tiles', 'normals', 'mesh', 'colors', 'done'];

/** Allowed density stops, ordered left→right on the slider (coarse → max). */
const STRIDE_STOPS = [32, 16, 8, 4, 2, 1] as const;

/** Snap a stride value to the nearest allowed stop's index. */
function strideToIndex(stride: number): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < STRIDE_STOPS.length; i++) {
        const d = Math.abs(STRIDE_STOPS[i] - stride);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
}

interface ShadowControlsProps {
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    strength: number;
    setStrength: (v: number) => void;
}

interface LidarStatusLineProps {
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    center: { radius: number };
}

function LidarStatusLine({ shaded, mesh, center }: Readonly<LidarStatusLineProps>) {
    const meshLabel = mesh ? ` ${mesh.triangleCount.toLocaleString('fr-FR')} tri` : '';
    const sep = mesh && shaded ? ' +' : '';
    const shadedLabel = shaded ? ` ${shaded.pointCount.toLocaleString('fr-FR')} pts` : '';
    return (
        <p className="text-xs text-slate-500 dark:text-slate-400">
            ✓{meshLabel}{sep}{shadedLabel} · rayon {center.radius} m
        </p>
    );
}

function ShadowControls({ enabled, setEnabled, strength, setStrength }: Readonly<ShadowControlsProps>) {
    return (
        <>
            <label className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300" title="Le maillage projette des ombres en fonction de la position du soleil">
                    Ombres portées
                </span>
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 accent-green-600"
                />
            </label>
            {enabled && (
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Intensité ombres</span>
                        <span className="font-mono text-xs text-slate-400">{Math.round(strength * 100)}%</span>
                    </div>
                    <input
                        aria-label="Intensité des ombres LiDAR"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={strength}
                        onChange={(e) => setStrength(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
            )}
        </>
    );
}

/**
 * Panel section that controls the on-demand IGN LiDAR HD point cloud overlay.
 *
 * The "Charger ici" button triggers a browser-based fetch via copc.js,
 * centered on the current map view.
 */
export function LidarCloudPanel() {
    const mode = useMapStore((s) => s.lidarMode);
    const setMode = useMapStore((s) => s.setLidarMode);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const error = useMapStore((s) => s.lidarCloudError);
    const progress = useMapStore((s) => s.lidarCloudProgress);
    const radius = useMapStore((s) => s.lidarCloudRadius);
    const setRadius = useMapStore((s) => s.setLidarCloudRadius);
    const stride = useMapStore((s) => s.lidarCloudStride);
    const setStride = useMapStore((s) => s.setLidarCloudStride);
    const pointSize = useMapStore((s) => s.lidarCloudPointSize);
    const setPointSize = useMapStore((s) => s.setLidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const setSizeCompensation = useMapStore((s) => s.setLidarCloudSizeCompensation);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const setEdl = useMapStore((s) => s.setLidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const setEdlStrength = useMapStore((s) => s.setLidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const setEdlRadius = useMapStore((s) => s.setLidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const setEdlFarPlane = useMapStore((s) => s.setLidarCloudEdlFarPlane);
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const setOpacity = useMapStore((s) => s.setLidarCloudOpacity);
    const hideBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const setHideBasemap = useMapStore((s) => s.setLidarCloudHideBasemap);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const setClasses = useMapStore((s) => s.setLidarCloudClasses);
    const poissonDepth = useMapStore((s) => s.lidarCloudPoissonDepth);
    const setPoissonDepth = useMapStore((s) => s.setLidarCloudPoissonDepth);
    const load = useMapStore((s) => s.loadLidarCloud);
    const shader = useMapStore((s) => s.lidarShader);
    const setShader = useMapStore((s) => s.setLidarShader);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const setSunDate = useMapStore((s) => s.setLidarSunDate);
    const shadows = useMapStore((s) => s.lidarShadows);
    const setShadows = useMapStore((s) => s.setLidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const setShadowStrength = useMapStore((s) => s.setLidarShadowStrength);
    const clear = useMapStore((s) => s.clearLidarCloud);
    const hasData = shaded !== null || mesh !== null;
    const center = shaded ?? mesh;

    const toggleClass = (cls: number) => {
        if (classes.includes(cls)) {
            setClasses(classes.filter((c) => c !== cls));
        } else {
            setClasses([...classes, cls].sort((a, b) => a - b));
        }
    };

    const selectAll = () => setClasses([...AVAILABLE_CLASSES]);
    const selectGround = () => setClasses([2]);
    const selectVegetation = () => setClasses([3, 4, 5]);
    const selectBuildings = () => setClasses([6, 17, 64, 66]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                >
                    <circle cx="4" cy="6" r="1.2" />
                    <circle cx="10" cy="4" r="1.2" />
                    <circle cx="16" cy="7" r="1.2" />
                    <circle cx="6" cy="11" r="1.2" />
                    <circle cx="13" cy="12" r="1.2" />
                    <circle cx="4" cy="16" r="1.2" />
                    <circle cx="11" cy="17" r="1.2" />
                    <circle cx="17" cy="14" r="1.2" />
                </svg>
                Nuage de points LiDAR HD
            </h3>

            {/* Progress indicator */}
            {loading && progress && (
                <div className="rounded-md bg-green-50 p-2.5 ring-1 ring-green-200 dark:bg-green-900/20 dark:ring-green-800">
                    <div className="flex items-center gap-2 text-xs font-medium text-green-800 dark:text-green-300">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                        <span>{STAGE_LABELS[progress.stage]}</span>
                    </div>
                    {progress.detail && (
                        <p className="mt-1 text-[11px] text-green-700 dark:text-green-400">{progress.detail}</p>
                    )}
                    <div className="mt-2 flex gap-0.5">
                        {STAGE_ORDER.slice(0, -1).map((stage) => {
                            const currentIdx = STAGE_ORDER.indexOf(progress.stage);
                            const stageIdx = STAGE_ORDER.indexOf(stage);
                            const isComplete = stageIdx < currentIdx;
                            const isCurrent = stageIdx === currentIdx;
                            let barClass = 'bg-gray-200 dark:bg-slate-700';
                            if (isComplete) barClass = 'bg-green-600';
                            else if (isCurrent) barClass = 'bg-green-400 dark:bg-green-500';
                            return (
                                <div key={stage} className="flex-1" title={STAGE_LABELS[stage]}>
                                    <div
                                        className={`h-1.5 rounded-full transition-all duration-300 ${barClass}`}
                                        style={isCurrent && progress.progress !== undefined ? {
                                            background: `linear-gradient(to right, rgb(22 163 74) ${progress.progress * 100}%, rgb(229 231 235) ${progress.progress * 100}%)`
                                        } : undefined}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-green-600/70 dark:text-green-400/60">
                        <span>WFS</span>
                        <span>Dalles</span>
                        <span>Normales</span>
                        <span>Maillage</span>
                        <span>Couleurs</span>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION: Calcul
               ═══════════════════════════════════════════════════════════════════ */}
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Calcul</h4>

                {/* Mode */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Mode</span>
                    <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                        <button
                            type="button"
                            onClick={() => setMode('shaded')}
                            className={`rounded-l-md px-2.5 py-1 text-xs ${mode === 'shaded'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Nuage de points ombré (normales par k-PPV)"
                        >
                            Points
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('delaunay')}
                            className={`px-2.5 py-1 text-xs ${mode === 'delaunay'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Sol en mesh Delaunay 2.5D + végétation/bâti en nuage"
                        >
                            Delaunay
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('poisson')}
                            className={`rounded-r-md px-2.5 py-1 text-xs ${mode === 'poisson'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Reconstruction Poisson du sol (octree adaptatif) + nuage végétation/bâti"
                        >
                            Poisson
                        </button>
                    </fieldset>
                </div>

                {/* Poisson depth (poisson mode only) */}
                {mode === 'poisson' && (
                    <label className="block">
                        <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                            <span>Profondeur octree</span>
                            <span className="font-mono text-xs text-slate-400">depth {poissonDepth}</span>
                        </div>
                        <input
                            aria-label="Profondeur de l'octree PoissonRecon"
                            type="range"
                            min={6}
                            max={12}
                            step={1}
                            value={poissonDepth}
                            onChange={(e) => setPoissonDepth(Number(e.target.value))}
                            className="mt-1 w-full accent-green-600"
                        />
                        <p className="mt-1 text-[10px] text-slate-400">
                            8 = rapide / grossier &middot; 10 = équilibré &middot; 12 = fin / lent (RAM en cube).
                        </p>
                    </label>
                )}

                {/* Rayon */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Rayon</span>
                        <span className="font-mono text-xs text-slate-400">
                            {radius} m{mode === 'poisson' && radius > 250 ? ' → 250 m' : ''}
                        </span>
                    </div>
                    <input
                        aria-label="Rayon de chargement LiDAR"
                        type="range"
                        min={50}
                        max={600}
                        step={25}
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

                {/* Densité */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Densité</span>
                        <span className="font-mono text-xs text-slate-400">
                            {stride === 1 ? 'max' : `1/${stride}`}
                        </span>
                    </div>
                    <input
                        aria-label="Décimation du nuage de points"
                        type="range"
                        min={0}
                        max={STRIDE_STOPS.length - 1}
                        step={1}
                        list="lidar-density-stops"
                        value={strideToIndex(stride)}
                        onChange={(e) => setStride(STRIDE_STOPS[Number(e.target.value)])}
                        className="mt-1 w-full accent-green-600"
                    />
                    <datalist id="lidar-density-stops">
                        {STRIDE_STOPS.map((s, i) => (
                            <option key={s} value={i} label={s === 1 ? 'max' : `1/${s}`} />
                        ))}
                    </datalist>
                </label>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                    <button
                        type="button"
                        onClick={() => { load(); }}
                        disabled={loading}
                        className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? 'Chargement…' : 'Charger ici'}
                    </button>
                    <button
                        type="button"
                        onClick={clear}
                        disabled={!hasData || loading}
                        className="rounded-md bg-gray-100 px-3 py-2 text-sm text-slate-700 ring-1 ring-gray-200 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600"
                    >
                        Effacer
                    </button>
                </div>

                {/* Status messages */}
                {hasData && !loading && <LidarStatusLine shaded={shaded} mesh={mesh} center={center!} />}
                {error && (
                    <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">
                        {error}
                    </p>
                )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION: Affichage
               ═══════════════════════════════════════════════════════════════════ */}
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Affichage</h4>

                {/* Opacité */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Opacité</span>
                        <span className="font-mono text-xs text-slate-400">{Math.round(opacity * 100)}%</span>
                    </div>
                    <input
                        aria-label="Opacité du calque LiDAR"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={opacity}
                        onChange={(e) => setOpacity(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

                {/* Atténuer le fond */}
                <label className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Atténuer le fond</span>
                    <input
                        type="checkbox"
                        checked={hideBasemap}
                        onChange={(e) => setHideBasemap(e.target.checked)}
                        className="h-4 w-4 accent-green-600"
                    />
                </label>

                {/* Classes LAS */}
                <div>
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm text-slate-700 dark:text-slate-300">Classes</span>
                        <div className="flex gap-1 text-[10px]">
                            <button type="button" onClick={selectAll} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Tout</button>
                            <button type="button" onClick={selectGround} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Sol</button>
                            <button type="button" onClick={selectVegetation} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Végétation</button>
                            <button type="button" onClick={selectBuildings} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Bâti</button>
                        </div>
                    </div>
                    <ClassFilterChips
                        choices={LIDAR_CLASS_CHOICES}
                        selected={classes}
                        onToggle={toggleClass}
                    />
                    {classes.length === 0 && (
                        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                            Aucune classe sélectionnée — tous les points seront chargés.
                        </p>
                    )}
                </div>

                {/* Shader */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Shader</span>
                    <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                        <button
                            type="button"
                            onClick={() => setShader('base')}
                            className={`rounded-l-md px-2.5 py-1 text-xs ${shader === 'base'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Dégradé chaud sable / brun (style CloudCompare)"
                        >
                            Base
                        </button>
                        <button
                            type="button"
                            onClick={() => setShader('cliff')}
                            className={`px-2.5 py-1 text-xs ${shader === 'cliff'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Rupture nette herbe/calcaire gris avec texture rocheuse"
                        >
                            Falaise
                        </button>
                        <button
                            type="button"
                            onClick={() => setShader('winter')}
                            className={`rounded-r-md px-2.5 py-1 text-xs ${shader === 'winter'
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Neige sur pentes douces/expositions nord, falaise brun rocheux"
                        >
                            Hiver
                        </button>
                    </fieldset>
                </div>

                {/* Soleil — date / heure pour le calcul de l'éclairage */}
                <SunDateControl
                    value={sunDate}
                    onChange={setSunDate}
                    centerLng={center?.centerLng ?? null}
                    centerLat={center?.centerLat ?? null}
                />

                {/* Ombres projetées du maillage LiDAR */}
                <ShadowControls
                    enabled={shadows}
                    setEnabled={setShadows}
                    strength={shadowStrength}
                    setStrength={setShadowStrength}
                />

                {/* Taille des points */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Taille points</span>
                        <span className="font-mono text-xs text-slate-400">{pointSize.toFixed(1)}px</span>
                    </div>
                    <input
                        aria-label="Taille des points LiDAR"
                        type="range"
                        min={0.3}
                        max={8}
                        step={0.1}
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

                {/* Eye-Dome Lighting */}
                <div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-700 dark:text-slate-300">Eye-Dome Lighting</span>
                        <button
                            type="button"
                            onClick={() => setEdl(!edl)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${edl ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                            role="switch"
                            aria-checked={edl}
                        >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${edl ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    {edl && (
                        <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white/50 p-2 dark:border-slate-600 dark:bg-slate-800/50">
                            <label className="block">
                                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                    <span>Intensité</span>
                                    <span className="font-mono text-[10px] text-slate-400">{edlStrength.toFixed(1)}</span>
                                </div>
                                <input
                                    aria-label="Intensité EDL"
                                    type="range"
                                    min={0}
                                    max={50}
                                    step={0.5}
                                    value={edlStrength}
                                    onChange={(e) => setEdlStrength(Number(e.target.value))}
                                    className="mt-1 w-full accent-green-600"
                                />
                            </label>
                            <label className="block">
                                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                    <span>Distance voisins</span>
                                    <span className="font-mono text-[10px] text-slate-400">{edlRadius.toFixed(1)}</span>
                                </div>
                                <input
                                    aria-label="Distance voisins EDL"
                                    type="range"
                                    min={0.5}
                                    max={6}
                                    step={0.1}
                                    value={edlRadius}
                                    onChange={(e) => setEdlRadius(Number(e.target.value))}
                                    className="mt-1 w-full accent-green-600"
                                />
                            </label>
                            <label className="block">
                                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                    <span>Profondeur</span>
                                    <span className="font-mono text-[10px] text-slate-400">{edlFarPlane.toFixed(0)}</span>
                                </div>
                                <input
                                    aria-label="Profondeur EDL"
                                    type="range"
                                    min={100}
                                    max={5000}
                                    step={50}
                                    value={edlFarPlane}
                                    onChange={(e) => setEdlFarPlane(Number(e.target.value))}
                                    className="mt-1 w-full accent-green-600"
                                />
                            </label>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SunDateControl — date/time picker + live read-out of sun azimuth/elevation.
// Kept as a small sub-component so the main panel doesn't balloon its
// cognitive complexity; reuses the global sunLighting() helper.
// ─────────────────────────────────────────────────────────────────────────────
function SunDateControl({
    value,
    onChange,
    centerLng,
    centerLat,
}: Readonly<{
    value: string;
    onChange: (v: string) => void;
    centerLng: number | null;
    centerLat: number | null;
}>) {
    // value is stored as "YYYY-MM-DDTHH:mm" (local time). Split into date and
    // minutes-of-day for an independent date picker + hour slider.
    const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? '';
    const timeMatch = /T(\d{2}):(\d{2})/.exec(value);
    const minutesOfDay = timeMatch
        ? Math.min(1439, Math.max(0, Number(timeMatch[1]) * 60 + Number(timeMatch[2])))
        : 12 * 60;
    const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const mm = String(minutesOfDay % 60).padStart(2, '0');
    const timeLabel = `${hh}h${mm}`;

    const setDate = (d: string) => {
        if (!d) return;
        onChange(`${d}T${hh}:${mm}`);
    };
    const setMinutes = (n: number) => {
        const h = String(Math.floor(n / 60)).padStart(2, '0');
        const m = String(n % 60).padStart(2, '0');
        const base = datePart || new Date().toISOString().slice(0, 10);
        onChange(`${base}T${h}:${m}`);
    };

    let azStr = '—';
    let elStr = '—';
    let dayState: 'night' | 'twilight' | 'day' = 'day';
    if (centerLng != null && centerLat != null) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) {
            const { azimuthDeg, elevationDeg, intensity } = sunLighting(d, centerLat, centerLng);
            azStr = `${Math.round(azimuthDeg)}°`;
            elStr = `${elevationDeg >= 0 ? '+' : ''}${Math.round(elevationDeg)}°`;
            if (intensity <= 0) dayState = 'night';
            else if (intensity < 1) dayState = 'twilight';
        }
    }
    let dayBadge: string;
    let dayLabel: string;
    if (dayState === 'night') {
        dayBadge = 'bg-slate-700 text-slate-200';
        dayLabel = 'nuit';
    } else if (dayState === 'twilight') {
        dayBadge = 'bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
        dayLabel = 'crépuscule';
    } else {
        dayBadge = 'bg-yellow-200 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200';
        dayLabel = 'jour';
    }

    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Soleil</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${dayBadge}`}>{dayLabel}</span>
            </div>
            <input
                aria-label="Date pour le calcul du soleil"
                type="date"
                value={datePart}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
            <div className="mt-2 flex items-center gap-2">
                <input
                    aria-label="Heure de la journée"
                    type="range"
                    min={0}
                    max={1439}
                    step={5}
                    value={minutesOfDay}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    className="flex-1 accent-green-600"
                />
                <span className="w-12 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-200">
                    {timeLabel}
                </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
                az {azStr} · h {elStr}
            </p>
        </div>
    );
}
