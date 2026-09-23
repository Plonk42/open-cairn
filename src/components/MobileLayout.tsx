import { ResetSettingsButton } from '@/components/lidar/StudioRenderSettings';
import { MapSlot } from '@/components/map/MapSlot';
import { BottomPanelContent } from '@/components/panels/PanelTabs';
import { MobileActionsMenu } from '@/components/shell/MobileActionsMenu';
import { MobileToolbar, type MobileTool } from '@/components/shell/MobileToolbar';
import { MobileTopBar } from '@/components/shell/MobileTopBar';
import { RouteExportButton } from '@/components/shell/RouteExportButton';
import { RouteShareButton } from '@/components/shell/RouteShareButton';
import { ViewpointModeBar } from '@/components/shell/ViewpointModeBar';
import { ROUTE_SETTING_SECTIONS, RouteIcon } from '@/components/shell/routeSections';
import { useMapStore } from '@/stores/mapStore';
import { useState } from 'react';

/**
 * Itinéraire (`?view=map`) mobile shell. Mirrors the desktop layout with the
 * shared mobile chrome — the compact top bar (badge + view switch + search +
 * actions menu) and the generic bottom toolbar. The route editing panel and
 * the map-styling sections are reused verbatim from the desktop side panel
 * (`ROUTE_SETTING_SECTIONS`), presented as bottom sheets instead of accordion sections.
 */
export function MobileLayout() {
    const [activeTool, setActiveTool] = useState<string | null>(null);

    const tools: MobileTool[] = [
        { id: 'route', label: 'Itinéraire', Icon: RouteIcon, render: () => <BottomPanelContent /> },
        ...ROUTE_SETTING_SECTIONS,
    ];

    const handleSelect = (id: string) => {
        setActiveTool((cur) => (cur === id ? null : id));
    };

    return (
        <div className="relative h-[100dvh] w-screen overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <MapSlot />
            <MobileTopBar actions={<MobileActionsMenu view="map" exportSlot={<><RouteExportButton /><RouteShareButton /></>} />} />
            <MobileToolbar
                tools={tools}
                activeId={activeTool}
                onSelect={handleSelect}
                trailing={(
                    <ResetSettingsButton
                        label="Réinitialiser les réglages de la carte (fond, terrain)"
                        onReset={() => useMapStore.getState().resetMapStyle()}
                    />
                )}
                above={<div className="flex justify-center px-2 pb-2"><ViewpointModeBar /></div>}
            />
        </div>
    );
}
