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
    GpxSection,
    RenderSection,
    RouteProfileSection,
    ShadingBlendSection,
    TerrainDemSection,
} from '@/components/ui/SettingsPanel';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

type Popover = string | null;

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

function RenderIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909.47.47a.75.75 0 11-1.06 1.06L6.53 8.091a.75.75 0 00-1.06 0L2.5 11.06zm11-4.31a1.25 1.25 0 112.5 0 1.25 1.25 0 01-2.5 0z" clipRule="evenodd" />
        </svg>
    );
}

function ProfileIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 15l4-6 3 3 4-7 5 10" />
        </svg>
    );
}

function KeyIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M8 1a5 5 0 00-4.546 7.09L1 10.543V14a1 1 0 001 1h3v-2h2v-2h1.457A5 5 0 108 1zm2.5 3.5a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" />
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
    { id: 'fond', label: 'Fond', Icon: LayersIcon, render: () => <BaseLayerSection hideTitle /> },
    {
        id: 'ombrage',
        label: 'Ombrage',
        Icon: ShadingIcon,
        render: () => (
            <>
                <HillshadeSection />
                <SectionDivider />
                <ShadingBlendSection hideTitle />
            </>
        ),
    },
    { id: 'courbes', label: 'Courbes', Icon: ContourIcon, render: () => <ContourSection hideTitle /> },
    {
        id: 'terrain',
        label: 'Terrain',
        Icon: MountainIcon,
        render: () => (
            <>
                <Terrain3DSection hideTitle />
                <SectionDivider />
                <TerrainDemSection hideTitle />
            </>
        ),
    },
    { id: 'rendu', label: 'Rendu', Icon: RenderIcon, render: () => <RenderSection hideTitle /> },
    {
        id: 'profil',
        label: 'Profil',
        Icon: ProfileIcon,
        render: () => (
            <>
                <RouteProfileSection hideTitle />
                <SectionDivider />
                <GpxSection hideTitle />
            </>
        ),
    },
    { id: 'cles', label: 'Clés API', Icon: KeyIcon, render: () => <ApiKeysSection hideTitle /> },
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
