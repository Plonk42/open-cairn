import { LAS_CLASS_LABELS } from '@/lib/lidarCloud';
import { useMapStore } from '@/stores/mapStore';

/** LAS classes available for filtering in the UI. */
const AVAILABLE_CLASSES = [2, 3, 4, 5, 6, 9, 17, 64, 66] as const;

/**
 * Panel section that controls the on-demand IGN LiDAR HD point cloud overlay.
 *
 * The "Charger ici" button triggers a fetch on the local cropping service
 * (`services/lidar-cloud/server.mjs`), centered on the current map view.
 */
export function LidarCloudPanel() {
    const mode = useMapStore((s) => s.lidarMode);
    const setMode = useMapStore((s) => s.setLidarMode);
    const backend = useMapStore((s) => s.lidarBackend);
    const setBackend = useMapStore((s) => s.setLidarBackend);
    const cloud = useMapStore((s) => s.lidarCloud);
    const mesh = useMapStore((s) => s.lidarMesh);
    const shaded = useMapStore((s) => s.lidarShaded);
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
    const coloring = useMapStore((s) => s.lidarCloudColoring);
    const setColoring = useMapStore((s) => s.setLidarCloudColoring);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const setEdl = useMapStore((s) => s.setLidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const setEdlStrength = useMapStore((s) => s.setLidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const setEdlRadius = useMapStore((s) => s.setLidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const setEdlFarPlane = useMapStore((s) => s.setLidarCloudEdlFarPlane);
    const aoStrength = useMapStore((s) => s.lidarCloudAoStrength);
    const setAoStrength = useMapStore((s) => s.setLidarCloudAoStrength);
    const aoRadius = useMapStore((s) => s.lidarCloudAoRadius);
    const setAoRadius = useMapStore((s) => s.setLidarCloudAoRadius);
    const hideBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const setHideBasemap = useMapStore((s) => s.setLidarCloudHideBasemap);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const setClasses = useMapStore((s) => s.setLidarCloudClasses);
    const load = useMapStore((s) => s.loadLidarCloud);
    const clear = useMapStore((s) => s.clearLidarCloud);
    const hasData = cloud !== null || mesh !== null || shaded !== null;

    const toggleClass = (cls: number) => {
        if (classes.includes(cls)) {
            setClasses(classes.filter((c) => c !== cls));
        } else {
            setClasses([...classes, cls].sort((a, b) => a - b));
        }
    };

    const selectAll = () => setClasses([...AVAILABLE_CLASSES]);
    const selectNone = () => setClasses([]);
    const selectGround = () => setClasses([2]);
    const selectVegetation = () => setClasses([3, 4, 5]);
    const selectBuildings = () => setClasses([6, 64, 66]);

    return (
        <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
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

            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Charge à la demande les points LiDAR HD de l'IGN autour du centre
                de la carte. Nécessite le service local lancé avec{' '}
                <span className="font-mono text-[10px]">npm run lidar</span>.
            </p>

            <fieldset className="mb-2 inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                <button
                    type="button"
                    onClick={() => setBackend('service')}
                    className={`rounded-l-md px-3 py-1 text-xs ${backend === 'service'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                    title="Crop côté serveur (npm run lidar)"
                >
                    Service local
                </button>
                <button
                    type="button"
                    onClick={() => setBackend('browser')}
                    className={`rounded-r-md px-3 py-1 text-xs ${backend === 'browser'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                    title="Crop dans le navigateur via copc.js (pas de serveur — déployable sur GitHub Pages)"
                >
                    Navigateur
                </button>
            </fieldset>

            <fieldset className="mb-2 inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                <button
                    type="button"
                    onClick={() => setMode('shaded')}
                    className={`rounded-l-md px-3 py-1 text-xs ${mode === 'shaded'
                        ? 'bg-green-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                    title="Nuage de points ombré (normales par k-PPV) — gère les falaises"
                >
                    Points ombrés
                </button>
                <button
                    type="button"
                    onClick={() => setMode('mesh')}
                    className={`px-3 py-1 text-xs ${mode === 'mesh'
                        ? 'bg-green-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                    title="Mesh 2.5D Delaunay du sol (artefacts en falaise)"
                >
                    Mesh sol
                </button>
                <button
                    type="button"
                    onClick={() => setMode('cloud')}
                    className={`rounded-r-md px-3 py-1 text-xs ${mode === 'cloud'
                        ? 'bg-green-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                    title="Nuage brut coloré par classification LAS"
                >
                    Nuage brut
                </button>
            </fieldset>

            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Rayon</span>
                    <span className="font-mono text-xs text-slate-400">{radius} m</span>
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

            <label className="mt-2 block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Densité (1/N)</span>
                    <span className="font-mono text-xs text-slate-400">
                        {stride === 1 ? 'max' : `1/${stride}`}
                    </span>
                </div>
                <input
                    aria-label="Décimation du nuage de points"
                    type="range"
                    min={1}
                    max={50}
                    step={1}
                    value={stride}
                    onChange={(e) => setStride(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            <label className="mt-2 block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Taille des points</span>
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
                    disabled={mode === 'mesh'}
                    className="mt-1 w-full accent-green-600 disabled:opacity-40"
                />
            </label>

            <label className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700 dark:text-slate-300" title="Augmente automatiquement la taille des points quand la décimation est forte">
                    Compenser densité
                </span>
                <input
                    type="checkbox"
                    checked={sizeCompensation}
                    onChange={(e) => setSizeCompensation(e.target.checked)}
                    disabled={mode === 'mesh'}
                    className="h-4 w-4 accent-green-600 disabled:opacity-40"
                />
            </label>

            <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Coloration</span>
                </div>
                <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                    <button
                        type="button"
                        onClick={() => setColoring('class')}
                        className={`rounded-l-md px-3 py-1 text-xs ${coloring === 'class'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                            }`}
                        title="Couleurs par classification LAS (sol, végétation, bâtiments...)"
                        disabled={mode === 'mesh'}
                    >
                        Classification
                    </button>
                    <button
                        type="button"
                        onClick={() => setColoring('slope')}
                        className={`px-3 py-1 text-xs ${coloring === 'slope'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                            }`}
                        title="Couleurs basées sur la pente (normales du terrain)"
                        disabled={mode === 'mesh'}
                    >
                        Pente
                    </button>
                    <button
                        type="button"
                        onClick={() => setColoring('mixed')}
                        className={`rounded-r-md px-3 py-1 text-xs ${coloring === 'mixed'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                            }`}
                        title="Sol coloré par pente, végétation et bâtiments par classification LAS"
                        disabled={mode === 'mesh'}
                    >
                        Mixte
                    </button>
                </fieldset>
            </div>

            <div className="mt-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Eye-Dome Lighting</span>
                    <button
                        type="button"
                        onClick={() => setEdl(!edl)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${edl ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'
                            }`}
                        role="switch"
                        aria-checked={edl}
                        disabled={mode === 'mesh'}
                    >
                        <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${edl ? 'translate-x-4' : 'translate-x-0'
                                }`}
                        />
                    </button>
                </div>
                {edl && (
                    <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                        <label className="block">
                            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                                <span>Intensité EDL</span>
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
                                disabled={mode === 'mesh'}
                                className="mt-1 w-full accent-green-600 disabled:opacity-40"
                            />
                        </label>
                        <label className="block">
                            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                                <span>Distance voisins (px×2)</span>
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
                                disabled={mode === 'mesh'}
                                className="mt-1 w-full accent-green-600 disabled:opacity-40"
                            />
                        </label>
                        <label className="block">
                            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                                <span>Normalisation profondeur</span>
                                <span className="font-mono text-[10px] text-slate-400">{edlFarPlane.toFixed(0)}</span>
                            </div>
                            <input
                                aria-label="Normalisation profondeur EDL"
                                type="range"
                                min={100}
                                max={5000}
                                step={50}
                                value={edlFarPlane}
                                onChange={(e) => setEdlFarPlane(Number(e.target.value))}
                                disabled={mode === 'mesh'}
                                className="mt-1 w-full accent-green-600 disabled:opacity-40"
                            />
                        </label>
                    </div>
                )}
            </div>

            <div className="mt-3">
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                    <label className="block">
                        <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                            <span>Occlusion ambiante</span>
                            <span className="font-mono text-[10px] text-slate-400">{aoStrength.toFixed(1)}</span>
                        </div>
                        <input
                            aria-label="Intensité occlusion ambiante"
                            type="range"
                            min={0}
                            max={8}
                            step={0.1}
                            value={aoStrength}
                            onChange={(e) => setAoStrength(Number(e.target.value))}
                            disabled={mode === 'mesh'}
                            className="mt-1 w-full accent-green-600 disabled:opacity-40"
                        />
                    </label>
                    {aoStrength > 0 && (
                        <label className="block">
                            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                                <span>Rayon AO</span>
                                <span className="font-mono text-[10px] text-slate-400">{aoRadius.toFixed(1)}</span>
                            </div>
                            <input
                                aria-label="Rayon occlusion ambiante"
                                type="range"
                                min={0.2}
                                max={6}
                                step={0.1}
                                value={aoRadius}
                                onChange={(e) => setAoRadius(Number(e.target.value))}
                                disabled={mode === 'mesh'}
                                className="mt-1 w-full accent-green-600 disabled:opacity-40"
                            />
                        </label>
                    )}
                </div>
            </div>

            <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Classes LAS</span>
                    <div className="flex gap-1 text-[10px]">
                        <button type="button" onClick={selectAll} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Tout</button>
                        <button type="button" onClick={selectNone} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Rien</button>
                        <button type="button" onClick={selectGround} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Sol</button>
                        <button type="button" onClick={selectVegetation} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Végét.</button>
                        <button type="button" onClick={selectBuildings} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Bâti</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {AVAILABLE_CLASSES.map((cls) => (
                        <label key={cls} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <input
                                type="checkbox"
                                checked={classes.includes(cls)}
                                onChange={() => toggleClass(cls)}
                                className="h-3.5 w-3.5 accent-green-600"
                            />
                            <span>{LAS_CLASS_LABELS[cls] ?? `Classe ${cls}`}</span>
                        </label>
                    ))}
                </div>
                {classes.length === 0 && (
                    <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                        Aucune classe sélectionnée — tous les points seront chargés.
                    </p>
                )}
            </div>

            <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                    Atténuer le fond
                </span>
                <input
                    type="checkbox"
                    checked={hideBasemap}
                    onChange={(e) => setHideBasemap(e.target.checked)}
                    className="h-4 w-4 accent-green-600"
                />
            </label>

            <div className="mt-3 flex gap-2">
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

            {/* Progress indicator (browser mode only) */}
            {loading && progress && (
                <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                        <span>{progress.message}</span>
                        {progress.detail && (
                            <span className="text-slate-400 dark:text-slate-500">({progress.detail})</span>
                        )}
                    </div>
                    {progress.progress !== undefined && progress.progress > 0 && progress.progress < 1 && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                            <div
                                className="h-full bg-green-600 transition-all duration-200"
                                style={{ width: `${Math.round(progress.progress * 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Loading spinner for server mode (no progress info) */}
            {loading && !progress && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                    <span>Chargement en cours…</span>
                </div>
            )}

            {shaded && !loading && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Points ombrés : {shaded.pointCount.toLocaleString('fr-FR')} points (rayon {shaded.radius} m).
                </p>
            )}
            {mesh && !loading && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Mesh : {mesh.vertexCount.toLocaleString('fr-FR')} sommets,{' '}
                    {mesh.triangleCount.toLocaleString('fr-FR')} triangles (rayon {mesh.radius} m).
                </p>
            )}
            {cloud && !loading && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {cloud.pointCount.toLocaleString('fr-FR')} points chargés (rayon{' '}
                    {cloud.radius} m).
                </p>
            )}

            {error && (
                <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">
                    {error}
                </p>
            )}
        </div>
    );
}
