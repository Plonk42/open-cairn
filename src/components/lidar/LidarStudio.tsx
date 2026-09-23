import { MapSlot } from '@/components/map/MapSlot';
import { AppHeaderBox } from '@/components/shell/AppHeaderBox';
import { MobileActionsMenu } from '@/components/shell/MobileActionsMenu';
import { MobileToolbar } from '@/components/shell/MobileToolbar';
import { MobileTopBar } from '@/components/shell/MobileTopBar';
import { TopBarActions } from '@/components/shell/TopBarActions';
import { ViewSwitch } from '@/components/shell/ViewSwitch';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMapStore } from '@/stores/mapStore';
import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { StudioCaptureButton } from './StudioCaptureButton';
import { StudioCloudLocator } from './StudioClouds';
import { ResetSettingsButton, STUDIO_RENDER_SETTINGS } from './StudioRenderSettings';
import { StudioSidePanel } from './StudioSidePanel';
import { StudioTutorial } from './tutorial/StudioTutorial';

/** One-shot cinematic camera tilt when entering the studio with a loaded cloud. */
function useStudioCameraIntro() {
    useEffect(() => {
        let done = false;
        const run = (map: maplibregl.Map | null) => {
            if (done || !map) return;
            done = true;
            const { lidarShaded, lidarMesh } = useMapStore.getState();
            if (lidarShaded === null && lidarMesh === null) return;
            map.easeTo({
                pitch: Math.max(map.getPitch(), 55),
                duration: 1200,
                easing: (t) => t * (2 - t),
            });
        };
        const existing = useMapStore.getState().mapInstance;
        if (existing) {
            run(existing);
            return;
        }
        const unsub = useMapStore.subscribe((s) => {
            if (s.mapInstance) {
                run(s.mapInstance);
                unsub();
            }
        });
        return unsub;
    }, []);
}

/**
 * Desktop top bar. Same composition as the Itinéraire view: header box, camera
 * and scene action groups, view switch. It doesn't step aside for the side
 * panel — the panel starts below it (`PANEL_TOP_PX`), so the two never overlap.
 */
function StudioTopBar({ onHelp }: Readonly<{ onHelp: () => void }>) {
    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start gap-3 px-3 py-2.5">
            {/* Shared app header box (logo + name + search + coordinates). */}
            <div className="pointer-events-auto">
                <AppHeaderBox />
            </div>

            {/* Caméra + galerie / export de scène / aide. */}
            <TopBarActions view="lidar" exportSlot={<ShowcaseExport />} onHelp={onHelp} />

            {/* View switch (replaces the old "Quitter le studio" button). */}
            <div data-tutorial="exit" className="pointer-events-auto ml-auto">
                <ViewSwitch />
            </div>
        </div>
    );
}

/**
 * Mobile LiDAR Studio shell. Same persistent map + cloud state as the desktop
 * studio, presented with the shared mobile chrome: the compact top bar (with a
 * `⋯` menu holding the galleries + scene export) and the generic bottom toolbar
 * of render-setting sheets. Capture keeps its floating FAB — raised above the
 * toolbar — with the cloud locator stacked just above it.
 */
function StudioMobileShell() {
    const [activeId, setActiveId] = useState<string | null>(null);
    const handleSelect = (id: string) => setActiveId((cur) => (cur === id ? null : id));

    return (
        <div className="relative h-[100dvh] w-screen overflow-hidden bg-slate-950">
            <MapSlot />
            <MobileTopBar actions={<MobileActionsMenu view="lidar" exportSlot={<ShowcaseExport />} />} />
            {/* The floating capture FAB + cloud locator only show over the bare
                map, so an open render sheet never fights them for the bottom. */}
            {activeId === null && (
                <>
                    <StudioCloudLocator anchorClassName="bottom-36 right-4" />
                    <StudioCaptureButton anchor={{ bottom: 80, right: 16 }} />
                </>
            )}
            <MobileToolbar
                tools={STUDIO_RENDER_SETTINGS}
                activeId={activeId}
                onSelect={handleSelect}
                trailing={<ResetSettingsButton />}
            />
        </div>
    );
}

/**
 * Dedicated full-screen LiDAR Studio shell (`?view=lidar`). Reuses the shared
 * MapContainer + mapStore so the 3D cloud state carries over from the classic
 * map view. On desktop the settings live in one right-hand accordion
 * (`StudioSidePanel`) and capture keeps its own green button at the bottom;
 * the map keeps the whole remaining width.
 */
export function LidarStudio() {
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const tutorialSeen = useMapStore((s) => s.studioTutorialSeen);
    const setTutorialSeen = useMapStore((s) => s.setStudioTutorialSeen);
    const panelCollapsed = useMapStore((s) => s.studioPanelCollapsed);
    const hasData = shaded !== null || mesh !== null;
    const isMobile = useIsMobile();

    const [tutorialOpen, setTutorialOpen] = useState(false);

    useStudioCameraIntro();

    // Auto-launch the onboarding tutorial once, on a newcomer's first visit,
    // and only when nothing is loaded yet (a shared link with a cloud skips it).
    // Runs a single time per mount — loading a cloud mid-tutorial won't reopen.
    // Desktop only: the tutorial spotlights desktop chrome, absent on mobile.
    useEffect(() => {
        if (!tutorialSeen && !hasData && !loading && !isMobile) setTutorialOpen(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const closeTutorial = () => {
        setTutorialOpen(false);
        setTutorialSeen(true);
    };

    if (isMobile) return <StudioMobileShell />;

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
            <MapSlot />

            <StudioTopBar onHelp={() => setTutorialOpen(true)} />

            <StudioSidePanel />

            {/* Capturing and tuning the render are never done together. */}
            <StudioCaptureButton anchor={{ bottom: 16, right: 16 }} hidden={!panelCollapsed} />

            <StudioTutorial open={tutorialOpen} onClose={closeTutorial} />
        </div>
    );
}
