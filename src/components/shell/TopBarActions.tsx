import { FreeCameraIcon, OrbitIcon } from '@/components/icons/LidarIcons';
import { ShowcaseGallery } from '@/components/lidar/ShowcaseGallery';
import { useOrbit } from '@/components/ui/lidar/OrbitControl';
import type { AppView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type { ReactNode } from 'react';

/** Orbit auto-wiggle toggle. Works in both views (it circles the camera around
 *  the map centre, independent of any loaded LiDAR cloud). */
export function OrbitTopBarButton() {
    const { orbiting, setOrbiting } = useOrbit();
    return (
        <button
            type="button"
            data-tutorial="orbit"
            onClick={() => setOrbiting((o) => !o)}
            title="Orbite automatique (parallaxe du relief)"
            aria-label="Orbite automatique"
            aria-pressed={orbiting}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${orbiting
                ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
                : 'bg-black/5 text-slate-600 ring-black/5 hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10'}`}
        >
            <OrbitIcon className="h-4 w-4" />
            <span>Orbite</span>
        </button>
    );
}

/**
 * Studio-only "caméra libre" toggle. MapLibre normally shoves the camera back
 * out of the terrain whenever the eye dips below the surface, and it pays for it
 * with pitch + zoom rewrites on every frame — close to the ground that reads as
 * the view snapping around while you orbit. Turning it off lets the camera pass
 * through the ground so inspecting a cloud or a slope from up close stays
 * steady (and unlocks the full above-the-horizon pitch range). It also unpins
 * the camera's altitude from the terrain, which is what lets the arrow keys
 * climb a cliff face instead of panning.
 */
function FreeCameraTopBarButton() {
    const freeCamera = useMapStore((s) => s.freeCamera);
    const setFreeCamera = useMapStore((s) => s.setFreeCamera);
    return (
        <button
            type="button"
            onClick={() => setFreeCamera(!freeCamera)}
            title="Caméra libre : traverse le terrain au lieu d’être repoussée — vue stable en inspection rapprochée, et flèches ↑/↓ pour monter ou descendre (Maj : pas x5)"
            aria-label="Caméra libre"
            aria-pressed={freeCamera}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${freeCamera
                ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
                : 'bg-black/5 text-slate-600 ring-black/5 hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10'}`}
        >
            <FreeCameraIcon className="h-4 w-4" />
            <span>Cam. libre</span>
        </button>
    );
}

/** Help / tutorial button. Enabled only when an `onHelp` handler is provided
 *  (the Studio); disabled elsewhere until that view's tutorial is built. */
function HelpButton({ onClick }: Readonly<{ onClick?: () => void }>) {
    const disabled = !onClick;
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={disabled ? 'Tutoriel bientôt disponible' : 'Revoir le tutoriel'}
            aria-label="Revoir le tutoriel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/5 text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.94 6.94a1.5 1.5 0 0 1 2.56 1.06c0 .58-.34.92-.93 1.36-.66.5-1.07 1-1.07 1.89v.25a.75.75 0 0 0 1.5 0v-.16c0-.4.18-.62.74-1.04.66-.5 1.26-1.13 1.26-2.3a3 3 0 0 0-5.86-.9.75.75 0 0 0 1.43.46c.04-.13.1-.26.18-.38ZM10 15.25a.94.94 0 1 0 0-1.88.94.94 0 0 0 0 1.88Z" clipRule="evenodd" />
            </svg>
        </button>
    );
}

/**
 * Shared top-bar action group, composed identically into both views so assets
 * cross over (load a LiDAR scene from the Itinéraire view, load a route from the
 * Studio). The only per-view difference is `exportSlot` — the Studio ships the
 * full scene-export dialog, the Itinéraire a screenshot-only one — and the help
 * button, which is disabled until a given view's tutorial exists.
 *
 * `exportSlot` is a prop (not a hardcoded branch) so the lean map view never
 * bundles the Studio's scene-baking / zip export code.
 */
export function TopBarActions({ view, exportSlot, onHelp }: Readonly<{
    view: AppView;
    exportSlot: ReactNode;
    onHelp?: () => void;
}>) {
    const studio = view === 'lidar';
    return (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10">
            <OrbitTopBarButton />
            {studio && <FreeCameraTopBarButton />}
            <ShowcaseGallery />
            {exportSlot}
            <HelpButton onClick={studio ? onHelp : undefined} />
        </div>
    );
}
