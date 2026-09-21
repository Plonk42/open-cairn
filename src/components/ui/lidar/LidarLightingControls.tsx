import { HIDDEN_PATH_HINT, SKY_PATH_HINT } from '@/components/ui/LayerSwitcher';
import { useMapStore } from '@/stores/mapStore';
import { PhotorealControls, TuneSlider } from './PhotorealControls';
import { ShadowControls } from './ShadowControls';
import { SunDateControl } from './SunDateControl';

/**
 * The four quantities the date/time drives, exposed directly so a lighting
 * matching no real sun can be forced. Moving the date rewrites all of them (see
 * `applyLidarSunDate`): this panel is therefore an "afterthought" on top of the
 * calendar, not a competing mode.
 */
function SunManualControls() {
    const azimuth = useMapStore((s) => s.lidarSunAzimuth);
    const setAzimuth = useMapStore((s) => s.setLidarSunAzimuth);
    const elevation = useMapStore((s) => s.lidarSunElevation);
    const setElevation = useMapStore((s) => s.setLidarSunElevation);
    const warmth = useMapStore((s) => s.lidarSunWarmth);
    const setWarmth = useMapStore((s) => s.setLidarSunWarmth);
    const intensity = useMapStore((s) => s.lidarSunIntensity);
    const setIntensity = useMapStore((s) => s.setLidarSunIntensity);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const applySunDate = useMapStore((s) => s.applyLidarSunDate);

    const deg = (v: number): string => `${Math.round(v)}°`;
    const pct = (v: number): string => `${Math.round(v * 100)} %`;

    return (
        <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                Forcer l’éclairage
            </summary>
            <div className="mt-2 flex flex-col gap-2">
                <TuneSlider
                    label="Orientation" title="Azimut de la lumière, en degrés depuis le nord dans le sens horaire (90° = est, 180° = sud)."
                    value={azimuth} min={0} max={360} step={1} format={deg} onChange={setAzimuth}
                />
                <TuneSlider
                    label="Hauteur" title="Hauteur de la lumière au-dessus de l’horizon. Négatif = sous l’horizon."
                    value={elevation} min={-10} max={90} step={1} format={deg} onChange={setElevation}
                />
                <TuneSlider
                    label="Teinte" title="0 % = orangé rasant, 100 % = blanc neutre."
                    value={warmth} min={0} max={1} step={0.01} format={pct} onChange={setWarmth}
                />
                <TuneSlider
                    label="Luminosité" title="Intensité de la lumière directe : 0 % = nuit (plus que l’ambiante), 100 % = plein jour."
                    value={intensity} min={0} max={1} step={0.01} format={pct} onChange={setIntensity}
                />
                <button
                    type="button"
                    onClick={() => applySunDate(sunDate)}
                    className="self-start rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                    Recaler sur le soleil
                </button>
            </div>
        </details>
    );
}

/**
 * Sun lighting controls: enable directional sun lighting + the date/time
 * control, plus the manual override of the four values it drives. When
 * disabled, a neutral global shading is applied.
 */
export function SunControls() {
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const setSunEnabled = useMapStore((s) => s.setLidarSunEnabled);

    return (
        <div className="flex flex-col gap-3">
            <PhotorealControls />
            <div>
                <div className="flex items-center justify-between">
                    <span
                        className="text-sm text-slate-700 dark:text-slate-300"
                        title="Active un éclairage directionnel selon la position du soleil. Désactivé : éclairage global neutre."
                    >
                        Éclairage soleil
                    </span>
                    <button
                        type="button"
                        onClick={() => setSunEnabled(!sunEnabled)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${sunEnabled ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                        role="switch"
                        aria-checked={sunEnabled}
                    >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${sunEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                </div>
                <fieldset
                    disabled={!sunEnabled}
                    className={`m-0 mt-2 min-w-0 rounded-md border border-slate-200 bg-white/50 p-2 dark:border-slate-600 dark:bg-slate-800/50 ${sunEnabled ? '' : 'opacity-50'}`}
                >
                    <SunDateControl />
                    <SkyPathToggles />
                    <SunManualControls />
                </fieldset>
            </div>
        </div>
    );
}

/**
 * Draws the day's track of one body in the sky. Lives inside the sun fieldset
 * because it tracks the same date picker; the sun's disc follows the
 * *effective* light, so a forced lighting shows up as a disc that has left its
 * track. The Itinéraire view offers the same switches in its « Point de vue »
 * button's *Panorama* popover — same store flags.
 */
function SkyPathToggle({ label, title, checked, disabled, onChange }: Readonly<{
    label: string;
    title: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (v: boolean) => void;
}>) {
    return (
        <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="h-3.5 w-3.5 flex-shrink-0 accent-green-600 disabled:opacity-40"
            />
            <span
                className="text-xs text-slate-700 dark:text-slate-300"
                title={title}
            >
                {label}
            </span>
        </label>
    );
}

function SkyPathToggles() {
    const sunPath = useMapStore((s) => s.skySunPath);
    const setSunPath = useMapStore((s) => s.setSkySunPath);
    const moonPath = useMapStore((s) => s.skyMoonPath);
    const setMoonPath = useMapStore((s) => s.setSkyMoonPath);
    const hiddenPath = useMapStore((s) => s.skyHiddenPath);
    const setHiddenPath = useMapStore((s) => s.setSkyHiddenPath);
    const trackTitle = `${SKY_PATH_HINT} Lever la caméra au-dessus de l’horizon (pitch > 90°) demande la caméra libre ou le point de vue.`;
    return (
        <>
            <SkyPathToggle label="Trajectoire du soleil" title={trackTitle} checked={sunPath} onChange={setSunPath} />
            <SkyPathToggle label="Trajectoire de la lune" title={trackTitle} checked={moonPath} onChange={setMoonPath} />
            <SkyPathToggle
                label="Portions cachées"
                title={HIDDEN_PATH_HINT}
                checked={hiddenPath}
                disabled={!sunPath && !moonPath}
                onChange={setHiddenPath}
            />
        </>
    );
}

/**
 * Cast-shadow controls wired to the shared mapStore. Available independently of
 * the sun: shadows fall from the sun direction when sun lighting is on, or from
 * the fixed neutral NW direction otherwise.
 */
export function BoundShadowControls() {
    const shadows = useMapStore((s) => s.lidarShadows);
    const setShadows = useMapStore((s) => s.setLidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const setShadowStrength = useMapStore((s) => s.setLidarShadowStrength);
    const shadowMapSize = useMapStore((s) => s.lidarShadowMapSize);
    const setShadowMapSize = useMapStore((s) => s.setLidarShadowMapSize);

    return (
        <ShadowControls
            enabled={shadows}
            setEnabled={setShadows}
            strength={shadowStrength}
            setStrength={setShadowStrength}
            resolution={shadowMapSize}
            setResolution={setShadowMapSize}
        />
    );
}
