import { MapSlot } from './components/map/MapSlot';
import { MobileLayout } from './components/MobileLayout';
import { AppHeaderBox } from './components/shell/AppHeaderBox';
import { RouteBottomBar } from './components/shell/RouteBottomBar';
import { RouteDock } from './components/shell/RouteDock';
import { RouteExportButton } from './components/shell/RouteExportButton';
import { RouteShareButton } from './components/shell/RouteShareButton';
import { TopBarActions } from './components/shell/TopBarActions';
import { ViewSwitch } from './components/shell/ViewSwitch';
import { useIsMobile } from './lib/useIsMobile';

export function App() {
    const isMobile = useIsMobile();

    if (isMobile) {
        return <MobileLayout />;
    }

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Map area — the route dock below shrinks it instead of covering
                it, so the terrain under the current route stays readable. */}
            <div className="relative min-h-0 flex-1">
                <MapSlot />

                {/* Top bar — same layout as the Studio: shared header box on the
                    left, the shared action group beside it, and the view switch
                    pinned right, so the chrome stays put across a switch. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-3 py-2.5">
                    <div className="pointer-events-auto">
                        <AppHeaderBox />
                    </div>
                    <TopBarActions view="map" exportSlot={<><RouteExportButton /><RouteShareButton /></>} />
                    <div className="pointer-events-auto ml-auto">
                        <ViewSwitch />
                    </div>
                </div>

                {/* Bottom pill bar (map styling + the Itinéraire toggle). */}
                <RouteBottomBar />
            </div>

            {/* Docked route/elevation panel. */}
            <RouteDock />
        </div>
    );
}

