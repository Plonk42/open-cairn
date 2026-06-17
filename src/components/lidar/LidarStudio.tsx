import { MapContainer } from '@/components/map/MapContainer';
import { useIsMobile } from '@/lib/useIsMobile';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { ShowcaseGallery } from './ShowcaseGallery';
import { QuickBasemapSwitch } from './StudioControls';
import { OrbitTopBarButton, StudioSettings, type StudioCategoryId } from './StudioSettingsDock';

// Forces the contextual orthophoto base map once per page load when the studio
// is first opened (mountain context reads best over imagery), without fighting
// the user's later choices via the quick switch.
let studioBaseInitialized = false;

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
 * Show the red footprint preview rectangle only while the studio is open and no
 * cloud is loaded yet; hide it as soon as a render is displayed, and clear it on
 * exit so it never lingers over the classic map view.
 */
function useStudioPreviewSync(hasData: boolean) {
    useEffect(() => {
        useMapStore.getState().setLidarPreviewVisible(!hasData);
    }, [hasData]);
    useEffect(() => {
        return () => useMapStore.getState().setLidarPreviewVisible(false);
    }, []);
}

function StudioEmptyState({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
    return (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div
                className="pointer-events-auto relative max-w-sm rounded-2xl bg-slate-900/70 p-6 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    onClick={onDismiss}
                    title="Fermer"
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                </button>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                        <circle cx="4" cy="6" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="16" cy="7" r="1.2" />
                        <circle cx="6" cy="11" r="1.2" /><circle cx="13" cy="12" r="1.2" /><circle cx="4" cy="16" r="1.2" />
                        <circle cx="11" cy="17" r="1.2" /><circle cx="17" cy="14" r="1.2" />
                    </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Studio LiDAR</h2>
                <p className="mt-1 text-sm text-slate-300">
                    Centrez la carte sur une zone de montagne, puis utilisez « Charger ici » ou le panneau de réglages pour explorer le relief en 3D.
                </p>
            </div>
        </div>
    );
}

function StudioTopBar({
    onExit,
}: Readonly<{ onExit: () => void }>) {
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-slate-950/80 to-transparent px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <circle cx="4" cy="6" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="16" cy="7" r="1.2" />
                        <circle cx="6" cy="11" r="1.2" /><circle cx="13" cy="12" r="1.2" /><circle cx="4" cy="16" r="1.2" />
                        <circle cx="11" cy="17" r="1.2" /><circle cx="17" cy="14" r="1.2" />
                    </svg>
                </span>
                <span>Studio LiDAR</span>
            </div>

            <div className="ml-2 hidden md:block">
                <QuickBasemapSwitch />
            </div>

            {/* Showcase : galerie et export. */}
            <div className="ml-2 hidden items-center gap-2 md:flex">
                <ShowcaseGallery />
                <ShowcaseExport />
                <OrbitTopBarButton />
            </div>

            <div className="ml-auto flex items-center gap-2">
                <button
                    type="button"
                    onClick={onExit}
                    className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10"
                >
                    Quitter le studio
                </button>
            </div>
        </div>
    );
}

/**
 * Dedicated full-screen LiDAR Studio shell (`?view=lidar`). Reuses the shared
 * MapContainer + mapStore so the 3D cloud state carries over from the classic
 * map view, and composes the extracted control bricks into a retractable dock.
 */
export function LidarStudio() {
    const { setView } = useView();
    const isMobile = useIsMobile();
    const [activeCategory, setActiveCategory] = useState<StudioCategoryId | null>(null);
    const [splashDismissed, setSplashDismissed] = useState(false);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const hasData = shaded !== null || mesh !== null;

    useStudioCameraIntro();
    useStudioPreviewSync(hasData);

    useEffect(() => {
        if (studioBaseInitialized) return;
        studioBaseInitialized = true;
        useMapStore.getState().setBaseLayer('ortho');
    }, []);

    // Once a cloud has loaded (or is loading), the welcome popup is permanently
    // dismissed — clicking "Effacer" must NOT bring it back.
    useEffect(() => {
        if (hasData || loading) setSplashDismissed(true);
    }, [hasData, loading]);

    const showEmptyState = !hasData && !loading && !splashDismissed;

    // Dismiss the welcome popup as soon as the user interacts anywhere else.
    // Bubble phase + the card stopping its own pointerdown means clicks inside
    // the card don't dismiss, while any outside click (map, rail, top bar) does.
    useEffect(() => {
        if (!showEmptyState) return;
        const dismiss = () => setSplashDismissed(true);
        globalThis.addEventListener('pointerdown', dismiss);
        return () => globalThis.removeEventListener('pointerdown', dismiss);
    }, [showEmptyState]);

    const selectCategory = (id: StudioCategoryId) =>
        setActiveCategory((cur) => (cur === id ? null : id));

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
            <MapContainer />

            {showEmptyState && <StudioEmptyState onDismiss={() => setSplashDismissed(true)} />}

            <StudioTopBar onExit={() => setView('map')} />

            <StudioSettings isMobile={isMobile} active={activeCategory} onSelect={selectCategory} />
        </div>
    );
}
