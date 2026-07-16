import { useCallback, useEffect, useRef, useState } from 'react';
import { MapSlot } from './components/map/MapSlot';
import { MobileLayout } from './components/MobileLayout';
import { BottomPanelContent, RightTabContent, type MobileTab, type RightTab } from './components/panels/PanelTabs';
import { AppHeaderBox } from './components/shell/AppHeaderBox';
import { ViewSwitch } from './components/shell/ViewSwitch';
import { useIsMobile } from './lib/useIsMobile';
import { useShare } from './lib/useShare';
import { useMapStore } from './stores/mapStore';
import { useRouteStore } from './stores/routeStore';

export function App() {
    const isMobile = useIsMobile();
    const [rightOpen, setRightOpen] = useState(() => globalThis.innerWidth >= 768);
    const [rightTab, setRightTab] = useState<RightTab>('layers');
    const [bottomOpen, setBottomOpen] = useState(false);
    const bottomMode = useMapStore((s) => s.bottomMode);
    const setBottomMode = useMapStore((s) => s.setBottomMode);
    const [bottomHeight, setBottomHeight] = useState(330);

    const setActiveSlice = useMapStore((s) => s.setCliffSliceActive);
    const setActiveRoute = useRouteStore((s) => s.setActive);
    const lidarLoaded = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);

    const handleOpenRoute = useCallback(() => {
        if (bottomMode === 'route' && bottomOpen) {
            setBottomOpen(false);
        } else {
            setBottomMode('route');
            setBottomOpen(true);
            // Leaving cliff mode: turn off the slice tracé so a stray click on the
            // map doesn't add a slice point.
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
            // Leaving route mode: turn off the route tracé so a stray click on the
            // map doesn't add a waypoint.
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
    // (covers share-link reload and the case where the user keeps adding
    // points after collapsing the panel).
    const slicePointCount = useMapStore((s) => s.cliffSlicePoints.length);
    const sliceReady = slicePointCount >= 2;
    useEffect(() => {
        if (sliceReady) {
            setBottomMode('cliff');
            setBottomOpen(true);
        }
    }, [sliceReady]);
    const { shareTooltip, handleShare } = useShare();
    const [mobileTab, setMobileTab] = useState<MobileTab>('map');
    const resizingRef = useRef(false);
    const uiTheme = useMapStore((s) => s.uiTheme);

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

    useEffect(() => {
        document.documentElement.classList.toggle('dark', uiTheme === 'dark');
    }, [uiTheme]);

    if (isMobile) {
        return <MobileLayout
            mobileTab={mobileTab}
            setMobileTab={setMobileTab}
            shareTooltip={shareTooltip}
            handleShare={handleShare}
        />;
    }

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Main area: map + right sidebar */}
            <div className="relative flex min-h-0 flex-1">
                {/* Map fills remaining space */}
                <div className="relative flex-1">
                    <MapSlot />
                    {/* Shared app header box (logo + name + search + coordinates). */}
                    <div className="pointer-events-auto absolute left-3 top-3 z-10">
                        <AppHeaderBox />
                    </div>
                    {/* View switch (Itinéraire ↔ Studio LiDAR). */}
                    <div className="absolute right-3 top-3 z-10">
                        <ViewSwitch />
                    </div>
                </div>

                {/* Right sidebar */}
                <div className={`relative z-10 flex flex-shrink-0 transition-[width] duration-200 ${rightOpen ? 'w-80' : 'w-0'}`}>
                    {/* Tab bar on the edge */}
                    <div className="absolute -left-10 top-3 z-20 flex flex-col gap-1">
                        {RIGHT_TABS.map((t) => (
                            <SidebarTabButton
                                key={t.id}
                                active={rightOpen && rightTab === t.id}
                                title={t.title}
                                onClick={() => { setRightOpen(true); setRightTab(t.id); }}
                            >
                                {t.icon}
                            </SidebarTabButton>
                        ))}
                        {rightOpen && (
                            <button
                                type="button"
                                onClick={() => setRightOpen(false)}
                                className="flex h-9 w-9 items-center justify-center rounded-l-lg bg-white/80 text-slate-400 shadow-sm ring-1 ring-black/5 transition hover:text-slate-600 dark:bg-slate-900/80 dark:ring-white/10 dark:hover:text-slate-200"
                                title="Fermer le panneau"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {rightOpen && (
                        <div className="flex h-full w-80 flex-col overflow-y-auto border-l border-gray-200/60 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95">
                            <div className="flex-1 p-3">
                                <RightTabContent tab={rightTab} />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom panel */}
            <div
                className={`relative z-10 flex-shrink-0 border-t border-gray-200/60 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95 ${bottomOpen ? '' : 'max-h-10'}`}
                style={bottomOpen ? { height: `${bottomHeight}px` } : undefined}
            >
                {/* Resize handle */}
                {bottomOpen && (
                    <button
                        type="button"
                        onMouseDown={handleResizeStart}
                        onTouchStart={handleResizeStart}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowUp') setBottomHeight((h) => Math.min(globalThis.innerHeight * 0.7, h + 20));
                            if (e.key === 'ArrowDown') setBottomHeight((h) => Math.max(120, h - 20));
                        }}
                        className="absolute inset-x-0 -top-1 z-30 flex h-2 cursor-ns-resize items-center justify-center"
                        aria-label="Redimensionner le panneau"
                    >
                        <div className="h-0.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
                    </button>
                )}
                {/* Mode toggle: Itinéraire / Coupe falaise (replaces single collapse arrow) */}
                <div className="absolute -top-8 left-1/2 z-20 flex h-7 -translate-x-1/2 overflow-hidden rounded-t-lg bg-white/90 text-xs shadow-sm ring-1 ring-black/5 dark:bg-slate-800/90 dark:ring-white/10">
                    <BottomModeButton
                        active={bottomMode === 'route' && bottomOpen}
                        label="Itinéraire"
                        onClick={handleOpenRoute}
                    />
                    <BottomModeButton
                        active={bottomMode === 'cliff' && bottomOpen}
                        label="Coupe falaise"
                        onClick={handleOpenCliff}
                        title={lidarLoaded ? undefined : 'Chargez un nuage de points LiDAR (panneau LiDAR) pour utiliser ce mode'}
                    />
                </div>
                {bottomOpen && (
                    <div className="h-full overflow-hidden">
                        <BottomPanelContent mode={bottomMode} />
                    </div>
                )}
            </div>
        </div>
    );
}

function BottomModeButton({ active, label, onClick, disabled, title }: Readonly<{
    active: boolean;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}>) {
    let cls: string;
    if (disabled) {
        cls = 'cursor-not-allowed text-slate-300 dark:text-slate-600';
    } else if (active) {
        cls = 'bg-green-600 text-white dark:bg-emerald-500';
    } else {
        cls = 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60';
    }
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`px-3 font-medium transition ${cls}`}
        >
            {label}
        </button>
    );
}

function SidebarTabButton({ active, title, onClick, children }: Readonly<{
    active: boolean;
    title: string;
    onClick: () => void;
    children: React.ReactNode;
}>) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`flex h-9 w-9 items-center justify-center rounded-l-lg shadow-sm transition ring-1 ${active ? 'bg-white text-green-600 ring-black/5 dark:bg-slate-800 dark:text-emerald-400 dark:ring-white/10' : 'bg-white/80 text-slate-400 ring-black/5 hover:text-slate-600 dark:bg-slate-900/80 dark:ring-white/10 dark:hover:text-slate-200'}`}
        >
            {children}
        </button>
    );
}

const RIGHT_TABS: ReadonlyArray<{ id: RightTab; title: string; icon: React.ReactNode }> = [
    {
        id: 'layers',
        title: 'Couches',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
        ),
    },
    {
        id: 'lidar',
        title: 'Rendu 3D LiDAR',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <circle cx="4" cy="6" r="1.2" />
                <circle cx="10" cy="4" r="1.2" />
                <circle cx="16" cy="7" r="1.2" />
                <circle cx="6" cy="11" r="1.2" />
                <circle cx="13" cy="12" r="1.2" />
                <circle cx="4" cy="16" r="1.2" />
                <circle cx="11" cy="17" r="1.2" />
                <circle cx="17" cy="14" r="1.2" />
            </svg>
        ),
    },
    {
        id: 'routes',
        title: 'Mes itinéraires',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M5 2.75A2.75 2.75 0 017.75 0h4.5A2.75 2.75 0 0115 2.75V18.5a.75.75 0 01-1.18.614L10 16.367 6.18 19.114A.75.75 0 015 18.5V2.75z" />
            </svg>
        ),
    },
    {
        id: 'settings',
        title: 'Réglages',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.971.41 1.416.69l1.38-.588a1 1 0 011.12.258l.962.962a1 1 0 01.258 1.12l-.588 1.38c.28.445.511.919.69 1.416l1.473.295A1 1 0 0119 9.32v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.41.971-.69 1.416l.588 1.38a1 1 0 01-.258 1.12l-.962.962a1 1 0 01-1.12.258l-1.38-.588c-.445.28-.919.511-1.416.69l-.295 1.473A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.69l-1.38.588a1 1 0 01-1.12-.258l-.962-.962a1 1 0 01-.258-1.12l.588-1.38a7.957 7.957 0 01-.69-1.416l-1.473-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.41-.971.69-1.416l-.588-1.38a1 1 0 01.258-1.12l.962-.962a1 1 0 011.12-.258l1.38.588c.445-.28.919-.511 1.416-.69l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
        ),
    },
];
