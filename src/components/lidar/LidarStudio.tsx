import { EyeIcon, EyeOffIcon, PopoverCloseIcon } from '@/components/icons/LidarIcons';
import { MapSlot } from '@/components/map/MapSlot';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import type { LoadedLidarCloud } from '@/stores/slices/lidarSlice';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { ShowcaseExport } from './ShowcaseExport';
import { ShowcaseGallery } from './ShowcaseGallery';
import { OrbitTopBarButton, StudioBottomBar, StudioCaptureButton } from './StudioBottomBar';
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

                {/* Showcase : galerie et export. */}
                <div className="mx-0.5 h-6 w-px bg-white/15" />
                <div className="flex items-center gap-1.5">
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

/** Metres-per-degree of latitude, used to convert the cloud radius to a lng/lat footprint. */
const METERS_PER_DEGREE_LAT = 111_319.491;

/**
 * Approximate lng/lat bounding box of the cloud's footprint (a radius-metre
 * square around its centre), used for the on-screen test below.
 */
function cloudFootprintBounds(lng: number, lat: number, radius: number): [[number, number], [number, number]] {
    const dLat = radius / METERS_PER_DEGREE_LAT;
    const dLng = radius / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
    return [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat + dLat],
    ];
}

/**
 * True when the cloud's footprint (not just its centre point) overlaps the
 * visible map bounds. A point-only test (`bounds.contains([lng,lat])`) was
 * tried first but is inconsistent with what's actually rendered: a cloud can
 * have a large radius, so its centre can drift off-screen while its edge
 * (still drawn — the WebGL layer culls on the full bbox, not the centre) is
 * still visible, and vice-versa. Testing footprint-vs-viewport intersection
 * matches the layer's own bbox-based frustum cull far more closely.
 */
function isCloudOnScreen(map: maplibregl.Map, lng: number, lat: number, radius: number): boolean {
    // `map.project()` can't be used here: with 3D terrain forced on, it projects
    // the point at elevation 0 (sea level) — for ground sitting ~1800 m up that
    // lands far off-screen even when centered. The 2D geographic bounds ignore
    // elevation and give a reliable (slightly conservative) visibility test.
    return map.getBounds().intersects(cloudFootprintBounds(lng, lat, radius));
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

/** Loaded shaded-cloud or mesh footprint (centre + radius), or null if empty. */
function cloudFootprint(cloud: LoadedLidarCloud): { lng: number; lat: number; radius: number } | null {
    const source = cloud.mesh ?? cloud.shaded;
    if (!source) return null;
    return { lng: source.centerLng, lat: source.centerLat, radius: source.radius };
}

/** One row of the expanded multi-cloud list: recenter / show-hide / delete. */
function CloudListRow({ cloud, onScreen }: Readonly<{ cloud: LoadedLidarCloud; onScreen: boolean }>) {
    const footprint = cloudFootprint(cloud);
    const pointCount = cloud.shaded?.pointCount ?? null;
    const triangleCount = cloud.mesh?.triangleCount ?? null;

    const handleRecenter = () => {
        const map = useMapStore.getState().mapInstance;
        if (map && footprint) frameCloud(map, footprint.lng, footprint.lat, footprint.radius);
    };

    return (
        <div className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-white/5">
            <button
                type="button"
                onClick={handleRecenter}
                title={onScreen ? 'Recadrer sur ce nuage' : 'Ce nuage est hors champ — cliquer pour le recadrer'}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
                <LocateIcon className={`h-3.5 w-3.5 shrink-0 ${onScreen ? 'text-slate-400' : 'text-amber-400'}`} />
                <span className="truncate text-slate-200">{cloudStatsLabel(pointCount, triangleCount) || 'Nuage'}</span>
            </button>
            <button
                type="button"
                onClick={() => useMapStore.getState().toggleLidarCloudVisible(cloud.id)}
                title={cloud.visible ? 'Cacher ce nuage' : 'Afficher ce nuage'}
                aria-label={cloud.visible ? 'Cacher ce nuage' : 'Afficher ce nuage'}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
                {cloud.visible ? <EyeIcon className="h-4 w-4" /> : <EyeOffIcon className="h-4 w-4 text-slate-500" />}
            </button>
            <button
                type="button"
                onClick={() => useMapStore.getState().removeLidarCloud(cloud.id)}
                title="Supprimer ce nuage"
                aria-label="Supprimer ce nuage"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
                <TrashIcon className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

/** Single-cloud pill: today's familiar compact layout (recenter + delete). */
function SingleCloudPill({ cloud, onScreen }: Readonly<{ cloud: LoadedLidarCloud; onScreen: boolean }>) {
    const footprint = cloudFootprint(cloud);
    const pointCount = cloud.shaded?.pointCount ?? null;
    const triangleCount = cloud.mesh?.triangleCount ?? null;
    if (!footprint) return null;

    const handleRecenter = () => {
        const map = useMapStore.getState().mapInstance;
        if (map) frameCloud(map, footprint.lng, footprint.lat, footprint.radius);
    };

    return (
        <div className="pointer-events-none absolute bottom-20 right-4 z-30 flex justify-end">
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
                    onClick={() => useMapStore.getState().removeLidarCloud(cloud.id)}
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

/** Fit the map over the union of every visible cloud's footprint. */
function frameAllClouds(clouds: readonly LoadedLidarCloud[]): void {
    const map = useMapStore.getState().mapInstance;
    if (!map) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    let any = false;
    for (const cloud of clouds) {
        if (!cloud.visible) continue;
        const footprint = cloudFootprint(cloud);
        if (!footprint) continue;
        const [[loLng, loLat], [hiLng, hiLat]] = cloudFootprintBounds(footprint.lng, footprint.lat, footprint.radius);
        minLng = Math.min(minLng, loLng); minLat = Math.min(minLat, loLat);
        maxLng = Math.max(maxLng, hiLng); maxLat = Math.max(maxLat, hiLat);
        any = true;
    }
    if (any) map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 900 });
}

/** Expanded panel content of the multi-cloud pill: header + rows + footer actions. */
function CloudListPanel({
    clouds, onScreenById, onCollapse,
}: Readonly<{ clouds: readonly LoadedLidarCloud[]; onScreenById: Record<string, boolean>; onCollapse: () => void }>) {
    return (
        <div className="pointer-events-auto w-64 max-w-[80vw] rounded-2xl bg-slate-950/90 p-2 text-xs shadow-2xl ring-1 ring-white/15 backdrop-blur-md">
            <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="font-semibold text-white">{clouds.length} nuages LiDAR</span>
                <button
                    type="button"
                    onClick={onCollapse}
                    aria-label="Réduire"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
                >
                    <PopoverCloseIcon className="h-3 w-3" />
                </button>
            </div>
            {clouds.length > 6 && (
                <p className="px-1 pb-1.5 text-[10px] text-amber-300">
                    Beaucoup de nuages chargés — la performance peut en pâtir.
                </p>
            )}
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {clouds.map((cloud) => (
                    <CloudListRow key={cloud.id} cloud={cloud} onScreen={onScreenById[cloud.id] ?? true} />
                ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 border-t border-white/10 pt-1.5">
                <button
                    type="button"
                    onClick={() => frameAllClouds(clouds)}
                    className="flex-1 rounded-md px-2 py-1 text-center text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                    Tout recentrer
                </button>
                <button
                    type="button"
                    onClick={() => useMapStore.getState().clearAllLidarClouds()}
                    className="flex-1 rounded-md px-2 py-1 text-center text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                    Tout effacer
                </button>
            </div>
        </div>
    );
}

/** Multi-cloud pill: count badge that expands into the full list. */
function MultiCloudPill({
    clouds, onScreenById,
}: Readonly<{ clouds: readonly LoadedLidarCloud[]; onScreenById: Record<string, boolean> }>) {
    const [expanded, setExpanded] = useState(false);
    const anyOnScreen = clouds.some((c) => onScreenById[c.id]);

    return (
        <div className="pointer-events-none absolute bottom-20 right-4 z-30 flex flex-col items-end gap-2">
            {expanded && (
                <CloudListPanel clouds={clouds} onScreenById={onScreenById} onCollapse={() => setExpanded(false)} />
            )}
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                title={anyOnScreen ? 'Nuages LiDAR chargés' : 'Nuages LiDAR hors champ'}
                className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ring-1 backdrop-blur-md transition ${anyOnScreen
                    ? 'bg-slate-950/80 text-slate-200 ring-white/15 hover:bg-slate-900/80'
                    : 'animate-pulse bg-amber-500/90 text-amber-950 ring-amber-300 hover:bg-amber-400'}`}
            >
                <LocateIcon className="h-4 w-4" />
                <span>{clouds.length} nuages{anyOnScreen ? '' : ' hors champ'}</span>
            </button>
        </div>
    );
}

/**
 * Floating affordance that makes loaded LiDAR clouds discoverable. With
 * frustum culling, an off-screen cloud is no longer drawn — so without a cue
 * the user can't tell anything is loaded. With a single cloud loaded this
 * keeps the familiar compact pill (recenter + delete); once a second cloud is
 * loaded it collapses into a count badge that expands into the full list
 * (recenter / show-hide / delete per cloud, plus "tout recentrer"/"tout
 * effacer").
 */
function StudioCloudLocator() {
    const clouds = useMapStore((s) => s.lidarClouds);
    const [onScreenById, setOnScreenById] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const map = useMapStore.getState().mapInstance;
        if (!map || clouds.length === 0) return;
        const update = () => {
            const next: Record<string, boolean> = {};
            for (const cloud of clouds) {
                const footprint = cloudFootprint(cloud);
                if (footprint) next[cloud.id] = isCloudOnScreen(map, footprint.lng, footprint.lat, footprint.radius);
            }
            setOnScreenById(next);
        };
        update();
        map.on('move', update);
        map.on('moveend', update);
        return () => {
            map.off('move', update);
            map.off('moveend', update);
        };
    }, [clouds]);

    if (clouds.length === 0) return null;
    if (clouds.length === 1) {
        return <SingleCloudPill cloud={clouds[0]} onScreen={onScreenById[clouds[0].id] ?? true} />;
    }
    return <MultiCloudPill clouds={clouds} onScreenById={onScreenById} />;
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
            <MapSlot />

            <StudioTopBar onExit={() => setView('map')} onHelp={() => setTutorialOpen(true)} />

            <StudioCloudLocator />

            <StudioBottomBar />

            <StudioCaptureButton />

            <StudioTutorial open={tutorialOpen} onClose={closeTutorial} />
        </div>
    );
}
