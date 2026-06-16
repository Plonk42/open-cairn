import { MapContainer } from '@/components/map/MapContainer';
import { LidarAppearanceControls } from '@/components/ui/lidar/LidarAppearanceControls';
import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { LidarEffectsControls } from '@/components/ui/lidar/LidarEffectsControls';
import { LidarLightingControls } from '@/components/ui/lidar/LidarLightingControls';
import { OrbitControl } from '@/components/ui/lidar/OrbitControl';
import { useIsMobile } from '@/lib/useIsMobile';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { ShowcaseGallery } from './ShowcaseGallery';
import { DockSection, QuickBasemapSwitch } from './StudioControls';

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
            <div className="pointer-events-auto relative max-w-sm rounded-2xl bg-slate-900/70 p-6 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
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
    dockOpen,
    onToggleDock,
}: Readonly<{ onExit: () => void; dockOpen: boolean; onToggleDock: () => void }>) {
    const load = useMapStore((s) => s.loadLidarCloud);
    const loading = useMapStore((s) => s.lidarCloudLoading);
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
            </div>

            <div className="ml-auto flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => { load(); }}
                    disabled={loading}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-400 disabled:opacity-50"
                >
                    {loading ? 'Chargement…' : 'Charger ici'}
                </button>
                <button
                    type="button"
                    onClick={onToggleDock}
                    aria-pressed={dockOpen}
                    title={dockOpen ? 'Masquer le panneau de réglages' : 'Afficher le panneau de réglages'}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${dockOpen
                        ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40 hover:bg-emerald-500/30'
                        : 'bg-white/5 text-slate-200 ring-white/15 hover:bg-white/10'
                        }`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9.5-.5v11H15a.5.5 0 00.5-.5V5a.5.5 0 00-.5-.5h-2.5z" clipRule="evenodd" />
                    </svg>
                    Réglages
                </button>
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

function StudioDock({ onClose, isMobile }: Readonly<{ onClose: () => void; isMobile: boolean }>) {
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const hasData = shaded !== null || mesh !== null;

    const widthCls = isMobile ? 'w-full' : 'w-[340px]';
    return (
        <aside className={`dark pointer-events-auto absolute right-0 top-0 z-20 flex h-full ${widthCls} flex-col bg-slate-950/80 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md`}>
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                <h2 className="text-sm font-semibold text-white">Réglages</h2>
                <button
                    type="button"
                    onClick={onClose}
                    title="Réduire le panneau"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                <div className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2.5">
                    <OrbitControl />
                </div>
                <DockSection title="Capture" defaultOpen>
                    <LidarCaptureControls showProgress={false} />
                </DockSection>
                <DockSection title="Apparence" defaultOpen={hasData}>
                    <LidarAppearanceControls />
                </DockSection>
                <DockSection title="Lumière">
                    <LidarLightingControls />
                </DockSection>
                <DockSection title="Effets">
                    <LidarEffectsControls />
                </DockSection>
            </div>
        </aside>
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
    const [dockOpen, setDockOpen] = useState(true);
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

    const showEmptyState = !hasData && !loading && !splashDismissed;

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
            <MapContainer />

            {/* Extension slots (scaffolded, intentionally empty in phase 1):
                - left tool-rail: mesures / annotations / coupe falaise
                - bottom strip: coupe falaise / timeline cinématique */}

            {showEmptyState && <StudioEmptyState onDismiss={() => setSplashDismissed(true)} />}

            <StudioTopBar
                onExit={() => setView('map')}
                dockOpen={dockOpen}
                onToggleDock={() => setDockOpen((o) => !o)}
            />

            {dockOpen && (
                <StudioDock onClose={() => setDockOpen(false)} isMobile={isMobile} />
            )}
        </div>
    );
}
