import type { CSSProperties } from 'react';
import { MapSlot } from './components/map/MapSlot';
import { MobileLayout } from './components/MobileLayout';
import { AppHeaderBox } from './components/shell/AppHeaderBox';
import { REDUCED_DOCK_HEIGHT_PX, RouteDock } from './components/shell/RouteDock';
import { RouteExportButton } from './components/shell/RouteExportButton';
import { RouteShareButton } from './components/shell/RouteShareButton';
import { RouteSidePanel } from './components/shell/RouteSidePanel';
import { SIDE_PANEL_MARGIN_PX, SIDE_PANEL_STRIP_PX } from './components/shell/SidePanel';
import { TopBarActions } from './components/shell/TopBarActions';
import { ViewpointModeBar } from './components/shell/ViewpointModeBar';
import { useIsMobile } from './lib/useIsMobile';
import { useMapStore } from './stores/mapStore';

export function App() {
    const isMobile = useIsMobile();
    const panelCollapsed = useMapStore((s) => s.sidePanelCollapsed);
    const dockCollapsed = useMapStore((s) => s.bottomCollapsed);
    const bottomClearance = dockCollapsed ? REDUCED_DOCK_HEIGHT_PX : 0;

    if (isMobile) {
        return <MobileLayout />;
    }

    return (
        <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Map area — the expanded route dock below shrinks it instead of
                covering it, so the terrain under the current route stays
                readable; reduced, it lies over its bottom edge. */}
            <div
                className="relative min-h-0 flex-1 [&_.maplibregl-ctrl-bottom-left]:bottom-[var(--dock-clearance)]"
                style={{ '--dock-clearance': `${bottomClearance}px` } as CSSProperties}
            >
                <MapSlot />

                {/* Top bar — same layout as the Studio: shared header box on the
                    left and the shared action group beside it. It stops short of
                    the side panel, which rises to the top and carries the view
                    switch. */}
                <div
                    className="pointer-events-none absolute left-0 top-0 z-10 flex flex-wrap items-start gap-3 px-3 py-2.5"
                    style={{ right: SIDE_PANEL_STRIP_PX - SIDE_PANEL_MARGIN_PX }}
                >
                    <div className="pointer-events-auto">
                        <AppHeaderBox />
                    </div>
                    <TopBarActions view="map" exportSlot={<><RouteExportButton /><RouteShareButton /></>} />
                </div>

                <RouteSidePanel bottomInsetPx={bottomClearance} />

                {/* The one thing at the bottom of the map: summit names hang from the top.
                    Centred on the map the panel leaves visible, above the attribution. */}
                <div
                    className="pointer-events-none absolute left-0 z-10 flex justify-center px-3"
                    style={{ bottom: 48 + bottomClearance, right: panelCollapsed ? 0 : SIDE_PANEL_STRIP_PX }}
                >
                    <ViewpointModeBar />
                </div>
            </div>

            {/* Docked route/elevation panel. */}
            <RouteDock />
        </div>
    );
}

