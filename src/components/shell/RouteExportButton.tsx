import { ExportDialog } from '@/components/lidar/ExportDialog';
import { exportGpx, importGpxFile } from '@/lib/gpx';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useState } from 'react';

function DownloadIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
    );
}

/**
 * "GPX" tab of the Itinéraire export dialog: export the current route as a
 * `.gpx` file, or import an existing track. Mirrors the Studio's "Scène" tab —
 * the shared first "Image" tab handles the plain screenshot.
 */
function GpxExportTab({ onClose }: Readonly<{ onClose: () => void }>) {
    const waypoints = useRouteStore((s) => s.waypoints);
    const routeCoordinates = useRouteStore((s) => s.routeCoordinates);
    const canExport = routeCoordinates.length >= 2;

    const onImport = async () => {
        // Open the file chooser FIRST (on the raw click) so the browser's
        // transient user activation isn't consumed by the replace confirm().
        const maxWp = useRouteStore.getState().gpxImportWaypoints + 2;
        const result = await importGpxFile(maxWp);
        if (!result || result.waypoints.length === 0) return;
        const state = useRouteStore.getState();
        if (state.waypoints.length > 0 && !globalThis.confirm('L\'itinéraire actuel sera remplacé. Continuer ?')) return;
        if (result.segments) state.importRoute(result.waypoints, result.segments);
        else state.restoreWaypoints(result.waypoints);
        state.setActive(true);
        const lngs = result.waypoints.map((wp) => wp.coordinate[0]);
        const lats = result.waypoints.map((wp) => wp.coordinate[1]);
        useMapStore.getState().fitBounds([
            Math.min(...lngs), Math.min(...lats),
            Math.max(...lngs), Math.max(...lats),
        ]);
        onClose();
    };

    return (
        <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                Exportez l’itinéraire actuel en fichier <code>.gpx</code>, ou importez une trace existante.
            </p>
            <button
                type="button"
                onClick={() => exportGpx(waypoints, routeCoordinates)}
                disabled={!canExport}
                className="mt-4 w-full rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-green-500 disabled:opacity-40"
            >
                Exporter en GPX
            </button>
            <button
                type="button"
                onClick={() => { onImport(); }}
                className="mt-2 w-full rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
            >
                Importer un GPX
            </button>
            {!canExport && (
                <p className="mt-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
                    Tracez un itinéraire d’au moins deux points pour l’exporter.
                </p>
            )}
        </div>
    );
}

/**
 * Itinéraire-view export button — the counterpart to the Studio's
 * `ShowcaseExport`. Same label ("Exporter cette vue") and dialog shell in both
 * views: tab 1 is a shared `.png` screenshot, tab 2 here is GPX export/import.
 */
export function RouteExportButton() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Exporter la vue actuelle"
                className="inline-flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
            >
                <DownloadIcon className="h-4 w-4" />
                <span>Exporter cette vue</span>
            </button>

            {open && (
                <ExportDialog
                    secondTabLabel="GPX"
                    secondTab={<GpxExportTab onClose={() => setOpen(false)} />}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
