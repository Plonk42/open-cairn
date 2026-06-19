import { MapContainer } from '@/components/map/MapContainer';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { ShowcaseGallery } from './ShowcaseGallery';
import { OrbitTopBarButton, StudioBottomBar, StudioCaptureButton } from './StudioBottomBar';
import { StudioTutorial } from './tutorial/StudioTutorial';

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

function StudioTopBar({
    onExit,
    onHelp,
}: Readonly<{ onExit: () => void; onHelp: () => void }>) {
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-3 py-2.5">
            {/* Groupe gauche : Studio LiDAR + Orbite + Export + Galerie */}
            <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/85 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                <div className="flex items-center gap-2 px-1.5 text-sm font-semibold text-white">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <circle cx="4" cy="6" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="16" cy="7" r="1.2" />
                            <circle cx="6" cy="11" r="1.2" /><circle cx="13" cy="12" r="1.2" /><circle cx="4" cy="16" r="1.2" />
                            <circle cx="11" cy="17" r="1.2" /><circle cx="17" cy="14" r="1.2" />
                        </svg>
                    </span>
                    <span>Studio LiDAR</span>
                </div>

                {/* Showcase : galerie et export (desktop uniquement). */}
                <div className="mx-0.5 hidden h-6 w-px bg-white/15 md:block" />
                <div className="hidden items-center gap-1.5 md:flex">
                    <OrbitTopBarButton />
                    <ShowcaseExport />
                    <ShowcaseGallery />
                    <button
                        type="button"
                        onClick={onHelp}
                        title="Revoir le tutoriel"
                        aria-label="Revoir le tutoriel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.94 6.94a1.5 1.5 0 0 1 2.56 1.06c0 .58-.34.92-.93 1.36-.66.5-1.07 1-1.07 1.89v.25a.75.75 0 0 0 1.5 0v-.16c0-.4.18-.62.74-1.04.66-.5 1.26-1.13 1.26-2.3a3 3 0 0 0-5.86-.9.75.75 0 0 0 1.43.46c.04-.13.1-.26.18-.38ZM10 15.25a.94.94 0 1 0 0-1.88.94.94 0 0 0 0 1.88Z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Quitter */}
            <button
                type="button"
                onClick={onExit}
                data-tutorial="exit"
                className="ml-auto inline-flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-3 text-xs font-medium text-slate-200 shadow-2xl ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                    <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-1.07a.75.75 0 1 0-1.004-1.11l-2.5 2.25a.75.75 0 0 0 0 1.11l2.5 2.25a.75.75 0 1 0 1.004-1.11L8.704 10.75h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
                </svg>
                Quitter le studio
            </button>
        </div>
    );
}

/** Compact human count, e.g. 2461016 → "2.5 M", 129399 → "129 k". */
function formatCloudCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
    return String(n);
}

function cloudStatsLabel(points: number | null, triangles: number | null): string {
    const parts: string[] = [];
    if (triangles) parts.push(`${formatCloudCount(triangles)} tri`);
    if (points) parts.push(`${formatCloudCount(points)} pts`);
    return parts.join(' · ');
}

/** True when the cloud center currently sits inside the visible map bounds. */
function isCloudOnScreen(map: maplibregl.Map, lng: number, lat: number): boolean {
    // `map.project()` can't be used here: with 3D terrain forced on, it projects
    // the point at elevation 0 (sea level) — for ground sitting ~1800 m up that
    // lands far off-screen even when centered. The 2D geographic bounds ignore
    // elevation and give a reliable (slightly conservative) visibility test.
    return map.getBounds().contains([lng, lat]);
}

/** Recenter + frame the loaded cloud so its diameter fills ~60% of the view. */
function frameCloud(map: maplibregl.Map, lng: number, lat: number, radius: number): void {
    const minDim = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
    const targetMpp = (2 * radius) / (0.6 * minDim);
    const worldMpp = 156543.03 * Math.cos((lat * Math.PI) / 180);
    const zoom = Math.log2(worldMpp / targetMpp);
    // With 3D terrain forced on, easeTo carries over the *start* center
    // elevation and never recomputes it for the destination, so the camera
    // target ends up above/below the relief and the cloud isn't framed. Pre-
    // seeding the destination's center elevation before the move makes the
    // flight land synced to the relief (same fix as the showcase gallery).
    if (map.getTerrain()) {
        const elevation = map.queryTerrainElevation([lng, lat]);
        if (typeof elevation === 'number' && Number.isFinite(elevation)) {
            map.setCenterElevation(elevation);
        }
    }
    map.easeTo({
        center: [lng, lat],
        zoom: Math.min(map.getMaxZoom(), Math.max(12, zoom)),
        duration: 900,
        easing: (t) => t * (2 - t),
    });
}

function LocateIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="4" />
            <path strokeLinecap="round" d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18" />
        </svg>
    );
}

function TrashIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 5h13M8 5V3.5h4V5M5 5l.7 10.5a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4L15 5M8.5 8.5v5M11.5 8.5v5" />
        </svg>
    );
}

/**
 * Floating affordance that makes a loaded LiDAR cloud discoverable. With
 * frustum culling, an off-screen cloud is no longer drawn — so without a cue
 * the user can't tell anything is loaded. This pill always signals a loaded
 * cloud (with its point/triangle counts) and, when the cloud drifts out of
 * view, switches to an amber "hors champ" alert; clicking always reframes it.
 */
function StudioCloudLocator() {
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const source = mesh ?? shaded;
    const lng = source?.centerLng ?? null;
    const lat = source?.centerLat ?? null;
    const radius = source?.radius ?? null;
    const pointCount = shaded?.pointCount ?? null;
    const triangleCount = mesh?.triangleCount ?? null;

    const [onScreen, setOnScreen] = useState(true);

    useEffect(() => {
        if (lng === null || lat === null) return;
        const map = useMapStore.getState().mapInstance;
        if (!map) return;
        const update = () => setOnScreen(isCloudOnScreen(map, lng, lat));
        update();
        map.on('move', update);
        map.on('moveend', update);
        return () => {
            map.off('move', update);
            map.off('moveend', update);
        };
    }, [lng, lat]);

    if (lng === null || lat === null || radius === null) return null;

    const handleRecenter = () => {
        const map = useMapStore.getState().mapInstance;
        if (map) frameCloud(map, lng, lat, radius);
    };

    const handleClear = () => {
        useMapStore.getState().clearLidarCloud();
    };

    return (
        <div className="pointer-events-none absolute bottom-6 right-24 z-30 flex justify-end">
            <div
                className={`pointer-events-auto inline-flex items-center gap-1 rounded-full py-1 pl-1 pr-1 text-xs font-medium shadow-lg ring-1 backdrop-blur-md transition ${onScreen
                    ? 'bg-slate-950/80 text-slate-200 ring-white/15'
                    : 'animate-pulse bg-amber-500/90 text-amber-950 ring-amber-300'}`}
            >
                <button
                    type="button"
                    onClick={handleRecenter}
                    title={onScreen ? 'Recadrer sur le nuage LiDAR' : 'Le nuage est hors champ — cliquer pour le recadrer'}
                    className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 transition ${onScreen ? 'hover:bg-white/10' : 'hover:bg-amber-400'}`}
                >
                    <LocateIcon className="h-4 w-4" />
                    <span>{onScreen ? 'Nuage LiDAR' : 'Nuage hors champ'}</span>
                    {(pointCount || triangleCount) ? (
                        <span className={onScreen ? 'text-slate-400' : 'text-amber-900/80'}>
                            {cloudStatsLabel(pointCount, triangleCount)}
                        </span>
                    ) : null}
                </button>
                <span className={`h-4 w-px ${onScreen ? 'bg-white/15' : 'bg-amber-900/30'}`} aria-hidden="true" />
                <button
                    type="button"
                    onClick={handleClear}
                    title="Effacer le nuage LiDAR"
                    aria-label="Effacer le nuage LiDAR"
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${onScreen ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-amber-900 hover:bg-amber-400'}`}
                >
                    <TrashIcon className="h-4 w-4" />
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
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const tutorialSeen = useMapStore((s) => s.studioTutorialSeen);
    const setTutorialSeen = useMapStore((s) => s.setStudioTutorialSeen);
    const hasData = shaded !== null || mesh !== null;

    const [tutorialOpen, setTutorialOpen] = useState(false);

    useStudioCameraIntro();

    useEffect(() => {
        if (studioBaseInitialized) return;
        studioBaseInitialized = true;
        useMapStore.getState().setBaseLayer('ortho');
    }, []);

    // Auto-launch the onboarding tutorial once, on a newcomer's first visit,
    // and only when nothing is loaded yet (a shared link with a cloud skips it).
    // Runs a single time per mount — loading a cloud mid-tutorial won't reopen.
    useEffect(() => {
        if (!tutorialSeen && !hasData && !loading) setTutorialOpen(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const closeTutorial = () => {
        setTutorialOpen(false);
        setTutorialSeen(true);
    };

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
            <MapContainer />

            <StudioTopBar onExit={() => setView('map')} onHelp={() => setTutorialOpen(true)} />

            <StudioCloudLocator />

            <StudioBottomBar />

            <StudioCaptureButton />

            <StudioTutorial open={tutorialOpen} onClose={closeTutorial} />
        </div>
    );
}
