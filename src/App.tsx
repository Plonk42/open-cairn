import { useCallback, useEffect, useRef, useState } from 'react';
import { CursorCoordinates } from './components/map/CursorCoordinates';
import { MapContainer } from './components/map/MapContainer';
import { SearchBox } from './components/map/SearchBox';
import { CliffBottomPanel, useCliffSliceProfile } from './components/ui/CliffSlicePanel';
import { LayerSwitcher } from './components/ui/LayerSwitcher';
import { LidarCloudPanel } from './components/ui/LidarCloudPanel';
import { RoutePanel } from './components/ui/RoutePanel';
import { SavedPanel } from './components/ui/SavedPanel';
import { SettingsPanel } from './components/ui/SettingsPanel';
import { buildShareUrl } from './lib/shareView';
import { useIsMobile } from './lib/useIsMobile';
import { useMapStore } from './stores/mapStore';
import { useRouteStore } from './stores/routeStore';

type RightTab = 'layers' | 'routes' | 'lidar' | 'settings';
type MobileTab = 'map' | 'route' | 'routes' | 'layers' | 'lidar' | 'settings';
type BottomMode = 'route' | 'cliff';

/** Hook to sync the LiDAR preview visibility with the current tab state. */
function useLidarPreviewSync(tabIsLidar: boolean) {
    const hasData = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);
    const setPreviewVisible = useMapStore((s) => s.setLidarPreviewVisible);
    useEffect(() => {
        // Show preview when LiDAR tab is active and no data is loaded
        setPreviewVisible(tabIsLidar && !hasData);
    }, [tabIsLidar, hasData, setPreviewVisible]);
}

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
    const [shareTooltip, setShareTooltip] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>('map');
    const resizingRef = useRef(false);
    const uiTheme = useMapStore((s) => s.uiTheme);

    const handleShare = useCallback(() => {
        const map = useMapStore.getState();
        const route = useRouteStore.getState();
        const url = buildShareUrl({
            view: map.view,
            baseLayer: map.baseLayer,
            hillshadeEnabled: map.hillshadeEnabled,
            hillshadeSource: map.hillshadeSource,
            hillshadeBlend: map.hillshadeBlend,
            hillshadeIntensity: map.hillshadeIntensity,
            terrainEnabled: map.terrainEnabled,
            terrainExaggeration: map.terrainExaggeration,
            contourLinesEnabled: map.contourLinesEnabled,
            contourLinesOpacity: map.contourLinesOpacity,
            routeActive: route.active,
            routeMode: route.mode,
            colorElevationBySlope: route.colorElevationBySlope,
            waypoints: route.waypoints,
            selectionRange: route.selectionRange,
            cliffSlicePoints: map.cliffSlicePoints,
            cliffSliceCorridor: map.cliffSliceCorridor,
            cliffSliceClasses: map.cliffSliceClasses,
            cliffSliceColorClass: map.cliffSliceColorClass,
            cliffSliceColorDepth: map.cliffSliceColorDepth,
            cliffSliceRopeSafety: map.cliffSliceRopeSafety,
            cliffSliceStations: map.cliffSliceStations,
        });
        navigator.clipboard.writeText(url);
        setShareTooltip(true);
        setTimeout(() => setShareTooltip(false), 2000);
    }, []);

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

    // Sync LiDAR preview visibility with current tab state (desktop vs mobile)
    const lidarTabActiveDesktop = !isMobile && rightOpen && rightTab === 'lidar';
    const lidarTabActiveMobile = isMobile && mobileTab === 'lidar';
    useLidarPreviewSync(lidarTabActiveDesktop || lidarTabActiveMobile);

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
                    <MapContainer />
                    {/* Top-left unified menu: app title + search + cursor coordinates */}
                    <div className="pointer-events-none absolute left-3 top-3 z-10 w-72">
                        <div className="overflow-hidden rounded-lg bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/75 dark:ring-white/10">
                            <div className="flex select-none items-center gap-1.5 px-3 py-1.5 text-sm font-semibold">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-4 w-3.5 text-green-600 dark:text-emerald-400">
                                    <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                                    <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                                    <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                                    <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                                </svg>
                                <span className="text-slate-700 dark:text-slate-100">open-cairn</span>
                                <button
                                    type="button"
                                    onClick={handleShare}
                                    className="pointer-events-auto relative ml-auto flex items-center gap-1 rounded-md bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                                    title="Partager la vue actuelle"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                        <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
                                        <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                                    </svg>
                                    Partager
                                    {shareTooltip && (
                                        <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow dark:bg-slate-700">
                                            Lien copié !
                                        </span>
                                    )}
                                </button>
                            </div>
                            <div className="border-t border-black/5 dark:border-white/10">
                                <SearchBox flat />
                            </div>
                            <div className="border-t border-black/5 px-2 py-1 dark:border-white/10">
                                <CursorCoordinates flat />
                            </div>
                        </div>
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

/* ─────────────────────────────────────────────────── */
/* Mobile Layout                                        */
/* ─────────────────────────────────────────────────── */

function MobileLayout({ mobileTab, setMobileTab, shareTooltip, handleShare }: Readonly<{
    mobileTab: MobileTab;
    setMobileTab: (tab: MobileTab) => void;
    shareTooltip: boolean;
    handleShare: () => void;
}>) {
    const [sheetHeight, setSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ y: number; height: string } | null>(null);

    // Computed sheet height
    const sheetHeightClass = {
        collapsed: 'h-0',
        half: 'h-[45vh]',
        full: 'h-[85vh]',
    }[sheetHeight];

    // When switching to map tab, collapse sheet
    useEffect(() => {
        if (mobileTab === 'map') setSheetHeight('collapsed');
        else if (sheetHeight === 'collapsed') setSheetHeight('half');
    }, [mobileTab]);

    // Swipe to resize sheet
    const handleSheetDragStart = useCallback((e: React.TouchEvent) => {
        const startY = e.touches[0].clientY;
        dragStartRef.current = { y: startY, height: sheetHeight };

        const onMove = (ev: TouchEvent) => {
            const deltaY = ev.touches[0].clientY - startY;
            const vh = globalThis.innerHeight;
            if (deltaY > vh * 0.15 && sheetHeight !== 'collapsed') {
                // Swiping down
                if (sheetHeight === 'full') setSheetHeight('half');
                else { setSheetHeight('collapsed'); setMobileTab('map'); }
            } else if (deltaY < -vh * 0.1 && sheetHeight !== 'full') {
                // Swiping up
                if (sheetHeight === 'collapsed') setSheetHeight('half');
                else setSheetHeight('full');
            }
        };
        const onEnd = () => {
            dragStartRef.current = null;
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
    }, [sheetHeight, setMobileTab]);

    return (
        <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Map always renders, takes available space */}
            <div className="relative min-h-0 flex-1">
                <MapContainer />
                {/* Compact title badge */}
                <div className="pointer-events-none absolute left-2 top-2 z-10 select-none">
                    <div className="flex items-center gap-1 rounded-lg bg-white/85 px-2 py-1 text-xs font-semibold shadow-sm backdrop-blur-md ring-1 ring-black/5 dark:bg-slate-900/70 dark:ring-white/10">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-3.5 w-3 text-green-600 dark:text-emerald-400">
                            <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                            <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                            <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                            <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                        </svg>
                        <span className="text-slate-700 dark:text-slate-100">open-cairn</span>
                        <button
                            type="button"
                            onClick={handleShare}
                            className="pointer-events-auto relative ml-1 flex h-6 w-6 items-center justify-center rounded-md bg-green-600/10 text-green-700 transition active:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300"
                            title="Partager"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
                                <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            </svg>
                            {shareTooltip && (
                                <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow">
                                    Copié !
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom sheet overlay */}
            {mobileTab !== 'map' && (
                <div
                    ref={sheetRef}
                    className={`flex-shrink-0 overflow-hidden border-t border-gray-200/60 bg-white/95 backdrop-blur-md transition-[height] duration-200 ease-out dark:border-white/10 dark:bg-slate-900/98 ${sheetHeightClass}`}
                >
                    {/* Drag handle */}
                    <div
                        onTouchStart={handleSheetDragStart}
                        className="flex h-6 w-full touch-none items-center justify-center"
                    >
                        <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
                    </div>
                    {/* Sheet content */}
                    <div className="h-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain px-3 pb-2">
                        <MobileSheetContent mobileTab={mobileTab} />
                    </div>
                </div>
            )}

            {/* Bottom tab bar */}
            <nav className="flex-shrink-0 border-t border-gray-200/60 bg-white/95 backdrop-blur-md safe-bottom dark:border-white/10 dark:bg-slate-900/98">
                <div className="flex h-14 items-stretch">
                    <MobileTabButton
                        active={mobileTab === 'map'}
                        label="Carte"
                        onClick={() => setMobileTab('map')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 00-1.147 0l-4.084 1.69A1.5 1.5 0 002 5.25v10.877a1.5 1.5 0 002.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 001.147 0l4.084-1.69A1.5 1.5 0 0018 14.75V3.873a1.5 1.5 0 00-2.074-1.386l-3.51 1.452-4.26-1.763zM7.58 5a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 017.58 5zm5.59 2a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5a.75.75 0 01.75-.75z" clipRule="evenodd" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'layers'}
                        label="Couches"
                        onClick={() => setMobileTab('layers')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'lidar'}
                        label="LiDAR"
                        onClick={() => setMobileTab('lidar')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><circle cx="4" cy="6" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="16" cy="7" r="1.2" /><circle cx="6" cy="11" r="1.2" /><circle cx="13" cy="12" r="1.2" /><circle cx="4" cy="16" r="1.2" /><circle cx="11" cy="17" r="1.2" /><circle cx="17" cy="14" r="1.2" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'route'}
                        label="Tracé"
                        onClick={() => setMobileTab('route')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13zm10.857 5.691a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 00-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'routes'}
                        label="Enreg."
                        onClick={() => setMobileTab('routes')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M2 6.75A1.75 1.75 0 013.75 5h3.36c.4 0 .78.135 1.094.384L9.81 6.5h6.44A1.75 1.75 0 0118 8.25v6A1.75 1.75 0 0116.25 16H3.75A1.75 1.75 0 012 14.25v-7.5z" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'settings'}
                        label="Réglages"
                        onClick={() => setMobileTab('settings')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.971.41 1.416.69l1.38-.588a1 1 0 011.12.258l.962.962a1 1 0 01.258 1.12l-.588 1.38c.28.445.511.919.69 1.416l1.473.295A1 1 0 0119 9.32v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.41.971-.69 1.416l.588 1.38a1 1 0 01-.258 1.12l-.962.962a1 1 0 01-1.12.258l-1.38-.588c-.445.28-.919.511-1.416.69l-.295 1.473A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.69l-1.38.588a1 1 0 01-1.12-.258l-.962-.962a1 1 0 01-.258-1.12l.588-1.38a7.957 7.957 0 01-.69-1.416l-1.473-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.41-.971.69-1.416l-.588-1.38a1 1 0 01.258-1.12l.962-.962a1 1 0 011.12-.258l1.38.588c.445-.28.919-.511 1.416-.69l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>}
                    />
                </div>
            </nav>
        </div>
    );
}

function MobileTabButton({ active, label, icon, onClick }: Readonly<{
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${active ? 'text-green-600 dark:text-emerald-400' : 'text-slate-400 active:text-slate-600 dark:text-slate-500 dark:active:text-slate-300'}`}
        >
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
        </button>
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

function RightTabContent({ tab }: Readonly<{ tab: RightTab }>) {
    if (tab === 'layers') return <LayerSwitcher />;
    if (tab === 'routes') return <SavedPanel />;
    if (tab === 'lidar') return <LidarCloudPanel />;
    return <SettingsPanel />;
}

/**
 * Bottom-panel content: dispatches between the route panel and the
 * cliff-slice cross-section panel based on the user-chosen mode.
 */
function BottomPanelContent({ mode }: Readonly<{ mode: BottomMode }>) {
    const profile = useCliffSliceProfile();
    if (mode === 'cliff') return <CliffBottomPanel profile={profile} />;
    return <RoutePanel />;
}

function MobileSheetContent({ mobileTab }: Readonly<{ mobileTab: MobileTab }>) {
    if (mobileTab === 'route') return <RoutePanel />;
    if (mobileTab === 'map') return null;
    return <RightTabContent tab={mobileTab} />;
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
