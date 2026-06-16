import { useMapStore } from '@/stores/mapStore';
import { ShadowControls } from './ShadowControls';
import { SunDateControl } from './SunDateControl';

/**
 * Lighting controls brick: sun date/time + cast-shadow toggle/intensity.
 * Reads/writes the shared mapStore. The solar lat/lng come from the loaded
 * cloud center, falling back to the current map center.
 */
export function LidarLightingControls() {
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const setSunEnabled = useMapStore((s) => s.setLidarSunEnabled);
    const shadows = useMapStore((s) => s.lidarShadows);
    const setShadows = useMapStore((s) => s.setLidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const setShadowStrength = useMapStore((s) => s.setLidarShadowStrength);
    const view = useMapStore((s) => s.view);
    const center = shaded ?? mesh;

    return (
        <div className="space-y-3">
            <label className="flex items-center justify-between">
                <span
                    className="text-sm text-slate-700 dark:text-slate-300"
                    title="Active un éclairage directionnel selon la position du soleil. Désactivé : éclairage global neutre."
                >
                    Éclairage soleil
                </span>
                <input
                    type="checkbox"
                    checked={sunEnabled}
                    onChange={(e) => setSunEnabled(e.target.checked)}
                    className="h-4 w-4 accent-green-600"
                />
            </label>
            {sunEnabled ? (
                <>
                    <SunDateControl
                        centerLng={center?.centerLng ?? view.longitude}
                        centerLat={center?.centerLat ?? view.latitude}
                    />
                    <ShadowControls
                        enabled={shadows}
                        setEnabled={setShadows}
                        strength={shadowStrength}
                        setStrength={setShadowStrength}
                    />
                </>
            ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Éclairage global neutre (ombrage doux, non directionnel).
                </p>
            )}
        </div>
    );
}
