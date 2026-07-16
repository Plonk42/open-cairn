import { useEffect, useState } from 'react';
import { MapSlot } from './components/map/MapSlot';
import { MobileLayout } from './components/MobileLayout';
import { type MobileTab } from './components/panels/PanelTabs';
import { AppHeaderBox } from './components/shell/AppHeaderBox';
import { RouteBottomBar } from './components/shell/RouteBottomBar';
import { ViewSwitch } from './components/shell/ViewSwitch';
import { useIsMobile } from './lib/useIsMobile';
import { useShare } from './lib/useShare';
import { useMapStore } from './stores/mapStore';

export function App() {
    const isMobile = useIsMobile();
    const { shareTooltip, handleShare } = useShare();
    const [mobileTab, setMobileTab] = useState<MobileTab>('map');
    const uiTheme = useMapStore((s) => s.uiTheme);

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
        <div className="relative h-screen w-screen overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <MapSlot />

            {/* Shared app header box (logo + name + search + coordinates). */}
            <div className="pointer-events-auto absolute left-3 top-3 z-10">
                <AppHeaderBox />
            </div>

            {/* View switch (Itinéraire ↔ Studio LiDAR). */}
            <div className="absolute right-3 top-3 z-10">
                <ViewSwitch />
            </div>

            {/* Bottom pill bar + resizable route/cliff editing panel. */}
            <RouteBottomBar />
        </div>
    );
}

