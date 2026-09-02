import { useMapStore } from '@/stores/mapStore';
import type { ReactElement } from 'react';

/** One labelled 0..n slider with a formatted read-out, matching ShadowControls. */
function TuneSlider({
    label, title, value, min, max, step, format, onChange,
}: Readonly<{
    label: string;
    title: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}>): ReactElement {
    return (
        <div className="m-0 block min-w-0">
            <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                <span title={title}>{label}</span>
                <span className="font-mono text-xs text-slate-400">{format(value)}</span>
            </div>
            <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="mt-1 w-full accent-green-600"
            />
        </div>
    );
}

/**
 * Controls for the photorealistic render path (linear-space lighting,
 * hemispheric sky/ground ambient, aerial perspective, filmic tone mapping).
 *
 * The master toggle is deliberately kept: switching it off restores the exact
 * historical shading, which makes it trivial to A/B the two models on the same
 * cloud while tuning the render.
 */
export function PhotorealControls(): ReactElement {
    const enabled = useMapStore((s) => s.lidarPhotoreal);
    const setEnabled = useMapStore((s) => s.setLidarPhotoreal);
    const exposure = useMapStore((s) => s.lidarExposure);
    const setExposure = useMapStore((s) => s.setLidarExposure);
    const ambient = useMapStore((s) => s.lidarAmbient);
    const setAmbient = useMapStore((s) => s.setLidarAmbient);
    const sunStrength = useMapStore((s) => s.lidarSunStrength);
    const setSunStrength = useMapStore((s) => s.setLidarSunStrength);
    const haze = useMapStore((s) => s.lidarHaze);
    const setHaze = useMapStore((s) => s.setLidarHaze);

    const stops = (v: number): string => `${v.toFixed(2)}×`;

    return (
        <div>
            <div className="flex items-center justify-between">
                <span
                    className="text-sm text-slate-700 dark:text-slate-300"
                    title="Éclairage en radiance linéaire, ambiante ciel/sol hémisphérique, perspective aérienne et tone mapping filmique. Désactivé : ancien modèle sRGB à ambiante constante."
                >
                    Rendu photoréaliste
                </span>
                <button
                    type="button"
                    onClick={() => setEnabled(!enabled)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${enabled ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                    role="switch"
                    aria-checked={enabled}
                >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
            </div>
            <fieldset
                disabled={!enabled}
                className={`m-0 mt-2 flex min-w-0 flex-col gap-2 rounded-md border border-slate-200 bg-white/50 p-2 dark:border-slate-600 dark:bg-slate-800/50 ${enabled ? '' : 'opacity-50'}`}
            >
                <TuneSlider
                    label="Exposition"
                    title="Multiplie la radiance avant la courbe filmique : monte les hautes lumières sans les écrêter."
                    value={exposure} min={0.3} max={3} step={0.05}
                    format={stops} onChange={setExposure}
                />
                <TuneSlider
                    label="Lumière du ciel"
                    title="Intensité de l'ambiante hémisphérique. C'est elle qui teinte les ombres en bleu sur la neige."
                    value={ambient} min={0} max={2.5} step={0.05}
                    format={stops} onChange={setAmbient}
                />
                <TuneSlider
                    label="Soleil"
                    title="Intensité de la lumière directe. Un rapport soleil/ciel élevé donne le contraste franc des photos de montagne."
                    value={sunStrength} min={0} max={2.5} step={0.05}
                    format={stops} onChange={setSunStrength}
                />
                <TuneSlider
                    label="Brume"
                    title="Perspective aérienne : les reliefs lointains se fondent progressivement dans la couleur du ciel."
                    value={haze} min={0} max={1} step={0.02}
                    format={(v) => (v <= 0 ? 'off' : `${Math.round(v * 100)}%`)}
                    onChange={setHaze}
                />
            </fieldset>
        </div>
    );
}
