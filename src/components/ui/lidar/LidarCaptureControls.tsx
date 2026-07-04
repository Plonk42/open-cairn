import { SegmentedControl } from '@/components/ui/common/SegmentedControl';
import {
    LIDAR_RECT_MAX_AREA_M2, rectAreaHa,
} from '@/lib/lidarCaptureRect';
import { POISSON_MAX_AREA_M2, useMapStore } from '@/stores/mapStore';
import { LidarProgressBar } from './LidarProgressBar';
import { LidarStatusLine } from './LidarStatusLine';

/** Allowed density stops, ordered left→right on the slider (coarse → max). */
const STRIDE_STOPS = [32, 16, 8, 4, 2, 1] as const;

/** Capture rectangle side-length slider bounds (metres). */
const CAPTURE_SIDE_MIN_M = 50;
const CAPTURE_SIDE_MAX_M = 2000;
const CAPTURE_SIDE_STEP_M = 25;

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

type LidarMode = 'shaded' | 'delaunay' | 'poisson';

const MODE_OPTIONS = [
    { value: 'shaded', label: 'Points', title: 'Nuage de points ombré (normales par k-PPV)' },
    { value: 'delaunay', label: 'Delaunay', title: 'Sol en mesh Delaunay 2.5D + végétation/bâti en nuage' },
    { value: 'poisson', label: 'Poisson', title: 'Reconstruction Poisson du sol (octree adaptatif) + nuage végétation/bâti' },
] as const satisfies ReadonlyArray<{ value: LidarMode; label: string; title: string }>;

function PoissonControls() {
    const poissonDepth = useMapStore((s) => s.lidarCloudPoissonDepth);
    const setPoissonDepth = useMapStore((s) => s.setLidarCloudPoissonDepth);
    const poissonSamplesPerNode = useMapStore((s) => s.lidarCloudPoissonSamplesPerNode);
    const setPoissonSamplesPerNode = useMapStore((s) => s.setLidarCloudPoissonSamplesPerNode);
    const poissonPointWeight = useMapStore((s) => s.lidarCloudPoissonPointWeight);
    const setPoissonPointWeight = useMapStore((s) => s.setLidarCloudPoissonPointWeight);
    return (
        <div className="space-y-3">
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Profondeur octree</span>
                    <span className="font-mono text-xs text-slate-400">depth {poissonDepth}</span>
                </div>
                <input
                    aria-label="Profondeur de l'octree PoissonRecon"
                    type="range" min={6} max={12} step={1}
                    value={poissonDepth}
                    onChange={(e) => setPoissonDepth(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                    8 = rapide / grossier &middot; 10 = équilibré &middot; 12 = fin / lent.
                </p>
            </label>
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Échantillons par nœud</span>
                    <span className="font-mono text-xs text-slate-400">{poissonSamplesPerNode}</span>
                </div>
                <input
                    aria-label="Nombre minimal d'échantillons par nœud octree"
                    type="range" min={0.5} max={5} step={0.5}
                    value={poissonSamplesPerNode}
                    onChange={(e) => setPoissonSamplesPerNode(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                    Adapte la finesse du maillage &middot; 1,5 (défaut) &middot; min 0,5 / max 5.
                </p>
            </label>
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Poids des points</span>
                    <span className="font-mono text-xs text-slate-400">{poissonPointWeight}</span>
                </div>
                <input
                    aria-label="Poids d'interpolation des points PoissonRecon"
                    type="range" min={0.5} max={16} step={0.5}
                    value={poissonPointWeight}
                    onChange={(e) => setPoissonPointWeight(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                    Adhésion du maillage aux points &middot; 4 (défaut) &middot; min 0,5 / max 16.
                </p>
            </label>
        </div>
    );
}

/**
 * Capture-zone control: the centred capture rectangle. Two sliders set its width
 * and length (a square is just width === length), and a checkbox locks it to a
 * north-up orientation instead of following the live camera bearing.
 */
function CaptureZoneControls() {
    const mode = useMapStore((s) => s.lidarMode);
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const setRect = useMapStore((s) => s.setLidarCaptureRect);
    const northFixed = useMapStore((s) => s.lidarRectNorthFixed);
    const setNorthFixed = useMapStore((s) => s.setLidarRectNorthFixed);
    const maxArea = mode === 'poisson' ? POISSON_MAX_AREA_M2 : LIDAR_RECT_MAX_AREA_M2;
    const overCap = rect.widthM * rect.lengthM > maxArea;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span>Zone</span>
                <span className="font-mono text-xs text-slate-400">
                    {Math.round(rect.widthM)} × {Math.round(rect.lengthM)} m
                    {' · '}{rectAreaHa(rect.widthM, rect.lengthM).toFixed(1)} ha
                </span>
            </div>
            <label className="block">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Largeur</span>
                    <span className="font-mono text-slate-400">{Math.round(rect.widthM)} m</span>
                </div>
                <input
                    aria-label="Largeur de la zone de capture LiDAR"
                    type="range" min={CAPTURE_SIDE_MIN_M} max={CAPTURE_SIDE_MAX_M} step={CAPTURE_SIDE_STEP_M}
                    value={rect.widthM}
                    onChange={(e) => setRect({ ...rect, widthM: Number(e.target.value) })}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
            <label className="block">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Longueur</span>
                    <span className="font-mono text-slate-400">{Math.round(rect.lengthM)} m</span>
                </div>
                <input
                    aria-label="Longueur de la zone de capture LiDAR"
                    type="range" min={CAPTURE_SIDE_MIN_M} max={CAPTURE_SIDE_MAX_M} step={CAPTURE_SIDE_STEP_M}
                    value={rect.lengthM}
                    onChange={(e) => setRect({ ...rect, lengthM: Number(e.target.value) })}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                    type="checkbox"
                    checked={northFixed}
                    onChange={(e) => setNorthFixed(e.target.checked)}
                    className="accent-green-600"
                />
                <span>Orientation nord fixe</span>
            </label>
            {overCap && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Zone trop grande — sera réduite à {Math.round(maxArea / 10_000)} ha au chargement.
                </p>
            )}
        </div>
    );
}

/**
 * Capture controls brick: mode selection, Poisson params, capture zone,
 * density, the load/clear actions, the status line and the loading progress
 * bar. Reads and writes the shared mapStore so the studio dock and the
 * classic launcher stay in sync with zero duplication.
 */
export function LidarCaptureControls({ showProgress = true }: Readonly<{ showProgress?: boolean }>) {
    const mode = useMapStore((s) => s.lidarMode);
    const setMode = useMapStore((s) => s.setLidarMode);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const error = useMapStore((s) => s.lidarCloudError);
    const progress = useMapStore((s) => s.lidarCloudProgress);
    const stride = useMapStore((s) => s.lidarCloudStride);
    const setStride = useMapStore((s) => s.setLidarCloudStride);
    const load = useMapStore((s) => s.loadLidarCloud);
    const cancelLoad = useMapStore((s) => s.cancelLidarCloudLoad);
    const clear = useMapStore((s) => s.clearLidarCloud);
    const hasData = shaded !== null || mesh !== null;
    const center = shaded ?? mesh;

    return (
        <div className="flex min-h-0 flex-col gap-3">
            {/* Scrollable parameters — keeps the action footer always visible */}
            <div className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto">
                {/* Mode */}
                <div data-tutorial="capture-modes" className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Mode</span>
                    <SegmentedControl value={mode} options={MODE_OPTIONS} onChange={setMode} />
                </div>

                {mode === 'poisson' && <PoissonControls />}

                {/* Zone — square (radius) or drawn rectangle */}
                <CaptureZoneControls />

                {/* Densité */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Densité</span>
                        <span className="font-mono text-xs text-slate-400">{stride === 1 ? 'max' : `1/${stride}`}</span>
                    </div>
                    <input
                        aria-label="Décimation du nuage de points"
                        type="range" min={0} max={STRIDE_STOPS.length - 1} step={1}
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
            </div>

            {/* Pinned action footer — stays visible even when the params scroll */}
            <div className="shrink-0 space-y-3">
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => { load(); }}
                        disabled={loading}
                        className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? 'Chargement…' : 'Charger ici'}
                    </button>
                    {loading && (
                        <button
                            type="button"
                            onClick={cancelLoad}
                            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800"
                        >
                            Annuler
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={clear}
                        disabled={!hasData || loading}
                        className="rounded-md bg-gray-100 px-3 py-2 text-sm text-slate-700 ring-1 ring-gray-200 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600"
                    >
                        Effacer
                    </button>
                </div>

                {showProgress && loading && progress && <LidarProgressBar progress={progress} />}
                {hasData && !loading && center && <LidarStatusLine shaded={shaded} mesh={mesh} radius={center.radius} />}
                {error && (
                    <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}
