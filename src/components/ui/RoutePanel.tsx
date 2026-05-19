import { ElevationChart, type WaypointGraphMarker } from '@/components/ui/ElevationChart';
import { formatDistance, formatElevation } from '@/lib/geo';
import { useRouteStore, type RouteMode } from '@/stores/routeStore';
import { useState } from 'react';

type RoutePanelTab = 'profile' | 'waypoints';

const TABS: Array<{ id: RoutePanelTab; label: string; icon: JSX.Element }> = [
    {
        id: 'profile', label: 'Profil', icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 15l3-4 3 2 4-6 3 3 3-2" />
            </svg>
        ),
    },
    {
        id: 'waypoints', label: 'Points', icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
            </svg>
        ),
    },
];

function segmentMode(waypointMode: RouteMode | undefined): RouteMode {
    return waypointMode ?? 'auto';
}

export function RoutePanel() {
    const [activeTab, setActiveTab] = useState<RoutePanelTab>('profile');
    const active = useRouteStore((s) => s.active);
    const setActive = useRouteStore((s) => s.setActive);
    const mode = useRouteStore((s) => s.mode);
    const setMode = useRouteStore((s) => s.setMode);
    const colorElevationBySlope = useRouteStore((s) => s.colorElevationBySlope);
    const waypoints = useRouteStore((s) => s.waypoints);
    const routeSegments = useRouteStore((s) => s.routeSegments);
    const profile = useRouteStore((s) => s.profile);
    const stats = useRouteStore((s) => s.stats);
    const status = useRouteStore((s) => s.status);
    const statusMessage = useRouteStore((s) => s.statusMessage);
    const hoverDistance = useRouteStore((s) => s.hoverDistance);
    const setHoverDistance = useRouteStore((s) => s.setHoverDistance);
    const setSelectionRange = useRouteStore((s) => s.setSelectionRange);
    const clearRoute = useRouteStore((s) => s.clearRoute);
    const removeWaypoint = useRouteStore((s) => s.removeWaypoint);
    const reorderWaypoint = useRouteStore((s) => s.reorderWaypoint);
    const setWaypointSegmentMode = useRouteStore((s) => s.setWaypointSegmentMode);
    const waypointMarkers: WaypointGraphMarker[] = waypoints.map((waypoint, index) => ({
        id: waypoint.id,
        label: `${index + 1}`,
        distance: routeSegments.slice(0, index).reduce((total, segment) => total + segment.distance, 0),
    }));

    return (
        <div className="flex h-full flex-col px-3 py-2">
            {/* Header bar: mode toggle + stats + tabs */}
            <div className="flex items-center gap-2">
                {/* Tracé on/off */}
                <button
                    type="button"
                    onClick={() => setActive(!active)}
                    className={`rounded-md px-2 py-1 text-xs ring-1 transition ${active ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40' : 'bg-slate-800/40 text-slate-400 ring-white/5 hover:text-slate-200'}`}
                >
                    {active ? 'Tracé actif' : 'Tracé inactif'}
                </button>

                {/* Mode selector */}
                <div className="flex gap-0.5 rounded-md bg-slate-950/50 p-0.5 ring-1 ring-white/10">
                    <button
                        type="button"
                        onClick={() => setMode('auto')}
                        className={`rounded px-2 py-1 text-xs transition ${mode === 'auto' ? 'bg-slate-700/80 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                        title="Les segments suivent les chemins existants (calcul IGN)"
                    >
                        Guidé
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('free')}
                        className={`rounded px-2 py-1 text-xs transition ${mode === 'free' ? 'bg-slate-700/80 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                        title="Les segments sont des lignes droites entre les points"
                    >
                        Libre
                    </button>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-2.5 text-xs text-slate-300">
                    <span className="font-semibold text-slate-100">{formatDistance(stats.distance)}</span>
                    <span className="text-emerald-300">+{formatElevation(stats.ascent)}</span>
                    <span className="text-sky-300">-{formatElevation(stats.descent)}</span>
                </div>

                {/* Clear */}
                <button
                    type="button"
                    onClick={clearRoute}
                    disabled={waypoints.length === 0}
                    className="ml-1 rounded-md px-2 py-1 text-xs text-slate-400 ring-1 ring-white/5 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                    title="Effacer l'itinéraire"
                >
                    Effacer
                </button>

                {/* Tabs */}
                <div className="ml-auto flex gap-0.5 rounded-md bg-slate-950/50 p-0.5 ring-1 ring-white/10">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition ${activeTab === tab.id ? 'bg-slate-700/80 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                            title={tab.label}
                        >
                            {tab.icon}
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Status message */}
                {statusMessage && (
                    <div className={`text-xs ${status === 'error' ? 'text-amber-300' : 'text-slate-500'}`}>
                        {status === 'loading' ? 'Calcul...' : statusMessage}
                    </div>
                )}
            </div>

            {/* Tab content */}
            <div className="mt-2 min-h-0 min-w-0 flex-1">
                {activeTab === 'profile' && (
                    <ElevationChart
                        samples={profile}
                        waypointMarkers={waypointMarkers}
                        colorBySlope={colorElevationBySlope}
                        hoverDistance={hoverDistance}
                        onHoverDistance={setHoverDistance}
                        onSelectionChange={setSelectionRange}
                    />
                )}

                {activeTab === 'waypoints' && (
                    <div className="max-h-48 overflow-auto rounded-md bg-slate-950/50 ring-1 ring-white/10">
                        {waypoints.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-slate-500">
                                Cliquez sur la carte pour ajouter des points
                            </div>
                        ) : waypoints.map((waypoint, index) => (
                            <div key={waypoint.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 odd:bg-white/[0.03]">
                                {/* Reorder buttons */}
                                <div className="flex flex-shrink-0 flex-col">
                                    <button
                                        type="button"
                                        disabled={index === 0}
                                        onClick={() => reorderWaypoint(waypoint.id, index - 1)}
                                        className="text-slate-500 transition hover:text-slate-200 disabled:opacity-20"
                                        title="Monter"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                            <path fillRule="evenodd" d="M8 3.5a.5.5 0 01.354.146l4 4a.5.5 0 01-.708.708L8 4.707 4.354 8.354a.5.5 0 01-.708-.708l4-4A.5.5 0 018 3.5z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={index === waypoints.length - 1}
                                        onClick={() => reorderWaypoint(waypoint.id, index + 1)}
                                        className="text-slate-500 transition hover:text-slate-200 disabled:opacity-20"
                                        title="Descendre"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                            <path fillRule="evenodd" d="M8 12.5a.5.5 0 01-.354-.146l-4-4a.5.5 0 01.708-.708L8 11.293l3.646-3.647a.5.5 0 01.708.708l-4 4A.5.5 0 018 12.5z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200 ring-1 ring-sky-400/40">
                                    {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-mono text-[11px] text-slate-400">
                                        {waypoint.coordinate[1].toFixed(5)}, {waypoint.coordinate[0].toFixed(5)}
                                    </div>
                                    {index > 0 && (
                                        <div className="mt-1 inline-grid grid-cols-2 overflow-hidden rounded ring-1 ring-white/10">
                                            <button
                                                type="button"
                                                onClick={() => setWaypointSegmentMode(waypoint.id, 'auto')}
                                                className={`px-1.5 py-0.5 text-[10px] transition ${segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'bg-sky-500/25 text-sky-100' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'}`}
                                            >
                                                Guidé
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setWaypointSegmentMode(waypoint.id, 'free')}
                                                className={`px-1.5 py-0.5 text-[10px] transition ${segmentMode(waypoint.modeFromPrevious) === 'free' ? 'bg-sky-500/25 text-sky-100' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'}`}
                                            >
                                                Libre
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeWaypoint(waypoint.id)}
                                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                                    title="Retirer"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}


            </div>
        </div>
    );
}