import { useMapStore } from '@/stores/mapStore';
import { PhotorealControls } from './PhotorealControls';
import { ShadowControls } from './ShadowControls';
import { SunDateControl } from './SunDateControl';

/**
 * Sun lighting controls: enable directional sun lighting + the date/time
 * control. When disabled, a neutral global shading is applied. The solar
 * lat/lng come from the loaded cloud center, falling back to the map center.
 */
export function SunControls() {
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const setSunEnabled = useMapStore((s) => s.setLidarSunEnabled);
    const view = useMapStore((s) => s.view);
    const center = shaded ?? mesh;

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
                    <SunDateControl
                        centerLng={center?.centerLng ?? view.longitude}
                        centerLat={center?.centerLat ?? view.latitude}
                    />
                </fieldset>
            </div>
        </div>
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
