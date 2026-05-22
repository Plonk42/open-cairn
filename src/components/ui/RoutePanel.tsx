import { ElevationChart, type DashedRange, type WaypointGraphMarker } from '@/components/ui/ElevationChart';
import { distanceMeters, formatDistance, formatElevation } from '@/lib/geo';
import { exportGpx, importGpxFile } from '@/lib/gpx';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore, type RouteMode } from '@/stores/routeStore';
import { useRef, useState } from 'react';

function segmentMode(waypointMode: RouteMode | undefined): RouteMode {
    return waypointMode ?? 'auto';
}

export function RoutePanel() {
    const [waypointsOpen, setWaypointsOpen] = useState(true);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragNodeRef = useRef<HTMLDivElement | null>(null);
    const isMobile = useIsMobile();
    const active = useRouteStore((s) => s.active);
    const uiTheme = useMapStore((s) => s.uiTheme);
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
    const selectionRange = useRouteStore((s) => s.selectionRange);
    const setHoverDistance = useRouteStore((s) => s.setHoverDistance);
    const setSelectionRange = useRouteStore((s) => s.setSelectionRange);
    const clearRoute = useRouteStore((s) => s.clearRoute);
    const removeWaypoint = useRouteStore((s) => s.removeWaypoint);
    const reorderWaypoint = useRouteStore((s) => s.reorderWaypoint);
    const setWaypointSegmentMode = useRouteStore((s) => s.setWaypointSegmentMode);
    const renameWaypoint = useRouteStore((s) => s.renameWaypoint);
    const restoreWaypoints = useRouteStore((s) => s.restoreWaypoints);
    const reverseRoute = useRouteStore((s) => s.reverseRoute);
    const routeCoordinates = useRouteStore((s) => s.routeCoordinates);
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingNameValue, setEditingNameValue] = useState('');
    const waypointMarkers: WaypointGraphMarker[] = (() => {
        const markers: WaypointGraphMarker[] = [];
        let cumulativeDistance = 0;
        for (let i = 0; i < waypoints.length; i++) {
            markers.push({ id: waypoints[i].id, label: `${i + 1}`, distance: cumulativeDistance });
            if (i < routeSegments.length) cumulativeDistance += routeSegments[i].distance;
        }
        return markers;
    })();

    const dashedRanges: DashedRange[] = (() => {
        const ranges: DashedRange[] = [];
        let cumDist = 0;
        for (const seg of routeSegments) {
            const segStart = cumDist;
            const segEnd = cumDist + seg.distance;
            if (seg.mode === 'free') {
                ranges.push({ start: segStart, end: segEnd, dash: [6, 4] });
            } else {
                if (seg.hasSnapStart && seg.coordinates.length >= 2) {
                    const snapDist = distanceMeters(seg.coordinates[0], seg.coordinates[1]);
                    ranges.push({ start: segStart, end: segStart + snapDist, dash: [3, 3] });
                }
                if (seg.hasSnapEnd && seg.coordinates.length >= 2) {
                    const snapDist = distanceMeters(seg.coordinates.at(-2)!, seg.coordinates.at(-1)!);
                    ranges.push({ start: segEnd - snapDist, end: segEnd, dash: [3, 3] });
                }
            }
            cumDist = segEnd;
        }
        return ranges;
    })();

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        if (dragNodeRef.current) {
            dragNodeRef.current.style.opacity = '0.5';
        }
    };
    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };
    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };
    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== targetIndex) {
            reorderWaypoint(waypoints[draggedIndex].id, targetIndex);
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    return (
        <div className={isMobile ? 'flex flex-col gap-3 px-1 py-1' : 'flex h-full flex-col px-3 py-2'}>
            {/* Header bar: mode toggle + stats */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Tracé on/off */}
                <button
                    type="button"
                    onClick={() => setActive(!active)}
                    className={`rounded-md px-2 py-1 text-xs ring-1 transition ${active ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700' : 'bg-gray-100 text-slate-400 ring-gray-200 hover:text-slate-600 dark:bg-slate-800 dark:ring-slate-600'}`}
                    title={active ? 'Le clic sur la carte ajoute des points' : 'Le clic sur la carte ne fait rien'}
                >
                    {active ? 'Édition' : 'Lecture'}
                </button>

                {/* Mode selector */}
                <div className="flex gap-0.5 rounded-md bg-gray-100 p-0.5 ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-600">
                    <button
                        type="button"
                        onClick={() => setMode('auto')}
                        className={`rounded px-2 py-1 text-xs transition ${mode === 'auto' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Les segments suivent les chemins existants (calcul IGN)"
                    >
                        Guidé
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('free')}
                        className={`rounded px-2 py-1 text-xs transition ${mode === 'free' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Les segments sont des lignes droites entre les points"
                    >
                        Libre
                    </button>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{formatDistance(stats.distance)}</span>
                    <span className="text-green-600">+{formatElevation(stats.ascent)}</span>
                    <span className="text-blue-500">-{formatElevation(stats.descent)}</span>
                </div>

                <div className={`ml-auto flex items-center ${isMobile ? 'gap-2' : 'gap-1.5'}`}>
                    {/* Import GPX */}
                    <button
                        type="button"
                        onClick={async () => {
                            if (waypoints.length > 0) {
                                if (!globalThis.confirm('L\'itinéraire actuel sera remplacé. Continuer ?')) return;
                            }
                            const maxWp = useRouteStore.getState().gpxImportWaypoints + 2;
                            const result = await importGpxFile(maxWp);
                            if (result && result.waypoints.length > 0) {
                                if (result.segments) {
                                    useRouteStore.getState().importRoute(result.waypoints, result.segments);
                                } else {
                                    restoreWaypoints(result.waypoints);
                                }
                                // Center map on imported waypoints
                                const coords = result.waypoints.map((wp) => wp.coordinate);
                                const lngs = coords.map((c) => c[0]);
                                const lats = coords.map((c) => c[1]);
                                useMapStore.getState().fitBounds([
                                    Math.min(...lngs), Math.min(...lats),
                                    Math.max(...lngs), Math.max(...lats),
                                ]);
                            }
                        }}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition hover:bg-sky-50 hover:text-sky-600 dark:ring-slate-600 dark:hover:bg-sky-900/30 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Importer un GPX"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
                            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                    </button>
                    {/* Export GPX */}
                    <button
                        type="button"
                        onClick={() => exportGpx(waypoints, routeCoordinates)}
                        disabled={routeCoordinates.length < 2}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition hover:bg-sky-50 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-30 dark:ring-slate-600 dark:hover:bg-sky-900/30 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Exporter en GPX"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                    </button>
                    {/* Reverse */}
                    <button
                        type="button"
                        onClick={reverseRoute}
                        disabled={waypoints.length < 2}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition hover:bg-sky-50 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-30 dark:ring-slate-600 dark:hover:bg-sky-900/30 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Inverser l'itinéraire"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M13.2 2.24a.75.75 0 00.04 1.06l2.1 1.95H6.75a.75.75 0 000 1.5h8.59l-2.1 1.95a.75.75 0 101.02 1.1l3.5-3.25a.75.75 0 000-1.1l-3.5-3.25a.75.75 0 00-1.06.04zm-6.4 8a.75.75 0 00-1.06-.04l-3.5 3.25a.75.75 0 000 1.1l3.5 3.25a.75.75 0 101.02-1.1l-2.1-1.95h8.59a.75.75 0 000-1.5H4.66l2.1-1.95a.75.75 0 00.04-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {/* Clear */}
                    <button
                        type="button"
                        onClick={clearRoute}
                        disabled={waypoints.length === 0}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:ring-slate-600 dark:hover:bg-rose-900/30 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Effacer l'itinéraire"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Status message */}
                {statusMessage && (
                    <div className={`text-xs ${status === 'error' ? 'text-rose-500' : 'text-slate-400'}`}>
                        {status === 'loading' ? 'Calcul...' : statusMessage}
                    </div>
                )}
            </div>

            {/* Content: chart + collapsible waypoints */}
            <div className={isMobile ? 'flex flex-col gap-2' : 'mt-2 flex min-h-0 flex-1'}>
                {/* Elevation chart (fills remaining space) */}
                <div className={isMobile ? 'h-40 w-full' : 'min-w-0 flex-1'}>
                    <ElevationChart
                        samples={profile}
                        waypointMarkers={waypointMarkers}
                        dashedRanges={dashedRanges}
                        colorBySlope={colorElevationBySlope}
                        hoverDistance={hoverDistance}
                        selectionRange={selectionRange}
                        onHoverDistance={setHoverDistance}
                        onSelectionChange={setSelectionRange}
                        theme={uiTheme}
                    />
                </div>

                {/* Collapsible waypoints panel (hidden on mobile - use map markers instead) */}
                {!isMobile && waypoints.length > 0 && (
                    <div className="flex flex-shrink-0">
                        {/* Toggle strip — always visible */}
                        <button
                            type="button"
                            onClick={() => setWaypointsOpen((v) => !v)}
                            className={`flex h-full w-6 flex-col items-center justify-center gap-1 bg-gray-50 text-slate-500 ring-1 ring-gray-200 transition hover:bg-gray-100 hover:text-slate-700 dark:bg-slate-800/50 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${waypointsOpen ? 'rounded-l-md' : 'rounded-md'}`}
                            title={waypointsOpen ? 'Masquer les points' : `Afficher les ${waypoints.length} points`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                            </svg>
                            <span className="text-[9px] font-bold">{waypoints.length}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-3 w-3 transition-transform ${waypointsOpen ? '' : 'rotate-180'}`}>
                                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                            </svg>
                        </button>

                        {/* Expanded list */}
                        {waypointsOpen && (
                            <div className="w-56 overflow-auto rounded-r-md bg-white ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
                                {waypoints.map((waypoint, index) => {
                                    const isDropTarget = dragOverIndex === index && draggedIndex !== index;
                                    let borderClass = '';
                                    if (isDropTarget) {
                                        borderClass = 'bg-blue-50 shadow-[inset_0_-2px_0_0_#3b82f6] dark:bg-blue-900/20 dark:shadow-[inset_0_-2px_0_0_#60a5fa]';
                                    } else if (index > 0) {
                                        borderClass = 'border-t border-gray-200 dark:border-slate-600';
                                    }
                                    const dragClass = draggedIndex === index ? 'scale-95 opacity-40' : '';
                                    return (
                                        <div
                                            key={waypoint.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDragEnd={handleDragEnd}
                                            onDrop={(e) => handleDrop(e, index)}
                                            ref={draggedIndex === index ? dragNodeRef : undefined}
                                            className={`flex items-center gap-2 px-2.5 py-2 transition-all ${borderClass} ${dragClass}`}
                                        >
                                            {/* Drag handle */}
                                            <div className="flex flex-shrink-0 cursor-grab items-center text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-500 dark:hover:text-slate-300">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path fillRule="evenodd" d="M5 3.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM5 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM5 12.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM9 3.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM9 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM9 12.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:bg-sky-500 dark:ring-slate-800">
                                                {index + 1}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                {editingNameId === waypoint.id ? (
                                                    <input
                                                        type="text"
                                                        autoFocus
                                                        value={editingNameValue}
                                                        onChange={(e) => setEditingNameValue(e.target.value)}
                                                        onBlur={() => {
                                                            renameWaypoint(waypoint.id, editingNameValue.trim());
                                                            setEditingNameId(null);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                renameWaypoint(waypoint.id, editingNameValue.trim());
                                                                setEditingNameId(null);
                                                            } else if (e.key === 'Escape') {
                                                                setEditingNameId(null);
                                                            }
                                                        }}
                                                        className="w-full rounded border border-sky-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-sky-400 dark:border-sky-600 dark:bg-slate-700 dark:text-slate-200"
                                                        placeholder={`Point ${index + 1}`}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditingNameId(waypoint.id);
                                                            setEditingNameValue(waypoint.name ?? '');
                                                        }}
                                                        className="w-full truncate text-left text-[11px] text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400"
                                                        title="Renommer ce point"
                                                    >
                                                        {waypoint.name || <span className="font-mono text-slate-400 dark:text-slate-500">{waypoint.coordinate[1].toFixed(5)}, {waypoint.coordinate[0].toFixed(5)}</span>}
                                                    </button>
                                                )}
                                            </div>
                                            {index > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setWaypointSegmentMode(waypoint.id, segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'free' : 'auto')}
                                                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-sm transition ${segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'text-[#1379d3] hover:bg-blue-50 dark:hover:bg-blue-900/30' : 'text-[#f97316] hover:bg-orange-50 dark:hover:bg-orange-900/30'}`}
                                                    title={segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'Segment guidé (cliquer pour passer en libre)' : 'Segment libre (cliquer pour passer en guidé)'}
                                                >
                                                    {segmentMode(waypoint.modeFromPrevious) === 'auto' ? '⤳' : '⟋'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removeWaypoint(waypoint.id)}
                                                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-900/30"
                                                title="Retirer"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                                </svg>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Mobile waypoints list */}
            {isMobile && waypoints.length > 0 && (
                <div className="mt-1">
                    <button
                        type="button"
                        onClick={() => setWaypointsOpen((v) => !v)}
                        className="flex w-full items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-gray-200 active:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-sky-500">
                            <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                        </svg>
                        <span>{waypoints.length} point{waypoints.length > 1 ? 's' : ''}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`ml-auto h-4 w-4 transition-transform ${waypointsOpen ? 'rotate-180' : ''}`}>
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {waypointsOpen && (
                        <div className="mt-1 max-h-52 overflow-y-auto rounded-md bg-white ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
                            {waypoints.map((waypoint, index) => (
                                <div
                                    key={waypoint.id}
                                    className={`flex items-center gap-2 px-3 py-2.5 ${index > 0 ? 'border-t border-gray-100 dark:border-slate-700' : ''}`}
                                >
                                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-[11px] font-bold text-white">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        {editingNameId === waypoint.id ? (
                                            <input
                                                type="text"
                                                autoFocus
                                                value={editingNameValue}
                                                onChange={(e) => setEditingNameValue(e.target.value)}
                                                onBlur={() => {
                                                    renameWaypoint(waypoint.id, editingNameValue.trim());
                                                    setEditingNameId(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        renameWaypoint(waypoint.id, editingNameValue.trim());
                                                        setEditingNameId(null);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingNameId(null);
                                                    }
                                                }}
                                                className="w-full rounded border border-sky-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-sky-400 dark:border-sky-600 dark:bg-slate-700 dark:text-slate-200"
                                                placeholder={`Point ${index + 1}`}
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingNameId(waypoint.id);
                                                    setEditingNameValue(waypoint.name ?? '');
                                                }}
                                                className="w-full truncate text-left text-xs text-slate-600 active:text-sky-600 dark:text-slate-300"
                                            >
                                                {waypoint.name || <span className="font-mono text-slate-400 dark:text-slate-500">{waypoint.coordinate[1].toFixed(4)}, {waypoint.coordinate[0].toFixed(4)}</span>}
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setWaypointSegmentMode(waypoint.id, segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'free' : 'auto')}
                                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-sm ring-1 ring-gray-200 dark:ring-slate-600 ${index === 0 ? 'opacity-30 pointer-events-none' : ''} ${segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'text-[#1379d3]' : 'text-[#f97316]'}`}
                                        title={segmentMode(waypoint.modeFromPrevious) === 'auto' ? 'Guidé → Libre' : 'Libre → Guidé'}
                                        disabled={index === 0}
                                    >
                                        {segmentMode(waypoint.modeFromPrevious) === 'auto' ? '⤳' : '⟋'}
                                    </button>
                                    {/* Move up */}
                                    <button
                                        type="button"
                                        onClick={() => reorderWaypoint(waypoint.id, index - 1)}
                                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-gray-200 dark:ring-slate-600 ${index === 0 ? 'opacity-30 pointer-events-none text-slate-300 dark:text-slate-600' : 'text-sky-500 active:bg-sky-50 dark:text-sky-400'}`}
                                        title="Monter"
                                        disabled={index === 0}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                            <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    {/* Move down */}
                                    <button
                                        type="button"
                                        onClick={() => reorderWaypoint(waypoint.id, index + 1)}
                                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-gray-200 dark:ring-slate-600 ${index === waypoints.length - 1 ? 'opacity-30 pointer-events-none text-slate-300 dark:text-slate-600' : 'text-sky-500 active:bg-sky-50 dark:text-sky-400'}`}
                                        title="Descendre"
                                        disabled={index === waypoints.length - 1}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeWaypoint(waypoint.id)}
                                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-rose-400 ring-1 ring-gray-200 active:bg-rose-50 active:text-rose-600 dark:text-rose-400 dark:ring-slate-600"
                                        title="Supprimer"
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
            )}
        </div>
    );
}