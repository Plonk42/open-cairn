/** Cast-shadow toggle + intensity slider for the LiDAR mesh. */
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
