import { FreeCameraIcon, OrbitIcon, ViewpointIcon } from '@/components/icons/LidarIcons';
import { ShowcaseGallery } from '@/components/lidar/ShowcaseGallery';
import { PanoramaIcon, SectionDivider } from '@/components/shell/routeSections';
import { PeakLabelsToggle, SkyPathSection } from '@/components/ui/LayerSwitcher';
import { useOrbit } from '@/components/ui/lidar/OrbitControl';
import type { AppView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
            <span>Caméra libre</span>
        </button>
    );
}

/**
 * "Point de vue" / "Panorama": one button, two questions asked one after the
 * other. Off, it asks *where* — armed, the next map click plants the eye on
 * the ground there and the camera stops moving, as if standing on that spot.
 * Standing, the same button asks *what*: it renders as "Panorama" and opens a
 * popover naming the peaks in view (Itinéraire also gets the sun/moon sky
 * tracks there — see below). Two separate buttons used to sit side by side for
 * this, one of them dead until the other was pressed; a button whose label and
 * icon change with the question being asked reads as one continuous action
 * instead of two things to learn.
 *
 * Releasing the standpoint moved inside the popover ("Quitter le point de
 * vue") since a click on the button itself now opens/closes that popover.
 *
 * The Studio already exposes the sky tracks in its *Lumière* pill (same store
 * flags, gated on `sunEnabled` there rather than on standing), so duplicating
 * them here would just be two switches for one setting; the popover keeps only
 * the peak names for it.
 *
 * Exported because the mobile chrome composes it into its own menu: the mode
 * is a touch gesture like any other, not a desktop-only feature.
 */
export function ViewpointTopBarButton({ needsTerrain, studio }: Readonly<{ needsTerrain: boolean; studio: boolean }>) {
    const viewpoint = useMapStore((s) => s.viewpoint);
    const picking = useMapStore((s) => s.viewpointPicking);
    const setViewpoint = useMapStore((s) => s.setViewpoint);
    const setViewpointPicking = useMapStore((s) => s.setViewpointPicking);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const standing = viewpoint !== null;
    // The eye is planted at the DEM height under the click: no relief, no ground.
    const disabled = needsTerrain && !terrainEnabled;

    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Losing the standpoint (released from the popover, or terrain toggled off)
    // closes whatever panorama panel was open on it.
    useEffect(() => {
        if (!standing) setOpen(false);
    }, [standing]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        globalThis.addEventListener('pointerdown', onPointerDown);
        return () => globalThis.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    const onClick = () => {
        if (standing) setOpen((o) => !o);
        else setViewpointPicking(!picking);
    };

    let title = 'Point de vue : choisir où se tenir, puis tourner sur place';
    if (disabled) title = 'Activez le terrain 3D pour vous poser au sol';
    else if (picking) title = 'Cliquez sur la carte pour vous placer — recliquez ici pour annuler';
    else if (standing) title = 'Panorama : noms des sommets visibles d’ici';

    let label = 'Point de vue';
    if (picking) label = 'Choisissez…';
    else if (standing) label = 'Panorama';

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                title={title}
                aria-label={standing ? 'Panorama' : 'Point de vue au sol'}
                aria-pressed={standing || picking}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${standing || picking
                    ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
                    : 'bg-black/5 text-slate-600 ring-black/5 hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10'}`}
            >
                {standing ? <PanoramaIcon className="h-4 w-4" /> : <ViewpointIcon className="h-4 w-4" />}
                <span>{label}</span>
            </button>
            {open && standing && (
                <div className="absolute right-0 top-full z-10 mt-2 w-72 overflow-hidden rounded-xl border border-black/5 bg-white shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10">
                    <div className="scrollbar-slim max-h-[60vh] overflow-y-auto p-3 text-slate-800 dark:text-slate-100">
                        <PeakLabelsToggle />
                        {!studio && (
                            <>
                                <SectionDivider />
                                <SkyPathSection />
                            </>
                        )}
                    </div>
                    <div className="border-t border-black/5 p-2 dark:border-white/10">
                        <button
                            type="button"
                            onClick={() => setViewpoint(null)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
                        >
                            Quitter le point de vue
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Help / tutorial button. Enabled only when an `onHelp` handler is provided
 *  (the Studio); disabled elsewhere until that view's tutorial is built.
 *  `p-1.5` rather than a fixed `h-8 w-8`: the same padding formula as its
 *  text+icon siblings (`py-1.5` + a `h-4` icon) keeps this pill exactly their
 *  height instead of a pixel taller, which was the mismatch between the two
 *  top-bar groups. */
function HelpButton({ onClick }: Readonly<{ onClick?: () => void }>) {
    const disabled = !onClick;
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={disabled ? 'Tutoriel bientôt disponible' : 'Revoir le tutoriel'}
            aria-label="Revoir le tutoriel"
            className="inline-flex items-center justify-center rounded-md bg-black/5 p-1.5 text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
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
 * Studio). Split into two pill groups: camera behaviour (orbit, free camera,
 * point de vue/panorama) on one side, import/export (gallery, `exportSlot`,
 * help) on the other — the two answer different questions ("how does the
 * camera move" vs. "what do I do with this view") and grouping them says so at
 * a glance instead of leaving eight buttons in a single row.
 *
 * The only per-view difference is `exportSlot` — the Studio ships the full
 * scene-export dialog, the Itinéraire a screenshot-only one — and the help
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
        <div className="pointer-events-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10">
                <OrbitTopBarButton />
                {studio && <FreeCameraTopBarButton />}
                <ViewpointTopBarButton needsTerrain={!studio} studio={studio} />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10">
                <ShowcaseGallery />
                {exportSlot}
                <HelpButton onClick={studio ? onHelp : undefined} />
            </div>
        </div>
    );
}
