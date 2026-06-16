import { useMapStore } from '@/stores/mapStore';
import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// OrbitControl — wiggles the camera in a small circle within its own view plane
// while keeping it aimed at the fixed map center ("wiggle stereo" parallax).
// A bearing oscillation moves the viewpoint left/right on screen; a pitch
// oscillation moves it up/down; 90° out of phase they trace a small circle in
// the camera plane. Center stays locked so near features sweep more than far
// ones → depth pops. Manual drag/zoom stops it; the start view is restored.
// ───────────────────────────────────────────────────────────────────────
export function OrbitControl() {
    const [orbiting, setOrbiting] = useState(false);

    useEffect(() => {
        if (!orbiting) return;
        const map = useMapStore.getState().mapInstance;
        if (!map) {
            setOrbiting(false);
            return;
        }
        const PERIOD_MS = 8000;          // one loop every 8 s
        const BEARING_AMP = 12;           // ° left/right wobble (screen X)
        const PITCH_AMP = 5;             // ° up/down wobble (screen Y)
        const center = map.getCenter();
        const baseBearing = map.getBearing();
        const basePitch = map.getPitch();
        const maxPitch = map.getMaxPitch();
        const minPitch = map.getMinPitch();

        let raf = 0;
        let stopped = false;
        const start = performance.now();
        const tick = (now: number) => {
            if (stopped) return;
            const a = ((now - start) / PERIOD_MS) * Math.PI * 2;
            const pitch = Math.max(
                minPitch,
                Math.min(maxPitch, basePitch + Math.sin(a) * PITCH_AMP),
            );
            // Bearing rotates and pitch tilts around the (fixed) center, so the
            // look-at point stays put while the camera circles in its own plane.
            map.setBearing(baseBearing + Math.cos(a) * BEARING_AMP);
            map.setPitch(pitch);
            map.setCenter(center);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        const stop = () => setOrbiting(false);
        map.on('dragstart', stop);
        map.on('zoomstart', stop);

        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
            map.off('dragstart', stop);
            map.off('zoomstart', stop);
            // Restore the starting view so the wiggle leaves no drift.
            map.setBearing(baseBearing);
            map.setPitch(basePitch);
            map.setCenter(center);
        };
    }, [orbiting]);

    return (
        <div className="flex items-center justify-between">
            <span
                className="text-sm text-slate-700 dark:text-slate-300"
                title="Fait pivoter la caméra autour du centre fixe de la vue pour révéler le relief 3D (parallaxe)"
            >
                Orbite auto
            </span>
            <button
                type="button"
                onClick={() => setOrbiting((o) => !o)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${orbiting ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                role="switch"
                aria-checked={orbiting}
                aria-label="Orbite automatique autour du LiDAR"
            >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${orbiting ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
        </div>
    );
}
