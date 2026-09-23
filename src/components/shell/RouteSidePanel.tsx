import { CollapseAllIcon, PanelRightIcon, ResetIcon } from '@/components/icons/LidarIcons';
import { FondPinnedBadge, ROUTE_SETTING_SECTIONS } from '@/components/shell/routeSections';
import {
    DockedSidePanel, SidePanel, SidePanelIconButton, SidePanelSection,
} from '@/components/shell/SidePanel';
import { useMapStore } from '@/stores/mapStore';
import type { ReactElement } from 'react';

/**
 * Desktop Itinéraire control surface: the same right-hand accordion as the
 * Studio (`StudioSidePanel`), holding the map-styling sections the mobile
 * toolbar shows as sheets. It replaced the bottom pill bar, which left the
 * bottom of the map to one thing only: the viewpoint bar. The route itself
 * lives in the dock under the map, always there.
 */
export function RouteSidePanel({ bottomInsetPx }: Readonly<{ bottomInsetPx: number }>): ReactElement {
    const collapsed = useMapStore((s) => s.sidePanelCollapsed);
    const setCollapsed = useMapStore((s) => s.setSidePanelCollapsed);
    const sections = useMapStore((s) => s.routePanelSections);
    const setSections = useMapStore((s) => s.setRoutePanelSections);
    const resetMapStyle = useMapStore((s) => s.resetMapStyle);

    const toggle = (id: string) => {
        setSections(sections.includes(id) ? sections.filter((s) => s !== id) : [...sections, id]);
    };

    return (
        <DockedSidePanel collapsed={collapsed} onExpand={() => setCollapsed(false)} bottomInsetPx={bottomInsetPx}>
            <SidePanel
                actions={
                    <>
                        <SidePanelIconButton label="Réinitialiser les réglages de la carte (fond, terrain)" onClick={resetMapStyle}>
                            <ResetIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                        <SidePanelIconButton label="Tout replier" onClick={() => setSections([])}>
                            <CollapseAllIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                        <SidePanelIconButton label="Masquer le panneau" onClick={() => setCollapsed(true)}>
                            <PanelRightIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                    </>
                }
            >
                {ROUTE_SETTING_SECTIONS.map((section) => (
                    <SidePanelSection
                        key={section.id}
                        label={section.label}
                        Icon={section.Icon}
                        open={sections.includes(section.id)}
                        onToggle={() => toggle(section.id)}
                        badge={section.id === 'fond' ? <FondPinnedBadge /> : undefined}
                    >
                        {section.render()}
                    </SidePanelSection>
                ))}
            </SidePanel>
        </DockedSidePanel>
    );
}
