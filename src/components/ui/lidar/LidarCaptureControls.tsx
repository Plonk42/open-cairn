import { POISSON_MAX_RADIUS, useMapStore } from '@/stores/mapStore';
import { LidarProgressBar } from './LidarProgressBar';
import { LidarStatusLine } from './LidarStatusLine';

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

type LidarMode = 'shaded' | 'delaunay' | 'poisson';

function ModeButton({
    mode,
    current,
    onClick,
    label,
    title,
    rounded,
}: Readonly<{
    mode: LidarMode;
    current: LidarMode;
    onClick: () => void;
    label: string;
    title: string;
    rounded: 'l' | 'r' | '';
}>) {
    const ROUND_CLS: Record<'l' | 'r' | '', string> = { l: 'rounded-l-md', r: 'rounded-r-md', '': '' };
    const roundCls = ROUND_CLS[rounded];
    const activeCls = mode === current
        ? 'bg-green-600 text-white'
        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
    return (
        <button type="button" onClick={onClick} title={title} className={`${roundCls} px-2.5 py-1 text-xs ${activeCls}`}>
            {label}
        </button>
    );
}

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
 * Capture controls brick: mode selection, Poisson params, radius, density, the
 * load/clear actions, the status line and the loading progress bar. Reads and
 * writes the shared mapStore so the studio dock and the classic launcher stay
 * in sync with zero duplication.
 */
export function LidarCaptureControls({ showProgress = true }: Readonly<{ showProgress?: boolean }>) {
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
    const load = useMapStore((s) => s.loadLidarCloud);
    const clear = useMapStore((s) => s.clearLidarCloud);
    const hasData = shaded !== null || mesh !== null;
    const center = shaded ?? mesh;

    return (
        <div className="flex min-h-0 flex-col gap-3">
            {/* Scrollable parameters — keeps the action footer always visible */}
            <div className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto">
                {/* Mode */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Mode</span>
                    <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                        <ModeButton mode="shaded" current={mode} onClick={() => setMode('shaded')} label="Points" rounded="l" title="Nuage de points ombré (normales par k-PPV)" />
                        <ModeButton mode="delaunay" current={mode} onClick={() => setMode('delaunay')} label="Delaunay" rounded="" title="Sol en mesh Delaunay 2.5D + végétation/bâti en nuage" />
                        <ModeButton mode="poisson" current={mode} onClick={() => setMode('poisson')} label="Poisson" rounded="r" title="Reconstruction Poisson du sol (octree adaptatif) + nuage végétation/bâti" />
                    </fieldset>
                </div>

                {mode === 'poisson' && <PoissonControls />}

                {/* Rayon */}
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Rayon</span>
                        <span className="font-mono text-xs text-slate-400">
                            {radius} m{mode === 'poisson' && radius > POISSON_MAX_RADIUS ? ` → ${POISSON_MAX_RADIUS} m` : ''}
                        </span>
                    </div>
                    <input
                        aria-label="Rayon de chargement LiDAR"
                        type="range" min={50} max={1000} step={25}
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>

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
