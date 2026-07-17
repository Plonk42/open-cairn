import { MapSlot } from '@/components/map/MapSlot';
import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { MobileActionsMenu } from '@/components/shell/MobileActionsMenu';
import { MobileToolbar, type MobileTool } from '@/components/shell/MobileToolbar';
import { MobileTopBar } from '@/components/shell/MobileTopBar';
import { RouteExportButton } from '@/components/shell/RouteExportButton';
import { CliffIcon, ROUTE_SETTING_SECTIONS, RouteIcon } from '@/components/shell/routeSections';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useState } from 'react';

/**
 * Itinéraire (`?view=map`) mobile shell. Mirrors the desktop layout with the
 * shared mobile chrome — the compact top bar (badge + view switch + search +
 * actions menu) and the generic bottom toolbar. The route + cliff editing
 * panels and the map-styling sections are reused verbatim from the desktop
 * `RouteBottomBar` registry, presented as bottom sheets instead of popovers.
 */
export function MobileLayout() {
    const [activeTool, setActiveTool] = useState<string | null>(null);

    const setBottomMode = useMapStore((s) => s.setBottomMode);
    const setCliffSliceActive = useMapStore((s) => s.setCliffSliceActive);
    const setRouteActive = useRouteStore((s) => s.setActive);
    const lidarLoaded = useMapStore((s) => s.lidarShaded !== null || s.lidarMesh !== null);

    const tools: MobileTool[] = [
        { id: 'route', label: 'Itinéraire', Icon: RouteIcon, render: () => <BottomPanelContent mode="route" /> },
        {
            id: 'cliff',
            label: 'Coupe',
            Icon: CliffIcon,
            render: () => <BottomPanelContent mode="cliff" />,
            title: lidarLoaded ? undefined : 'Chargez un nuage LiDAR (Studio LiDAR) pour utiliser ce mode',
        },
        ...ROUTE_SETTING_SECTIONS,
    ];

    // Selecting the route / cliff tool also flips the shared map-interaction
    // mode (mirrors the desktop `RouteBottomBar` handlers) so map taps add the
    // right kind of point; collapsing a tool leaves that mode untouched.
    const handleSelect = (id: string) => {
        const willClose = activeTool === id;
        setActiveTool(willClose ? null : id);
        if (willClose) return;
        if (id === 'route') {
            setBottomMode('route');
            setCliffSliceActive(false);
        } else if (id === 'cliff') {
            setBottomMode('cliff');
            setCliffSliceActive(true);
            setRouteActive(false);
        }
    };

    return (
        <div className="relative h-[100dvh] w-screen overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <MapSlot />
            <MobileTopBar actions={<MobileActionsMenu exportSlot={<RouteExportButton />} />} />
            <MobileToolbar tools={tools} activeId={activeTool} onSelect={handleSelect} />
        </div>
    );
}
