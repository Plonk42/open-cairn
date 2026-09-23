import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { RouteProgressLine } from '@/components/shell/RouteProgressLine';
import { RouteIcon } from '@/components/shell/routeSections';
import {
    RouteActions,
    RouteEditToggle,
    RouteModeToggle,
    RouteStats,
    RouteStatus,
} from '@/components/ui/RoutePanel';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useState } from 'react';

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 280;

/** Height of the reduced dock laid over the bottom of the map: 40 px bar + 1 px top border. */
export const REDUCED_DOCK_HEIGHT_PX = 41;
const maxHeight = () => globalThis.innerHeight * 0.6;

// Track the waypoint-count transition at MODULE scope (not component state or
// refs) so it survives `RouteDock` unmounting when the user switches to the
// LiDAR Studio and back — otherwise a plain useRef resets on remount and
// wrongly re-detects a "0 → N" transition that already happened earlier in the
// session, unfolding the dock again after the user reduced it.
let prevRouteWaypointCount = 0;

function ChevronIcon({ up }: Readonly<{ up: boolean }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${up ? 'rotate-180' : ''}`}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
    );
}

/**
 * Route + elevation profile **dock**. Always present, in one of two states:
 *
 * - réduit   — a 40 px bar laid over the bottom of the map (the map keeps
 *              its full height, as in the Studio): route stats, status,
 *              progress line and the whole route toolbar (`bottomCollapsed`)
 * - déployé  — docked *below* the map in the shell's flex column, shrinking it
 *              so the terrain under the route stays visible: the same bar
 *              (progress line aside) + the resizable chart and waypoints
 *
 * The toolbar sits in the bar in both states so no button moves when the dock
 * folds. There is no closing it: reduced, it costs 40 px and keeps the one
 * switch that decides what a click on the map does within reach.
 */
export function RouteDock() {
    const collapsed = useMapStore((s) => s.bottomCollapsed);
    const setCollapsed = useMapStore((s) => s.setBottomCollapsed);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);

    // Unfold the dock when the first waypoint is dropped.
    const waypointCount = useRouteStore((s) => s.waypoints.length);
    useEffect(() => {
        if (waypointCount > 0 && prevRouteWaypointCount === 0) setCollapsed(false);
        prevRouteWaypointCount = waypointCount;
    }, [waypointCount, setCollapsed]);

    const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const startHeight = height;

        const onMove = (ev: MouseEvent | TouchEvent) => {
            const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
            setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight(), startHeight + startY - clientY)));
        };
        const onEnd = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('touchend', onEnd);
    }, [height]);

    return (
        <section
            aria-label="Itinéraire et profil altimétrique"
            className={`z-30 flex flex-col border-t border-gray-200 bg-white text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 ${collapsed
                // Laid over the map rather than shrinking it, so the map keeps
                // the Studio's size and does not jump on a view switch.
                ? 'absolute inset-x-0 bottom-0'
                : 'relative shrink-0'}`}
            style={collapsed ? undefined : { height: `${height}px` }}
        >
            {/* Drag-to-resize strip — only meaningful while expanded. */}
            {!collapsed && (
                <button
                    type="button"
                    onMouseDown={handleResizeStart}
                    onTouchStart={handleResizeStart}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') setHeight((h) => Math.min(maxHeight(), h + 20));
                        if (e.key === 'ArrowDown') setHeight((h) => Math.max(MIN_HEIGHT, h - 20));
                    }}
                    className="group flex h-2 shrink-0 cursor-ns-resize items-center justify-center"
                    aria-label="Redimensionner le panneau"
                >
                    <span className="h-0.5 w-10 rounded-full bg-slate-300 opacity-60 transition group-hover:opacity-100 dark:bg-slate-600" />
                </button>
            )}

            {/* Title bar — always visible, carries the collapse affordance. */}
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
                <button
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-2 text-left transition hover:opacity-80"
                    title={collapsed ? 'Déplier le profil altimétrique' : 'Réduire en barre de résumé'}
                    aria-expanded={!collapsed}
                >
                    <RouteIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="shrink-0 text-xs font-semibold">Itinéraire</span>
                    <RouteStats />
                </button>
                <div className="min-w-0 max-w-xs truncate">
                    <RouteStatus />
                </div>
                {collapsed && <RouteProgressLine />}
                {/* The whole toolbar stays put across both states; pinned right
                    even when there is no route, hence no progress line to push it. */}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <RouteEditToggle compact={collapsed} />
                    <RouteModeToggle compact={collapsed} />
                    <RouteActions touch={false} />
                    <button
                        type="button"
                        onClick={() => setCollapsed(!collapsed)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-gray-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        title={collapsed ? 'Déplier le profil altimétrique' : 'Réduire en barre de résumé'}
                    >
                        <ChevronIcon up={collapsed} />
                    </button>
                </div>
            </div>

            {!collapsed && (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <BottomPanelContent />
                </div>
            )}
        </section>
    );
}
