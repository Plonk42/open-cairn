import { ShowcaseGallery } from '@/components/lidar/ShowcaseGallery';
import { OrbitTopBarButton } from '@/components/shell/TopBarActions';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Compact "more actions" menu for the mobile top bar: a `⋯` button that opens a
 * dropdown grouping the cross-view actions (orbit toggle, the unified gallery and
 * the view's export dialog) so they don't crowd the toolbar. The gallery/export
 * children render their own modals (portalled to `document.body`), so they work
 * unchanged here. Theme-aware; dismisses on outside tap.
 */
export function MobileActionsMenu({ exportSlot }: Readonly<{ exportSlot: ReactNode }>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

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

            {open && (
                <div className="absolute right-0 top-full z-10 mt-1.5 flex w-56 flex-col items-stretch gap-1.5 rounded-xl border border-black/5 bg-white/95 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10">
                    <OrbitTopBarButton />
                    <ShowcaseGallery />
                    {exportSlot}
                </div>
            )}
        </div>
    );
}
