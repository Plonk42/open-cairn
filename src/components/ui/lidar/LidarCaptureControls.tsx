import { SegmentedControl } from '@/components/ui/common/SegmentedControl';
import {
    LIDAR_RECT_MAX_AREA_M2, rectAreaHa,
} from '@/lib/lidarCaptureRect';
import {
    captureAdvice, formatDetail, formatSeconds, POISSON_DEPTH_MAX, POISSON_DEPTH_MIN,
    qualityTiers, STRIDE_STOPS, tierIndexOf, type CaptureAdvice,
} from '@/lib/lidarQuality';
import {
    CAPTURE_POINT_BUDGET, estimateCapture, formatResolution,
    RESOLUTION_STOPS_M, resolutionToIndex,
} from '@/lib/lidarResolution';
import { useMapStore } from '@/stores/mapStore';
import { useMemo } from 'react';
import { LidarProgressBar } from './LidarProgressBar';
import { LidarStatusLine } from './LidarStatusLine';

/** Capture rectangle side-length slider bounds (metres). */
const CAPTURE_SIDE_MIN_M = 50;
const CAPTURE_SIDE_MAX_M = 5000;
/** Slider track resolution; the scale is logarithmic, not the step. */
const SIDE_SLIDER_STEPS = 1000;
const SIDE_SLIDER_RATIO = CAPTURE_SIDE_MAX_M / CAPTURE_SIDE_MIN_M;

/**
 * Log-scaled side slider: on a linear 50–5000 m track a 300 m zone sits in the
 * first 5 % and becomes unsettable. Snapped to a step that grows with the
 * value, so the read-out stays a round number at every scale.
 */
function sideFromSlider(t: number): number {
    const v = CAPTURE_SIDE_MIN_M * SIDE_SLIDER_RATIO ** (t / SIDE_SLIDER_STEPS);
    let step = 250;
    if (v < 500) step = 25;
    else if (v < 2000) step = 50;
    return Math.min(CAPTURE_SIDE_MAX_M, Math.max(CAPTURE_SIDE_MIN_M, Math.round(v / step) * step));
}

function sliderFromSide(m: number): number {
    return (SIDE_SLIDER_STEPS * Math.log(m / CAPTURE_SIDE_MIN_M)) / Math.log(SIDE_SLIDER_RATIO);
}

function formatPoints(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
    return `${Math.round(n / 1000)} k`;
}

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
    const poissonSharpen = useMapStore((s) => s.lidarCloudPoissonSharpen);
    const setPoissonSharpen = useMapStore((s) => s.setLidarCloudPoissonSharpen);
    const normalRobust = useMapStore((s) => s.lidarCloudPoissonNormalRobust);
    const setNormalRobust = useMapStore((s) => s.setLidarCloudPoissonNormalRobust);
    const flatBase = useMapStore((s) => s.lidarCloudPoissonFlatBase);
    const setFlatBase = useMapStore((s) => s.setLidarCloudPoissonFlatBase);
    return (
        <div className="space-y-3">
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Profondeur octree</span>
                    <span className="font-mono text-xs text-slate-400">depth {poissonDepth}</span>
                </div>
                <input
                    aria-label="Profondeur de l'octree PoissonRecon"
                    type="range" min={POISSON_DEPTH_MIN} max={POISSON_DEPTH_MAX} step={1}
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
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Arêtes</span>
                    <span className="font-mono text-xs text-slate-400">
                        {normalRobust <= 0 ? 'off' : `${Math.round(normalRobust * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Préservation des arêtes dans l'estimation des normales"
                    type="range" min={0} max={1} step={0.05}
                    value={normalRobust}
                    onChange={(e) => setNormalRobust(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                    Empêche les normales de moyenner de part et d&apos;autre des ruptures de pente &middot; 60 % (défaut).
                </p>
            </label>
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Netteté</span>
                    <span className="font-mono text-xs text-slate-400">
                        {poissonSharpen <= 0 ? 'off' : `${Math.round(poissonSharpen * 100)}%`}
                    </span>
                </div>
                <input
                    aria-label="Netteté du maillage reconstruit"
                    type="range" min={0} max={1} step={0.05}
                    value={poissonSharpen}
                    onChange={(e) => setPoissonSharpen(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                    Récupère le relief fin que le solveur lisse &middot; 50 % (défaut).
                </p>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                    type="checkbox"
                    checked={flatBase}
                    onChange={(e) => setFlatBase(e.target.checked)}
                    className="accent-green-600"
                />
                <span>Socle plat</span>
            </label>
            <p className="-mt-1 text-[10px] text-slate-400">
                Grave le relief sur une brique à base plate au lieu d'un dessous bombé.
            </p>
        </div>
    );
}

/**
 * Zone read-out + the draw affordance. The rectangle is anchored to the ground,
 * so its position and orientation come from the drag on the map — there is
 * nothing to set here beyond starting a new one.
 */
function ZoneControl() {
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const drawActive = useMapStore((s) => s.lidarRectDrawActive);
    const setDrawActive = useMapStore((s) => s.setLidarRectDrawActive);
    const overCap = rect.widthM * rect.lengthM > LIDAR_RECT_MAX_AREA_M2;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span>Zone</span>
                <span className="font-mono text-xs text-slate-400">
                    {Math.round(rect.widthM)} × {Math.round(rect.lengthM)} m
                    {' · '}{rectAreaHa(rect.widthM, rect.lengthM).toFixed(1)} ha
                </span>
            </div>
            <button
                type="button"
                onClick={() => setDrawActive(!drawActive)}
                className={`w-full rounded-md px-3 py-2 text-sm ring-1 transition ${drawActive
                    ? 'bg-green-50 text-green-800 ring-green-300 dark:bg-green-900/30 dark:text-green-200 dark:ring-green-700'
                    : 'bg-gray-100 text-slate-700 ring-gray-200 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600'}`}
            >
                {drawActive ? 'Glissez sur la carte — Échap pour annuler' : 'Dessiner la zone'}
            </button>
            {overCap && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Zone trop grande — sera réduite à {Math.round(LIDAR_RECT_MAX_AREA_M2 / 10_000)} ha au chargement.
                </p>
            )}
        </div>
    );
}

/**
 * The single quality dial: one step is one octree level, one resolution stop
 * and two ground-density stops at once, because those three settings are only
 * coherent together (see `lidarQuality.ts`). Hand-tuning them in the advanced
 * section puts the dial off its stops, which the read-out says plainly.
 */
function QualityControl() {
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const resolution = useMapStore((s) => s.lidarCaptureResolution);
    const depth = useMapStore((s) => s.lidarCloudPoissonDepth);
    const groundStride = useMapStore((s) => s.lidarCloudGroundStride);
    const setQuality = useMapStore((s) => s.setLidarCaptureQuality);

    const tiers = useMemo(
        () => qualityTiers(rect.widthM, rect.lengthM),
        [rect.widthM, rect.lengthM],
    );
    const index = tierIndexOf(tiers, resolution, depth, groundStride);
    const tier = index < 0 ? null : tiers[index];
    const custom = estimateCapture(rect.widthM, rect.lengthM, resolution);

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span>Qualité</span>
                <span className="font-mono text-xs text-slate-400">
                    {tier ? `détail ${formatDetail(tier.detailM)}` : 'personnalisée'}
                </span>
            </div>
            <input
                aria-label="Niveau de qualité de la capture"
                type="range" min={0} max={tiers.length - 1} step={1}
                list="lidar-quality-stops"
                value={index < 0 ? tiers.length - 1 : index}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="mt-1 w-full accent-green-600"
            />
            <datalist id="lidar-quality-stops">
                {tiers.map((t, i) => (
                    <option key={t.depth} value={i} label={formatDetail(t.detailM)} />
                ))}
            </datalist>
            <p className="text-[10px] text-slate-400">
                ≈ {Math.round((tier?.bytes ?? custom.bytes) / 1e6)} Mo téléchargés
                {tier && ` · ≈ ${formatSeconds(tier.seconds)} · ${formatPoints(tier.vertices)} sommets`}
                {!tier && ` · ≈ ${formatPoints(custom.points)} points`}
            </p>
        </div>
    );
}

/** Same wording as the density sliders: full density reads "max", not "1/1". */
function strideLabel(stride: number): string {
    return stride === 1 ? 'max' : `1/${stride}`;
}

/** French wording of one incoherence between the capture settings. */
function adviceText(advice: CaptureAdvice): string {
    switch (advice.kind) {
        case 'depthTooHigh':
            return `Profondeur inutilement élevée pour cette résolution — ${advice.suggested} donnerait le même relief.`;
        case 'depthTooLow':
            return `Profondeur faible pour cette résolution — ${advice.suggested} exploiterait mieux les points téléchargés.`;
        case 'groundTooSparse':
            return `Densité sol trop faible pour cette profondeur — ${strideLabel(advice.suggested)} recommandé.`;
        default:
            return `Densité sol inutilement élevée — ${strideLabel(advice.suggested)} suffirait au même maillage.`;
    }
}

/**
 * Warns about the incoherences the advanced section makes reachable: a depth
 * the downloaded points cannot feed, a ground decimation that starves or
 * over-feeds the solver. Each line applies its own fix.
 */
function CaptureAdviceList() {
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const resolutionM = useMapStore((s) => s.lidarCaptureResolution);
    const depth = useMapStore((s) => s.lidarCloudPoissonDepth);
    const groundStride = useMapStore((s) => s.lidarCloudGroundStride);
    const setDepth = useMapStore((s) => s.setLidarCloudPoissonDepth);
    const setGroundStride = useMapStore((s) => s.setLidarCloudGroundStride);

    const advices = captureAdvice({
        widthM: rect.widthM, lengthM: rect.lengthM, resolutionM, depth, groundStride,
    });
    if (advices.length === 0) return null;

    const applyFix = (advice: CaptureAdvice) => {
        if (advice.kind === 'depthTooHigh' || advice.kind === 'depthTooLow') setDepth(advice.suggested);
        else setGroundStride(advice.suggested);
    };

    return (
        <ul className="space-y-1">
            {advices.map((advice) => (
                <li key={advice.kind} className="rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800">
                    {adviceText(advice)}
                    {' '}
                    <button
                        type="button"
                        onClick={() => applyFix(advice)}
                        className="font-medium underline underline-offset-2"
                    >
                        Corriger
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Capture-zone sizing, in the advanced section: two sliders set the rectangle's
 * width and length without redrawing it, keeping its centre and orientation.
 */
function CaptureZoneControls() {
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const setRect = useMapStore((s) => s.setLidarCaptureRect);

    return (
        <div className="space-y-2">
            <label className="block">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>Largeur</span>
                    <span className="font-mono text-slate-400">{Math.round(rect.widthM)} m</span>
                </div>
                <input
                    aria-label="Largeur de la zone de capture LiDAR"
                    type="range" min={0} max={SIDE_SLIDER_STEPS} step={1}
                    value={sliderFromSide(rect.widthM)}
                    onChange={(e) => setRect({ ...rect, widthM: sideFromSlider(Number(e.target.value)) })}
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
                    type="range" min={0} max={SIDE_SLIDER_STEPS} step={1}
                    value={sliderFromSide(rect.lengthM)}
                    onChange={(e) => setRect({ ...rect, lengthM: sideFromSlider(Number(e.target.value)) })}
                    className="mt-1 w-full accent-green-600"
                />
            </label>
        </div>
    );
}

/**
 * Capture resolution: the ground sampling asked of the COPC tiles, i.e. how
 * deep their octree is walked. Unlike the density sliders below, which thin an
 * already-downloaded cloud, this one divides the bytes fetched — it is what
 * makes a several-km zone loadable.
 */
function CaptureResolutionControl() {
    const rect = useMapStore((s) => s.lidarCaptureRect);
    const resolution = useMapStore((s) => s.lidarCaptureResolution);
    const setResolution = useMapStore((s) => s.setLidarCaptureResolution);
    const { points, bytes } = estimateCapture(rect.widthM, rect.lengthM, resolution);
    const overBudget = points > CAPTURE_POINT_BUDGET;

    return (
        <div className="space-y-2">
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Résolution</span>
                    <span className="font-mono text-xs text-slate-400">
                        {formatResolution(resolution)}
                    </span>
                </div>
                <input
                    aria-label="Résolution au sol de la capture LiDAR"
                    type="range" min={0} max={RESOLUTION_STOPS_M.length - 1} step={1}
                    list="lidar-resolution-stops"
                    value={resolutionToIndex(resolution)}
                    onChange={(e) => setResolution(RESOLUTION_STOPS_M[Number(e.target.value)])}
                    className="mt-1 w-full accent-green-600"
                />
                <datalist id="lidar-resolution-stops">
                    {RESOLUTION_STOPS_M.map((r, i) => (
                        <option key={r} value={i} label={formatResolution(r)} />
                    ))}
                </datalist>
            </label>
            <p className={`text-[10px] ${overBudget ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                ≈ {formatPoints(points)} points · ≈ {Math.round(bytes / 1e6)} Mo téléchargés
                {overBudget && ' — chargement long, mémoire à risque.'}
            </p>
        </div>
    );
}

/**
 * Poisson-only ground/water density slider. Drives the curvature-adaptive
 * ground decimation: flat ground is thinned so the slow PoissonRecon mesh build
 * speeds up, while relief (cliffs, overhangs, caves) keeps full density and the
 * non-ground overlay is untouched.
 */
function GroundDensityControl() {
    const groundStride = useMapStore((s) => s.lidarCloudGroundStride);
    const setGroundStride = useMapStore((s) => s.setLidarCloudGroundStride);
    return (
        <DensityControl
            label="Densité sol"
            hint="Densité adaptative préservant le relief et les détails du sol."
            value={groundStride}
            onChange={setGroundStride}
        />
    );
}

/** Surface sub-mode options for Delaunay capture. */
const SURFACE_OPTIONS = [
    { value: 'smooth', label: 'Lissé', title: 'Sol rééchantillonné sur grille régulière — débruité, sans rayures d’ombre' },
    { value: 'raw', label: 'Brut', title: 'Triangulation Delaunay directe des points sol (fidèle mais bruité)' },
] as const satisfies ReadonlyArray<{ value: 'smooth' | 'raw'; label: string; title: string }>;

function DelaunayControls() {
    const smooth = useMapStore((s) => s.lidarMeshSmooth);
    const setSmooth = useMapStore((s) => s.setLidarMeshSmooth);
    const cell = useMapStore((s) => s.lidarGridCell);
    const setCell = useMapStore((s) => s.setLidarGridCell);
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Surface</span>
                <SegmentedControl
                    value={smooth ? 'smooth' : 'raw'}
                    options={SURFACE_OPTIONS}
                    onChange={(v) => setSmooth(v === 'smooth')}
                />
            </div>
            {smooth && (
                <label className="block">
                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                        <span>Résolution</span>
                        <span className="font-mono text-xs text-slate-400">{cell.toFixed(1)} m</span>
                    </div>
                    <input
                        aria-label="Résolution de la grille du sol lissé"
                        type="range" min={0.5} max={5} step={0.5}
                        value={cell}
                        onChange={(e) => setCell(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                        Maille fine = détail &middot; maille large = plus lissé / léger.
                    </p>
                </label>
            )}
        </div>
    );
}

/** Point-cloud decimation, shared by the ground and non-ground sliders. */
function DensityControl({ label, hint, value, onChange }: Readonly<{
    label: string; hint?: string; value: number; onChange: (v: number) => void;
}>) {
    return (
        <label className="block">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span>{label}</span>
                <span className="font-mono text-xs text-slate-400">{strideLabel(value)}</span>
            </div>
            <input
                aria-label={`${label} du nuage de points`}
                type="range" min={0} max={STRIDE_STOPS.length - 1} step={1}
                list="lidar-density-stops"
                value={strideToIndex(value)}
                onChange={(e) => onChange(STRIDE_STOPS[Number(e.target.value)])}
                className="mt-1 w-full accent-green-600"
            />
            <datalist id="lidar-density-stops">
                {STRIDE_STOPS.map((s, i) => (
                    <option key={s} value={i} label={strideLabel(s)} />
                ))}
            </datalist>
            {hint && <p className="mt-1 text-[10px] text-slate-400">{hint}</p>}
        </label>
    );
}

/**
 * Everything the quality dial normally decides, plus the mode-specific solver
 * knobs. Folded away by default but kept in the same card, so opening it does
 * not lose the zone and the estimate from sight.
 */
function AdvancedSection({ mode }: Readonly<{ mode: LidarMode }>) {
    const stride = useMapStore((s) => s.lidarCloudStride);
    const setStride = useMapStore((s) => s.setLidarCloudStride);

    return (
        <details className="rounded-md ring-1 ring-gray-200 dark:ring-slate-600">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                Réglages avancés
            </summary>
            <div className="space-y-3 border-t border-gray-200 px-3 py-3 dark:border-slate-600">
                <CaptureAdviceList />
                <CaptureZoneControls />
                <CaptureResolutionControl />
                <DensityControl
                    label={mode === 'poisson' ? 'Densité non-sol' : 'Densité'}
                    hint={mode === 'poisson' ? 'Densité non-sol : végétation, bâti…' : undefined}
                    value={stride}
                    onChange={setStride}
                />
                {mode === 'poisson' && <GroundDensityControl />}
                {mode === 'delaunay' && <DelaunayControls />}
                {mode === 'poisson' && <PoissonControls />}
            </div>
        </details>
    );
}

/**
 * Capture controls brick: render mode, the drawn zone, the single quality dial,
 * an advanced disclosure holding the individual settings, the load/clear
 * actions, the status line and the loading progress bar. Reads and writes the
 * shared mapStore so the studio dock and the classic launcher stay in sync with
 * zero duplication.
 */
export function LidarCaptureControls({ showProgress = true }: Readonly<{ showProgress?: boolean }>) {
    const mode = useMapStore((s) => s.lidarMode);
    const setMode = useMapStore((s) => s.setLidarMode);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const error = useMapStore((s) => s.lidarCloudError);
    const progress = useMapStore((s) => s.lidarCloudProgress);
    const load = useMapStore((s) => s.loadLidarCloud);
    const cancelLoad = useMapStore((s) => s.cancelLidarCloudLoad);
    const clear = useMapStore((s) => s.clearAllLidarClouds);
    const hasData = shaded !== null || mesh !== null;
    const center = shaded ?? mesh;

    return (
        <div className="flex min-h-0 flex-col gap-3">
            {/* Scrollable parameters — keeps the action footer always visible */}
            <div className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto">
                {/* Mode — kept up front: it decides what every other setting means */}
                <div data-tutorial="capture-modes" className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Mode</span>
                    <SegmentedControl value={mode} options={MODE_OPTIONS} onChange={setMode} />
                </div>

                <ZoneControl />
                <QualityControl />
                <AdvancedSection mode={mode} />
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
                        {loading ? 'Chargement…' : 'Capturer'}
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
