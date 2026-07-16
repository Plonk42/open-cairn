import { useState } from 'react';
import { MapSlot } from './components/map/MapSlot';
import { MobileLayout } from './components/MobileLayout';
import { type MobileTab } from './components/panels/PanelTabs';
import { AppHeaderBox } from './components/shell/AppHeaderBox';
import { RouteBottomBar } from './components/shell/RouteBottomBar';
import { ViewSwitch } from './components/shell/ViewSwitch';
import { SavedRoutesGallery } from './components/ui/SavedRoutesGallery';
import { useIsMobile } from './lib/useIsMobile';
import { useShare } from './lib/useShare';

export function App() {
    const isMobile = useIsMobile();
    const { shareTooltip, handleShare } = useShare();
    const [mobileTab, setMobileTab] = useState<MobileTab>('map');

    if (isMobile) {
        return <MobileLayout
            mobileTab={mobileTab}
            setMobileTab={setMobileTab}
            shareTooltip={shareTooltip}
            handleShare={handleShare}
        />;
    }

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <MapSlot />

            {/* Shared app header box (logo + name + search + coordinates). */}
            <div className="pointer-events-auto absolute left-3 top-3 z-10">
                <AppHeaderBox />
            </div>

            {/* View switch (Itinéraire ↔ Studio LiDAR) + saved-routes gallery. */}
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <SavedRoutesGallery />
                <ViewSwitch />
            </div>

            {/* Bottom pill bar + resizable route/cliff editing panel. */}
            <RouteBottomBar />
        </div>
    );
}

