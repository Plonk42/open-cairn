/** Tailles de shadow map proposées (côté en texels, carte carrée). */
const SHADOW_SIZES = [1024, 2048, 4096] as const;
const SHADOW_SIZE_LABELS: Record<number, string> = { 1024: 'Basse', 2048: 'Moyenne', 4096: 'Haute' };

/** Cast-shadow intensity slider for the LiDAR mesh (0% = disabled). */
export function ShadowControls({
    enabled,
    setEnabled,
    strength,
    setStrength,
    resolution,
    setResolution,
}: Readonly<{
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    strength: number;
    setStrength: (v: number) => void;
    resolution: number;
    setResolution: (v: number) => void;
}>) {
    const value = enabled ? strength : 0;
    const handleChange = (v: number) => {
        if (v <= 0) {
            setEnabled(false);
        } else {
            if (!enabled) setEnabled(true);
            setStrength(v);
        }
    };
    return (
        <div className="m-0 block min-w-0">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span title="Le maillage projette des ombres en fonction de la position du soleil. 0% = désactivé">
                    Ombres portées
                </span>
                <span className="font-mono text-xs text-slate-400">{value <= 0 ? 'off' : `${Math.round(value * 100)}%`}</span>
            </div>
            <input
                aria-label="Intensité des ombres portées (0% = désactivé)"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={value}
                onChange={(e) => handleChange(Number(e.target.value))}
                className="mt-1 w-full accent-green-600"
            />

            {/* Résolution de la shadow map. La carte couvre toute l'emprise du
                nuage : à 1024 un texel vaut ~25 cm sur une capture de 250 m, et
                les ombres de contact au pied des ressauts se noient. */}
            <div className="mt-3 flex items-center justify-between gap-2">
                <span
                    className="text-sm text-slate-700 dark:text-slate-300"
                    title="Finesse de la carte d'ombre. Plus haut = ombres de contact nettes au pied des ressauts et des blocs, au prix de mémoire vidéo et d'un recalcul plus long à chaque changement de soleil."
                >
                    Finesse
                </span>
                <fieldset className="m-0 flex min-w-0 overflow-hidden rounded-md border border-slate-300 p-0 dark:border-slate-600">
                    <legend className="sr-only">Finesse de la carte d&apos;ombre</legend>
                    {SHADOW_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            aria-pressed={resolution === size}
                            onClick={() => setResolution(size)}
                            className={`px-2 py-0.5 text-xs ${resolution === size
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                        >
                            {SHADOW_SIZE_LABELS[size]}
                        </button>
                    ))}
                </fieldset>
            </div>
        </div>
    );
}
