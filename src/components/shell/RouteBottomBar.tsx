import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { BottomBar, BottomBarButton, BottomBarPill } from '@/components/shell/BottomBar';
import {
    BaseLayerSection,
    ContourSection,
    HillshadeSection,
    Terrain3DSection,
} from '@/components/ui/LayerSwitcher';
import {
    ApiKeysSection,
    RenderSection,
    ShadingBlendSection,
    TerrainDemSection,
} from '@/components/ui/SettingsPanel';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

type Popover = string | null;

// Track auto-expand transitions at MODULE scope (not component state/refs) so
// they survive `RouteBottomBar` unmounting when the user switches to the
// LiDAR Studio and back — otherwise a plain useRef resets on remount and
// wrongly re-detects a "0 → N" / "not ready → ready" transition that already
// happened earlier in the session, forcing the panel back open even after
// the user explicitly collapsed it.
let prevRouteWaypointCount = 0;
let prevCliffSliceReady = false;

/** Thin divider between two stacked sections inside a single pill's popover. */
function SectionDivider() {
    return <div className="my-3 h-px bg-gray-200 dark:bg-slate-700" />;
}

function LayersIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
            <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" strokeLinejoin="round" />
        </svg>
    );
}

function ShadingIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="6.5" />
            <path fill="currentColor" stroke="none" d="M10 3.5a6.5 6.5 0 000 13V3.5z" />
        </svg>
    );
}

function ContourIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c2-3 5-4 8-4s6 1 8 4M4 15c2-2 4-3 6-3s4 1 6 3M7 8.5c1-1 2-1.5 3-1.5s2 .5 3 1.5" />
        </svg>
    );
}

function MountainIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 16l4.5-8 3 5 2.5-4.5L18 16H2z" />
        </svg>
    );
}

function AdvancedIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.6 2.5h2.8l.4 2.02c.5.17.96.42 1.38.71l1.94-.68 1.4 2.42-1.53 1.4a5.7 5.7 0 010 1.6l1.53 1.4-1.4 2.42-1.94-.68c-.42.29-.88.54-1.38.71l-.4 2.02H8.6l-.4-2.02a5.6 5.6 0 01-1.38-.71l-1.94.68-1.4-2.42 1.53-1.4a5.7 5.7 0 010-1.6L3.48 6.97l1.4-2.42 1.94.68c.42-.29.88-.54 1.38-.71l.4-2.02z" />
            <circle cx="10" cy="10" r="2.3" />
        </svg>
    );
}

/** Config for the "layers/settings" pills — mirrors Studio's per-setting pills. */
const SETTINGS_PILLS: ReadonlyArray<{
    id: string;
    label: string;
    Icon: (props: { className?: string }) => ReactElement;
    render: () => ReactElement;
}> = [
        { id: 'fond', label: 'Fond', Icon: LayersIcon, render: () => <BaseLayerSection /> },
        {
            id: 'ombrage',
            label: 'Ombrage',
            Icon: ShadingIcon,
            render: () => (
                <>
                    <HillshadeSection />
                    <SectionDivider />
                    <ShadingBlendSection />
                </>
            ),
        },
        { id: 'courbes', label: 'Courbes', Icon: ContourIcon, render: () => <ContourSection /> },
        {
            id: 'terrain',
            label: 'Terrain',
            Icon: MountainIcon,
            render: () => (
                <>
                    <Terrain3DSection />
                    <SectionDivider />
                    <TerrainDemSection />
                </>
            ),
        },
        {
            id: 'avance',
            label: 'Avancé',
            Icon: AdvancedIcon,
            render: () => (
                <>
                    <RenderSection />
                    <SectionDivider />
                    <ApiKeysSection />
                </>
            ),
        },
    ];

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
    const [bottomHeight, setBottomHeight] = useState(330);

    const bottomMode = useMapStore((s) => s.bottomMode);
    const setBottomMode = useMapStore((s) => s.setBottomMode);
    const bottomOpen = useMapStore((s) => s.bottomOpen);
    const setBottomOpen = useMapStore((s) => s.setBottomOpen);
    const setActiveSlice = useMapStore((s) => s.setCliffSliceActive);
    const setActiveRoute = useRouteStore((s) => s.setActive);
    const lidarLoaded = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);

    const togglePopover = (id: Exclude<Popover, null>) =>
        setPopover((cur) => (cur === id ? null : id));

    const handleOpenRoute = useCallback(() => {
        setPopover(null);
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
        setPopover(null);
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
    useEffect(() => {
        if (waypoints.length > 0 && prevRouteWaypointCount === 0) {
            setBottomOpen(true);
        }
        prevRouteWaypointCount = waypoints.length;
    }, [waypoints.length, setBottomOpen]);

    // Auto-expand bottom panel when the cliff-slice polyline has ≥2 points
    // (covers share-link reload and the case where the user keeps adding points
    // after collapsing the panel). Guarded on the not-ready→ready transition
    // (see `prevCliffSliceReady` above) so it doesn't re-fire on every remount.
    const slicePointCount = useMapStore((s) => s.cliffSlicePoints.length);
    const sliceReady = slicePointCount >= 2;
    useEffect(() => {
        if (sliceReady && !prevCliffSliceReady) {
            setBottomMode('cliff');
            setBottomOpen(true);
        }
        prevCliffSliceReady = sliceReady;
    }, [sliceReady, setBottomMode, setBottomOpen]);

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
                {SETTINGS_PILLS.map((pill) => (
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
