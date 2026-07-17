import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { BottomBar, BottomBarButton, BottomBarPill } from '@/components/shell/BottomBar';
import { ROUTE_SETTING_SECTIONS, RouteIcon } from '@/components/shell/routeSections';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useRef, useState } from 'react';

type Popover = string | null;

// Track the waypoint-count transition at MODULE scope (not component state/refs)
// so it survives `RouteBottomBar` unmounting when the user switches to the
// LiDAR Studio and back — otherwise a plain useRef resets on remount and
// wrongly re-detects a "0 → N" transition that already happened earlier in the
// session, forcing the panel back open even after the user explicitly
// collapsed it.
let prevRouteWaypointCount = 0;

/**
 * Itinéraire bottom bar (mirrors the Studio bottom bar): Couches + Réglages
 * popovers, then the Itinéraire pill that opens the resizable editing panel
 * above the bar. Theme-aware — no `dark` wrapper, so it follows `uiTheme`.
 */
export function RouteBottomBar() {
    const [popover, setPopover] = useState<Popover>(null);
    const [bottomHeight, setBottomHeight] = useState(330);

    const bottomOpen = useMapStore((s) => s.bottomOpen);
    const setBottomOpen = useMapStore((s) => s.setBottomOpen);

    const togglePopover = (id: Exclude<Popover, null>) =>
        setPopover((cur) => (cur === id ? null : id));

    const handleOpenRoute = useCallback(() => {
        setPopover(null);
        setBottomOpen(!bottomOpen);
    }, [bottomOpen, setBottomOpen]);

    // Auto-expand the Itinéraire panel when the first waypoint is added.
    const waypoints = useRouteStore((s) => s.waypoints);
    useEffect(() => {
        if (waypoints.length > 0 && prevRouteWaypointCount === 0) {
            setBottomOpen(true);
        }
        prevRouteWaypointCount = waypoints.length;
    }, [waypoints.length, setBottomOpen]);

    const resizingRef = useRef(false);
    const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        resizingRef.current = true;
        const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const startHeight = bottomHeight;

        const onMove = (ev: MouseEvent | TouchEvent) => {
            const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
            const delta = startY - clientY;
            setBottomHeight(Math.max(120, Math.min(globalThis.innerHeight * 0.7, startHeight + delta)));
        };
        const onEnd = () => {
            resizingRef.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('touchend', onEnd);
    }, [bottomHeight]);

    return (
        <>
            {/* Resizable editing panel, anchored just above the bottom bar. */}
            {bottomOpen && (
                <div
                    className="pointer-events-auto absolute inset-x-0 bottom-16 z-10 mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white/90 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95"
                    style={{ height: `${bottomHeight}px` }}
                >
                    <button
                        type="button"
                        onMouseDown={handleResizeStart}
                        onTouchStart={handleResizeStart}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowUp') setBottomHeight((h) => Math.min(globalThis.innerHeight * 0.7, h + 20));
                            if (e.key === 'ArrowDown') setBottomHeight((h) => Math.max(120, h - 20));
                        }}
                        className="flex h-3 shrink-0 cursor-ns-resize items-center justify-center"
                        aria-label="Redimensionner le panneau"
                    >
                        <div className="h-0.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
                    </button>
                    <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
                        <BottomPanelContent />
                    </div>
                </div>
            )}

            {/* Bottom pill bar. */}
            <BottomBar active={popover !== null} onDismiss={() => setPopover(null)}>
                {ROUTE_SETTING_SECTIONS.map((pill) => (
                    <BottomBarPill
                        key={pill.id}
                        label={pill.label}
                        Icon={pill.Icon}
                        active={popover === pill.id}
                        onSelect={() => togglePopover(pill.id)}
                    >
                        {pill.render()}
                    </BottomBarPill>
                ))}
                <div className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/15" />
                <BottomBarButton
                    label="Itinéraire"
                    Icon={RouteIcon}
                    active={bottomOpen}
                    onSelect={handleOpenRoute}
                />
            </BottomBar>
        </>
    );
}
