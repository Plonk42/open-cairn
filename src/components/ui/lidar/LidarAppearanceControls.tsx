import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
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

function ShaderButton({
    preset,
    current,
    onClick,
    label,
    title,
    rounded,
}: Readonly<{
    preset: ShaderPreset;
    current: ShaderPreset;
    onClick: () => void;
    label: string;
    title: string;
    rounded: 'l' | 'r' | '';
}>) {
    const ROUND_CLS: Record<'l' | 'r' | '', string> = { l: 'rounded-l-md', r: 'rounded-r-md', '': '' };
    const activeCls = preset === current
        ? 'bg-green-600 text-white'
        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
    return (
        <button type="button" onClick={onClick} title={title} className={`${ROUND_CLS[rounded]} px-2.5 py-1 text-xs ${activeCls}`}>
            {label}
        </button>
    );
}

function ClassFilterSection() {
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

/**
 * Appearance controls brick: opacity, photo texture, basemap dimming, class
 * filter, shader preset, point size and adaptive sizing. Reads/writes the
 * shared mapStore.
 */
export function LidarAppearanceControls() {
    const mode = useMapStore((s) => s.lidarMode);
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const setOpacity = useMapStore((s) => s.setLidarCloudOpacity);
    const photoOpacity = useMapStore((s) => s.lidarCloudPhotoOpacity);
    const setPhotoOpacity = useMapStore((s) => s.setLidarCloudPhotoOpacity);
    const pointSize = useMapStore((s) => s.lidarCloudPointSize);
    const setPointSize = useMapStore((s) => s.setLidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const setSizeCompensation = useMapStore((s) => s.setLidarCloudSizeCompensation);
    const shader = useMapStore((s) => s.lidarShader);
    const setShader = useMapStore((s) => s.setLidarShader);

    return (
        <div className="space-y-3">
            {/* Opacité */}
            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Opacité</span>
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

            {/* Texture photo (orthophoto IGN drapée sur le mesh) */}
            {(mode === 'delaunay' || mode === 'poisson') && (
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
                    <p className="mt-1 text-[11px] text-slate-400">
                        Drape l'orthophoto IGN sur le maillage reconstruit.
                    </p>
                </label>
            )}

            {/* Atténuer le fond : géré par le bouton « Fond » de la barre du haut. */}

            <ClassFilterSection />

            {/* Shader */}
            <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Shader</span>
                <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
                    <ShaderButton preset="base" current={shader} onClick={() => setShader('base')} label="Base" rounded="l" title="Dégradé chaud sable / brun (style CloudCompare)" />
                    <ShaderButton preset="cliff" current={shader} onClick={() => setShader('cliff')} label="Falaise" rounded="" title="Rupture nette herbe/calcaire gris avec texture rocheuse" />
                    <ShaderButton preset="winter" current={shader} onClick={() => setShader('winter')} label="Hiver" rounded="r" title="Neige sur pentes douces/expositions nord, falaise brun rocheux" />
                </fieldset>
            </div>

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
