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

            {/* Top bar — same layout as the Studio: shared header box on the
                left, an action group (Itinéraires) beside it, and the view
                switch pinned right, so the chrome stays put across a switch. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-3 py-2.5">
                <div className="pointer-events-auto">
                    <AppHeaderBox />
                </div>
                <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10">
                    <SavedRoutesGallery />
                </div>
                <div className="pointer-events-auto ml-auto">
                    <ViewSwitch />
                </div>
            </div>

            {/* Bottom pill bar + resizable route/cliff editing panel. */}
            <RouteBottomBar />
        </div>
    );
}

