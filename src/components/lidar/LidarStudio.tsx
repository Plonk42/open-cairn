import { MapContainer } from '@/components/map/MapContainer';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { ShowcaseGallery } from './ShowcaseGallery';
import { OrbitTopBarButton, StudioBottomBar, StudioCaptureButton } from './StudioBottomBar';

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
                </div>
            </div>

            {/* Quitter */}
            <button
                type="button"
                onClick={onExit}
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

    return (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-3">
            <button
                type="button"
                onClick={handleRecenter}
                title={onScreen ? 'Recadrer sur le nuage LiDAR' : 'Le nuage est hors champ — cliquer pour le recadrer'}
                className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ring-1 backdrop-blur-md transition ${onScreen
                    ? 'bg-slate-950/80 text-slate-200 ring-white/15 hover:bg-slate-900/85'
                    : 'animate-pulse bg-amber-500/90 text-amber-950 ring-amber-300 hover:bg-amber-400'}`}
            >
                <LocateIcon className="h-4 w-4" />
                <span>{onScreen ? 'Nuage LiDAR' : 'Nuage hors champ'}</span>
                {(pointCount || triangleCount) ? (
                    <span className={onScreen ? 'text-slate-400' : 'text-amber-900/80'}>
                        {cloudStatsLabel(pointCount, triangleCount)}
                    </span>
                ) : null}
            </button>
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
    const [splashDismissed, setSplashDismissed] = useState(false);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const hasData = shaded !== null || mesh !== null;

    useStudioCameraIntro();

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

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
            <MapContainer />

            {showEmptyState && <StudioEmptyState onDismiss={() => setSplashDismissed(true)} />}

            <StudioTopBar onExit={() => setView('map')} />

            <StudioCloudLocator />

            <StudioBottomBar />

            <StudioCaptureButton />
        </div>
    );
}
