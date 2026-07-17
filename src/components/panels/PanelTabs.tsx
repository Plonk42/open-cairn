import { CliffBottomPanel, useCliffSliceProfile } from '@/components/ui/CliffSlicePanel';
import { RoutePanel } from '@/components/ui/RoutePanel';

export type BottomMode = 'route' | 'cliff';

/**
 * Bottom-panel content: dispatches between the route panel and the
 * cliff-slice cross-section panel based on the user-chosen mode.
 */
export function BottomPanelContent({ mode }: Readonly<{ mode: BottomMode }>) {
    const profile = useCliffSliceProfile();
    if (mode === 'cliff') return <CliffBottomPanel profile={profile} />;
    return <RoutePanel />;
}
