/** Cast-shadow intensity slider for the LiDAR mesh (0% = disabled). */
export function ShadowControls({
    enabled,
    setEnabled,
    strength,
    setStrength,
}: Readonly<{
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    strength: number;
    setStrength: (v: number) => void;
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
        </div>
    );
}
