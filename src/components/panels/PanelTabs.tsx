import { CliffBottomPanel, useCliffSliceProfile } from '@/components/ui/CliffSlicePanel';
import { LayerSwitcher } from '@/components/ui/LayerSwitcher';
import { LidarCloudPanel } from '@/components/ui/LidarCloudPanel';
import { RoutePanel } from '@/components/ui/RoutePanel';
import { SavedPanel } from '@/components/ui/SavedPanel';
import { SettingsPanel } from '@/components/ui/SettingsPanel';

export type RightTab = 'layers' | 'routes' | 'lidar' | 'settings';
export type MobileTab = 'map' | 'route' | 'routes' | 'layers' | 'lidar' | 'settings';
export type BottomMode = 'route' | 'cliff';

export function RightTabContent({ tab }: Readonly<{ tab: RightTab }>) {
    if (tab === 'layers') return <LayerSwitcher />;
    if (tab === 'routes') return <SavedPanel />;
    if (tab === 'lidar') return <LidarCloudPanel />;
    return <SettingsPanel />;
}

/**
 * Bottom-panel content: dispatches between the route panel and the
 * cliff-slice cross-section panel based on the user-chosen mode.
 */
export function BottomPanelContent({ mode }: Readonly<{ mode: BottomMode }>) {
    const profile = useCliffSliceProfile();
    if (mode === 'cliff') return <CliffBottomPanel profile={profile} />;
    return <RoutePanel />;
}

export function MobileSheetContent({ mobileTab }: Readonly<{ mobileTab: MobileTab }>) {
    if (mobileTab === 'route') return <RoutePanel />;
    if (mobileTab === 'map') return null;
    return <RightTabContent tab={mobileTab} />;
}
