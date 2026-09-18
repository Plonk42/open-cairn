import { ShowcaseGallery } from '@/components/lidar/ShowcaseGallery';
import { OrbitTopBarButton, PeakLabelsTopBarButton, ViewpointTopBarButton } from '@/components/shell/TopBarActions';
import type { AppView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Compact "more actions" menu for the mobile top bar: a `⋯` button that opens a
 * dropdown grouping the cross-view actions (orbit toggle, viewpoint mode, the
 * unified gallery and the view's export dialog) so they don't crowd the toolbar.
 * The gallery/export children render their own modals (portalled to
 * `document.body`), so they work unchanged here. Theme-aware; dismisses on
 * outside tap.
 *
 * It is the mobile counterpart of `TopBarActions`, and the only place a mobile
 * user can reach those actions: anything added there has to be mirrored here or
 * it simply does not exist below 768 px.
 *
 * `view` is what tells the viewpoint button whether the 3D terrain is a
 * prerequisite — in the Studio the LiDAR cloud is the ground.
 *
 * IMPORTANT: the dropdown content stays MOUNTED (just visually hidden) even
 * when the menu is "closed" — see the CSS-only hide below. Conditionally
 * UNMOUNTING it (`{open && (...)}`) used to destroy `<ShowcaseGallery/>`'s own
 * state the instant its portalled modal was opened: a tap anywhere inside that
 * modal (attached to `document.body`, i.e. outside `rootRef`) tripped this
 * component's own outside-pointerdown dismiss, closing `open` and unmounting
 * the gallery — which silently closed its modal too, making it look like the
 * gallery "disappeared" on any click (reported on mobile).
 */
export function MobileActionsMenu({ view, exportSlot }: Readonly<{ view: AppView; exportSlot: ReactNode }>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const viewpointPicking = useMapStore((s) => s.viewpointPicking);

    // Arming the viewpoint mode asks for a tap on the map; on a phone the open
    // dropdown covers a good third of it, so it gets out of the way by itself.
    useEffect(() => {
        if (viewpointPicking) setOpen(false);
    }, [viewpointPicking]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        globalThis.addEventListener('pointerdown', onPointerDown);
        return () => globalThis.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                title="Plus d’actions"
                aria-label="Plus d’actions"
                aria-pressed={open}
                className={`flex h-8 w-8 items-center justify-center rounded-lg shadow-sm ring-1 backdrop-blur-md transition ${open
                    ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
                    : 'bg-white/85 text-slate-600 ring-black/5 dark:bg-slate-900/75 dark:text-slate-200 dark:ring-white/10'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                    <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 14a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
                </svg>
            </button>

            <div
                aria-hidden={!open}
                className={`absolute right-0 top-full z-10 mt-1.5 flex w-56 flex-col items-stretch gap-1.5 rounded-xl border border-black/5 bg-white/95 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10 ${open ? '' : 'invisible opacity-0'}`}
            >
                <OrbitTopBarButton />
                <ViewpointTopBarButton needsTerrain={view === 'map'} />
                <PeakLabelsTopBarButton withLabel />
                <ShowcaseGallery />
                {exportSlot}
            </div>
        </div>
    );
}
