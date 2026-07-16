import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { BottomBar, BottomBarButton, BottomBarPill } from '@/components/shell/BottomBar';
import { LayerSwitcher } from '@/components/ui/LayerSwitcher';
import { SettingsPanel } from '@/components/ui/SettingsPanel';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useRef, useState } from 'react';

type Popover = 'layers' | 'settings' | null;

function LayersIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
            <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" strokeLinejoin="round" />
        </svg>
    );
}

function SettingsGearIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.971.41 1.416.69l1.38-.588a1 1 0 011.12.258l.962.962a1 1 0 01.258 1.12l-.588 1.38c.28.445.511.919.69 1.416l1.473.295A1 1 0 0119 9.32v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.41.971-.69 1.416l.588 1.38a1 1 0 01-.258 1.12l-.962.962a1 1 0 01-1.12.258l-1.38-.588c-.445.28-.919.511-1.416.69l-.295 1.473A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.69l-1.38.588a1 1 0 01-1.12-.258l-.962-.962a1 1 0 01-.258-1.12l.588-1.38a7.957 7.957 0 01-.69-1.416l-1.473-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.41-.971.69-1.416l-.588-1.38a1 1 0 01.258-1.12l.962-.962a1 1 0 011.12-.258l1.38.588c.445-.28.919-.511 1.416-.69l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
    );
}

function RouteIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 16c0-2 3-2 3-4S5 8 5 6a2 2 0 114 0M11 4c0 2 4 2 4 5s-4 3-4 5a2 2 0 104 0" />
            <circle cx="5" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
    );
}

function CliffIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 16l4-8 3 4 3-7 6 11" />
        </svg>
    );
}

/**
 * Itinéraire bottom bar (mirrors the Studio bottom bar): Couches + Réglages
 * popovers, then Itinéraire / Coupe falaise pills that open the resizable
 * editing panel above the bar. Theme-aware — no `dark` wrapper, so it follows
 * `uiTheme`.
 */
export function RouteBottomBar() {
    const [popover, setPopover] = useState<Popover>(null);
    const [bottomOpen, setBottomOpen] = useState(false);
    const [bottomHeight, setBottomHeight] = useState(330);

    const bottomMode = useMapStore((s) => s.bottomMode);
    const setBottomMode = useMapStore((s) => s.setBottomMode);
    const setActiveSlice = useMapStore((s) => s.setCliffSliceActive);
    const setActiveRoute = useRouteStore((s) => s.setActive);
    const lidarLoaded = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);

    const togglePopover = (id: Exclude<Popover, null>) =>
        setPopover((cur) => (cur === id ? null : id));

    const handleOpenRoute = useCallback(() => {
        if (bottomMode === 'route' && bottomOpen) {
            setBottomOpen(false);
        } else {
            setBottomMode('route');
            setBottomOpen(true);
            // Leaving cliff mode: turn off the slice tracé so a stray click on
            // the map doesn't add a slice point.
            setActiveSlice(false);
        }
    }, [bottomMode, bottomOpen, setBottomMode, setActiveSlice]);

    const handleOpenCliff = useCallback(() => {
        if (bottomMode === 'cliff' && bottomOpen) {
            setBottomOpen(false);
        } else {
            setBottomMode('cliff');
            setBottomOpen(true);
            setActiveSlice(true);
            // Leaving route mode: turn off the route tracé so a stray click on
            // the map doesn't add a waypoint.
            setActiveRoute(false);
        }
    }, [bottomMode, bottomOpen, setBottomMode, setActiveSlice, setActiveRoute]);

    // Auto-expand the Itinéraire panel when the first waypoint is added.
    const waypoints = useRouteStore((s) => s.waypoints);
    const prevWaypointCount = useRef(0);
    useEffect(() => {
        if (waypoints.length > 0 && prevWaypointCount.current === 0) {
            setBottomOpen(true);
        }
        prevWaypointCount.current = waypoints.length;
    }, [waypoints.length]);

    // Auto-expand bottom panel when the cliff-slice polyline has ≥2 points
    // (covers share-link reload and the case where the user keeps adding points
    // after collapsing the panel).
    const slicePointCount = useMapStore((s) => s.cliffSlicePoints.length);
    const sliceReady = slicePointCount >= 2;
    useEffect(() => {
        if (sliceReady) {
            setBottomMode('cliff');
            setBottomOpen(true);
        }
    }, [sliceReady, setBottomMode]);

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
                        <BottomPanelContent mode={bottomMode} />
                    </div>
                </div>
            )}

            {/* Bottom pill bar. */}
            <BottomBar active={popover !== null} onDismiss={() => setPopover(null)}>
                <BottomBarPill
                    label="Couches"
                    Icon={LayersIcon}
                    active={popover === 'layers'}
                    onSelect={() => togglePopover('layers')}
                >
                    <LayerSwitcher />
                </BottomBarPill>
                <BottomBarPill
                    label="Réglages"
                    Icon={SettingsGearIcon}
                    active={popover === 'settings'}
                    onSelect={() => togglePopover('settings')}
                >
                    <SettingsPanel />
                </BottomBarPill>
                <div className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/15" />
                <BottomBarButton
                    label="Itinéraire"
                    Icon={RouteIcon}
                    active={bottomMode === 'route' && bottomOpen}
                    onSelect={handleOpenRoute}
                />
                <BottomBarButton
                    label="Coupe falaise"
                    Icon={CliffIcon}
                    active={bottomMode === 'cliff' && bottomOpen}
                    onSelect={handleOpenCliff}
                    title={lidarLoaded ? undefined : 'Chargez un nuage de points LiDAR (Studio LiDAR) pour utiliser ce mode'}
                />
            </BottomBar>
        </>
    );
}
