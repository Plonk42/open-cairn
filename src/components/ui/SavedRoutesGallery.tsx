import { GalleryIcon } from '@/components/lidar/gallery/tiles';
import { PreviewThumb } from '@/components/ui/SavedRoutesPanel';
import { formatDistance, formatElevation } from '@/lib/geo';
import {
    deleteSavedRoute,
    renameSavedRoute,
    type SavedRoute,
    useSavedRoutes,
} from '@/lib/savedRoutes';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useState } from 'react';
import { createPortal } from 'react-dom';

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

/** One tile in the gallery grid: preview thumbnail + name + stats + delete. */
function RouteTile({ route, onLoad }: Readonly<{ route: SavedRoute; onLoad: (r: SavedRoute) => void }>) {
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(route.name);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const commitRename = () => {
        const next = renameValue.trim();
        if (next) renameSavedRoute(route.id, next);
        setRenaming(false);
    };

    return (
        <div className="group relative flex flex-col overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200 transition hover:ring-green-400 dark:bg-slate-800 dark:ring-white/10 dark:hover:ring-emerald-400/60">
            <button
                type="button"
                onClick={() => onLoad(route)}
                title="Charger cet itinéraire"
                className="flex items-center justify-center p-2"
            >
                <PreviewThumb preview={route.preview} />
            </button>
            <div className="flex flex-1 flex-col px-2.5 pb-2.5">
                {renaming ? (
                    <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            else if (e.key === 'Escape') setRenaming(false);
                        }}
                        autoFocus
                        className="w-full rounded bg-white px-1.5 py-0.5 text-xs text-slate-800 ring-1 ring-green-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => onLoad(route)}
                        onDoubleClick={() => { setRenameValue(route.name); setRenaming(true); }}
                        title="Charger (clic) ou renommer (double-clic)"
                        className="truncate text-left text-xs font-semibold text-slate-700 hover:text-green-700 dark:text-slate-200 dark:hover:text-emerald-400"
                    >
                        {route.name}
                    </button>
                )}
                <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">{formatDate(route.createdAt)}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                    {formatDistance(route.stats.distance)}
                    {route.stats.ascent > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400"> ↑ {formatElevation(route.stats.ascent)}</span>
                    )}
                    {route.stats.descent > 0 && (
                        <span className="text-rose-500 dark:text-rose-400"> ↓ {formatElevation(route.stats.descent)}</span>
                    )}
                </p>
            </div>

            {confirmDelete ? (
                <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => { deleteSavedRoute(route.id); setConfirmDelete(false); }}
                        title="Confirmer la suppression"
                        className="rounded bg-rose-600 px-1.5 py-0.5 text-[10.5px] font-medium text-white transition hover:bg-rose-700"
                    >
                        OK
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        title="Annuler"
                        className="rounded bg-slate-200 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                        ✕
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    title="Supprimer"
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-white/90 text-rose-600 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-rose-50 group-hover:opacity-100 dark:bg-slate-900/90 dark:text-rose-400 dark:ring-white/10 dark:hover:bg-rose-600/20"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4z" clipRule="evenodd" />
                    </svg>
                </button>
            )}
        </div>
    );
}

/**
 * Saved-routes gallery — a modal mirroring the LiDAR `ShowcaseGallery`: a grid
 * of route tiles (preview thumbnail + name + stats) reusing `PreviewThumb` and
 * `savedRoutes.ts`. Triggered from a top-bar "Itinéraires" button (like Studio's
 * "Galerie"). Theme-aware — no `dark` wrapper, follows `uiTheme`.
 */
export function SavedRoutesGallery() {
    const [open, setOpen] = useState(false);
    const routes = useSavedRoutes();

    const importRoute = useRouteStore((s) => s.importRoute);
    const setRouteActive = useRouteStore((s) => s.setActive);
    const setLoadedRouteId = useRouteStore((s) => s.setLoadedRouteId);
    const fitBounds = useMapStore((s) => s.fitBounds);

    const handleLoad = (r: SavedRoute) => {
        importRoute(r.waypoints, r.segments);
        setLoadedRouteId(r.id);
        setRouteActive(true);
        if (r.preview.bbox?.some((v) => v !== 0)) {
            const [w, s, e, n] = r.preview.bbox;
            fitBounds([w, s, e, n], { padding: 60 });
        }
        setOpen(false);
    };

    return (
        <>
            <button
                type="button"
                data-tutorial="routes-gallery"
                onClick={() => setOpen(true)}
                title="Mes itinéraires"
                className="inline-flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
            >
                <GalleryIcon className="h-4 w-4" />
                <span>Itinéraires</span>
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mes itinéraires</h2>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                title="Fermer"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                </svg>
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {routes.length === 0 ? (
                                <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                                    Aucun itinéraire sauvegardé pour le moment.
                                </p>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    {routes.map((r) => (
                                        <RouteTile key={r.id} route={r} onLoad={handleLoad} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
