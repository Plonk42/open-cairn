import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
import { SegmentedControl } from '@/components/ui/common/SegmentedControl';
import type { ShaderPreset } from '@/lib/lidarBrowser/slope';
import { LAS_CLASS_LABELS } from '@/lib/lidarCloud';
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
                    <button type="button" onClick={() => setClasses([2])} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">Sol</button>
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

            {/* Texture photo (orthophoto IGN drapée sur le nuage / le mesh) */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Texture photo</span>
                    <span className="font-mono text-xs text-slate-400">{Math.round(photoOpacity * 100)}%</span>
                </div>
                <input
                    aria-label="Opacité de la texture photo (orthophoto IGN)"
                    type="range" min={0} max={1} step={0.05}
                    value={photoOpacity}
                    onChange={(e) => setPhotoOpacity(Number(e.target.value))}
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
