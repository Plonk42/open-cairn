import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { RouteIcon } from '@/components/shell/routeSections';
import { formatDistance, formatElevation } from '@/lib/geo';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useState } from 'react';

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 280;
const maxHeight = () => globalThis.innerHeight * 0.6;

// Track the waypoint-count transition at MODULE scope (not component state or
// refs) so it survives `RouteDock` unmounting when the user switches to the
// LiDAR Studio and back — otherwise a plain useRef resets on remount and
// wrongly re-detects a "0 → N" transition that already happened earlier in the
// session, forcing the dock back open even after the user closed it.
let prevRouteWaypointCount = 0;

function ChevronIcon({ up }: Readonly<{ up: boolean }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${up ? 'rotate-180' : ''}`}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
    );
}

/**
 * Route + elevation profile **dock**.
 *
 * Unlike the previous floating card, this panel is docked *below* the map in
 * the shell's flex column: it shrinks the map instead of covering it, so the
 * terrain under the route always stays visible. Three explicit states:
 *
 * - closed   — no dock, the map takes the full height (`bottomOpen === false`)
 * - réduit   — a ~40 px summary bar with the route stats (`bottomCollapsed`)
 * - déployé  — summary bar + the resizable profile/edition panel
 *
 * The title bar carries the affordances the floating card was missing: a
 * chevron to collapse and an explicit ✕ to close.
 */
export function RouteDock() {
    const bottomOpen = useMapStore((s) => s.bottomOpen);
    const setBottomOpen = useMapStore((s) => s.setBottomOpen);
    const collapsed = useMapStore((s) => s.bottomCollapsed);
    const setCollapsed = useMapStore((s) => s.setBottomCollapsed);
    const stats = useRouteStore((s) => s.stats);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);

    // Auto-open (and un-collapse) the dock when the first waypoint is dropped.
    const waypointCount = useRouteStore((s) => s.waypoints.length);
    useEffect(() => {
        if (waypointCount > 0 && prevRouteWaypointCount === 0) {
            setBottomOpen(true);
            setCollapsed(false);
        }
        prevRouteWaypointCount = waypointCount;
    }, [waypointCount, setBottomOpen, setCollapsed]);

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

    if (!bottomOpen) return null;

    return (
        <section
            aria-label="Itinéraire et profil altimétrique"
            className="relative z-30 flex shrink-0 flex-col border-t border-gray-200 bg-white text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
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

            {/* Title bar — always visible, carries the collapse/close affordances. */}
            <div className={`flex shrink-0 items-center gap-2 px-3 ${collapsed ? 'h-10' : 'h-8'}`}>
                <button
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-2 text-left transition hover:opacity-80"
                    title={collapsed ? 'Déplier le profil altimétrique' : 'Réduire en barre de résumé'}
                    aria-expanded={!collapsed}
                >
                    <RouteIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="shrink-0 text-xs font-semibold">Itinéraire</span>
                    {collapsed && (
                        <span className="flex items-center gap-2.5 truncate text-xs text-slate-500">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{formatDistance(stats.distance)}</span>
                            <span className="text-green-600">+{formatElevation(stats.ascent)}</span>
                            <span className="text-blue-500">-{formatElevation(stats.descent)}</span>
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-gray-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    title={collapsed ? 'Déplier le profil altimétrique' : 'Réduire en barre de résumé'}
                >
                    <ChevronIcon up={collapsed} />
                </button>
                <button
                    type="button"
                    onClick={() => setBottomOpen(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                    title="Fermer le panneau (l'itinéraire est conservé)"
                >
                    <CloseIcon />
                </button>
            </div>

            {!collapsed && (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <BottomPanelContent />
                </div>
            )}
        </section>
    );
}
