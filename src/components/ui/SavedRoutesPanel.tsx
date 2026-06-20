import { formatDistance, formatElevation, type LngLatTuple } from '@/lib/geo';
import {
    deleteSavedRoute,
    renameSavedRoute,
    type SavedRoute,
    type SavedRoutePreview,
    useSavedRoutes,
} from '@/lib/savedRoutes';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useId, useState } from 'react';

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' })
            + ' · '
            + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

function buildSparkline(
    elevations: number[],
    x0: number, y0: number, w: number, h: number,
): { line: string; area: string } {
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const span = Math.max(max - min, 1);
    const n = elevations.length;
    let line = '';
    elevations.forEach((z, i) => {
        const x = x0 + (n === 1 ? 0 : (i * w) / (n - 1));
        const y = y0 + h - ((z - min) / span) * h;
        line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    });
    const area = `${line}L${(x0 + w).toFixed(1)},${(y0 + h).toFixed(1)} L${x0.toFixed(1)},${(y0 + h).toFixed(1)} Z`;
    return { line, area };
}

function PreviewThumb({ preview }: Readonly<{ preview: SavedRoutePreview }>) {
    const { coords, bbox, elevations, summit } = preview;
    const gradientId = useId();
    const W = 120, MAP_H = 56, GAP = 4, SPARK_H = 20, P = 6;
    const H = MAP_H + GAP + SPARK_H;

    if (coords.length < 2 || !elevations) {
        return <div className="h-[80px] w-[120px] flex-shrink-0 rounded bg-slate-100 dark:bg-slate-800" />;
    }
    const [w, s, e, n] = bbox;
    const dx = Math.max(e - w, 1e-6);
    const dy = Math.max(n - s, 1e-6);
    const scale = Math.min((W - 2 * P) / dx, (MAP_H - 2 * P) / dy);
    const offX = (W - dx * scale) / 2;
    const offY = (MAP_H - dy * scale) / 2;
    const project = ([lng, lat]: LngLatTuple): [number, number] => [
        offX + (lng - w) * scale,
        MAP_H - (offY + (lat - s) * scale),
    ];
    let d = '';
    coords.forEach((c, i) => {
        const [x, y] = project(c);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    });
    const startPt = project(coords[0]);
    const endPt = project(coords.at(-1) ?? coords[0]);
    const isLoop = Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]) < 4;

    const spark = buildSparkline(elevations, 0, MAP_H + GAP, W, SPARK_H);

    let summitPt: [number, number] | null = null;
    if (summit) {
        const [sx, sy] = project(summit);
        const farFromStart = Math.hypot(sx - startPt[0], sy - startPt[1]) > 5;
        const farFromEnd = Math.hypot(sx - endPt[0], sy - endPt[1]) > 5;
        if (farFromStart && farFromEnd) summitPt = [sx, sy];
    }

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-[80px] w-[120px] flex-shrink-0 rounded bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#059669" stopOpacity="0.35" />
                </linearGradient>
            </defs>
            <line x1={0} y1={MAP_H + GAP / 2} x2={W} y2={MAP_H + GAP / 2} stroke="#e2e8f0" strokeWidth={0.6} className="dark:[stroke:#334155]" />
            <path d={d} fill="none" stroke="white" strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
            <path d={d} fill="none" stroke="#1379d3" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            {summitPt && (
                <polygon
                    points={`${summitPt[0]},${summitPt[1] - 3.6} ${summitPt[0] - 3.2},${summitPt[1] + 2.4} ${summitPt[0] + 3.2},${summitPt[1] + 2.4}`}
                    fill="#0f172a"
                    stroke="white"
                    strokeWidth={0.9}
                    strokeLinejoin="round"
                />
            )}
            {isLoop ? (
                <circle cx={startPt[0]} cy={startPt[1]} r={2.6} fill="#16a34a" stroke="white" strokeWidth={1} />
            ) : (
                <>
                    <circle cx={startPt[0]} cy={startPt[1]} r={2.6} fill="#16a34a" stroke="white" strokeWidth={1} />
                    <circle cx={endPt[0]} cy={endPt[1]} r={2.6} fill="#dc2626" stroke="white" strokeWidth={1} />
                </>
            )}
            <path d={spark.area} fill={`url(#${gradientId})`} />
            <path d={spark.line} fill="none" stroke="#047857" strokeWidth={0.9} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

export function SavedRoutesPanel() {
    const routes = useSavedRoutes();
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
    };

    const startRename = (r: SavedRoute) => {
        setRenaming(r.id);
        setRenameValue(r.name);
    };
    const commitRename = (id: string) => {
        const next = renameValue.trim();
        if (next) renameSavedRoute(id, next);
        setRenaming(null);
    };

    return (
        <div className="space-y-4">
            {routes.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aucun itinéraire sauvegardé pour le moment.
                </p>
            ) : (
                <ul className="space-y-2">
                    {routes.map((r) => {
                        const isRenaming = renaming === r.id;
                        const isConfirming = confirmDelete === r.id;
                        return (
                            <li
                                key={r.id}
                                className="rounded-lg bg-gray-50 p-2 ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700"
                            >
                                <div className="flex gap-2.5">
                                    <button
                                        type="button"
                                        onClick={() => handleLoad(r)}
                                        title="Charger cet itinéraire"
                                        className="flex-shrink-0 cursor-pointer rounded transition hover:opacity-80"
                                    >
                                        <PreviewThumb preview={r.preview} />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        {isRenaming ? (
                                            <input
                                                type="text"
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onBlur={() => commitRename(r.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') commitRename(r.id);
                                                    else if (e.key === 'Escape') setRenaming(null);
                                                }}
                                                autoFocus
                                                className="w-full rounded bg-white px-1.5 py-0.5 text-xs text-slate-800 ring-1 ring-green-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onDoubleClick={() => startRename(r)}
                                                onClick={() => handleLoad(r)}
                                                title="Charger (clic) ou renommer (double-clic)"
                                                className="block w-full cursor-pointer truncate text-left text-xs font-semibold text-slate-700 hover:text-green-700 dark:text-slate-200 dark:hover:text-emerald-400"
                                            >
                                                {r.name}
                                            </button>
                                        )}
                                        <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                                            {formatDate(r.createdAt)}
                                        </p>
                                        <p className="mt-1 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                                            {formatDistance(r.stats.distance)}
                                            {r.stats.ascent > 0 && (
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    {' '}↑ {formatElevation(r.stats.ascent)}
                                                </span>
                                            )}
                                            {r.stats.descent > 0 && (
                                                <span className="text-rose-500 dark:text-rose-400">
                                                    {' '}↓ {formatElevation(r.stats.descent)}
                                                </span>
                                            )}
                                        </p>
                                        <div className="mt-1.5 flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => handleLoad(r)}
                                                title="Charger cet itinéraire"
                                                className="flex h-6 w-6 items-center justify-center rounded bg-green-600/10 text-green-700 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => startRename(r)}
                                                title="Renommer"
                                                className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                                </svg>
                                            </button>
                                            {isConfirming ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => { deleteSavedRoute(r.id); setConfirmDelete(null); }}
                                                        title="Confirmer la suppression"
                                                        className="ml-auto flex h-6 items-center gap-1 rounded bg-rose-600 px-1.5 text-[10.5px] font-medium text-white transition hover:bg-rose-700"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                        </svg>
                                                        OK
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDelete(null)}
                                                        title="Annuler"
                                                        className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                                        </svg>
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDelete(r.id)}
                                                    title="Supprimer"
                                                    className="ml-auto flex h-6 w-6 items-center justify-center rounded bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
