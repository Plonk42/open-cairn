import { EyeIcon, EyeOffIcon, PopoverCloseIcon } from '@/components/icons/LidarIcons';
import { useMapStore } from '@/stores/mapStore';
import type { LoadedLidarCloud } from '@/stores/slices/lidarSlice';
import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState, type ReactElement } from 'react';

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

const EQUATOR_METERS = 40_075_016.686;
/** MapLibre's zoom is defined on 512 px tiles: `worldSize = 512 · 2^zoom`. */
const TILE_SIZE = 512;

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
    const worldMeters = EQUATOR_METERS * Math.cos((lat * Math.PI) / 180);
    const zoom = Math.log2(worldMeters / (TILE_SIZE * targetMpp));
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

/**
 * Tracks, for every loaded cloud, whether its footprint currently overlaps the
 * viewport. Shared by the mobile locator pill and the desktop panel section:
 * two different affordances, one answer.
 */
export function useCloudsOnScreen(clouds: readonly LoadedLidarCloud[]): Record<string, boolean> {
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

    return onScreenById;
}

/** One row of the cloud list: recenter / show-hide / delete. */
function CloudListRow({ cloud, onScreen }: Readonly<{ cloud: LoadedLidarCloud; onScreen: boolean }>) {
    const footprint = cloudFootprint(cloud);
    const pointCount = cloud.shaded?.pointCount ?? null;
    const triangleCount = cloud.mesh?.triangleCount ?? null;

    const handleRecenter = () => {
        const map = useMapStore.getState().mapInstance;
        if (map && footprint) frameCloud(map, footprint.lng, footprint.lat, footprint.radius);
    };

    return (
        <div className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-black/5 dark:hover:bg-white/5">
            <button
                type="button"
                onClick={handleRecenter}
                title={onScreen ? 'Recadrer sur ce nuage' : 'Ce nuage est hors champ — cliquer pour le recadrer'}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
                <LocateIcon className={`h-3.5 w-3.5 shrink-0 ${onScreen ? 'text-slate-400' : 'text-amber-500'}`} />
                <span className="truncate text-slate-700 dark:text-slate-200">{cloudStatsLabel(pointCount, triangleCount) || 'Nuage'}</span>
            </button>
            <button
                type="button"
                onClick={() => useMapStore.getState().toggleLidarCloudVisible(cloud.id)}
                title={cloud.visible ? 'Cacher ce nuage' : 'Afficher ce nuage'}
                aria-label={cloud.visible ? 'Cacher ce nuage' : 'Afficher ce nuage'}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-black/10 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
                {cloud.visible ? <EyeIcon className="h-4 w-4" /> : <EyeOffIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
            </button>
            <button
                type="button"
                onClick={() => useMapStore.getState().removeLidarCloud(cloud.id)}
                title="Supprimer ce nuage"
                aria-label="Supprimer ce nuage"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-black/10 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
                <TrashIcon className="h-3.5 w-3.5" />
            </button>
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

/** Footer actions shown once more than one cloud is loaded. */
function CloudListActions({ clouds }: Readonly<{ clouds: readonly LoadedLidarCloud[] }>) {
    return (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-black/5 pt-1.5 dark:border-white/10">
            <button
                type="button"
                onClick={() => frameAllClouds(clouds)}
                className="flex-1 rounded-md px-2 py-1 text-center text-slate-600 transition hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
                Tout recentrer
            </button>
            <button
                type="button"
                onClick={() => useMapStore.getState().clearAllLidarClouds()}
                className="flex-1 rounded-md px-2 py-1 text-center text-slate-600 transition hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
                Tout effacer
            </button>
        </div>
    );
}

/**
 * Desktop side-panel body listing every loaded cloud. The off-screen cue moves
 * from the floating pill's amber pulse to the per-row locate glyph plus the
 * section badge, since the panel itself is always visible.
 */
export function StudioCloudList({ clouds, onScreenById }: Readonly<{
    clouds: readonly LoadedLidarCloud[];
    onScreenById: Record<string, boolean>;
}>): ReactElement {
    if (clouds.length === 0) {
        return (
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
                Aucun nuage chargé. Dessinez une zone dans « Capture » pour en créer un.
            </p>
        );
    }
    return (
        <div className="text-xs">
            {clouds.length > 6 && (
                <p className="px-1 pb-1.5 text-[10px] text-amber-600 dark:text-amber-300">
                    Beaucoup de nuages chargés — la performance peut en pâtir.
                </p>
            )}
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {clouds.map((cloud) => (
                    <CloudListRow key={cloud.id} cloud={cloud} onScreen={onScreenById[cloud.id] ?? true} />
                ))}
            </div>
            {clouds.length > 1 && <CloudListActions clouds={clouds} />}
        </div>
    );
}

/** Single-cloud pill: compact mobile layout (recenter + delete). */
function SingleCloudPill({ cloud, onScreen, anchorClassName }: Readonly<{ cloud: LoadedLidarCloud; onScreen: boolean; anchorClassName: string }>) {
    const footprint = cloudFootprint(cloud);
    const pointCount = cloud.shaded?.pointCount ?? null;
    const triangleCount = cloud.mesh?.triangleCount ?? null;
    if (!footprint) return null;

    const handleRecenter = () => {
        const map = useMapStore.getState().mapInstance;
        if (map) frameCloud(map, footprint.lng, footprint.lat, footprint.radius);
    };

    return (
        <div className={`pointer-events-none absolute z-30 flex justify-end ${anchorClassName}`}>
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

/** Expanded panel content of the multi-cloud pill: header + rows + footer actions. */
function CloudListPanel({
    clouds, onScreenById, onCollapse,
}: Readonly<{ clouds: readonly LoadedLidarCloud[]; onScreenById: Record<string, boolean>; onCollapse: () => void }>) {
    return (
        <div className="pointer-events-auto w-64 max-w-[80vw] rounded-2xl bg-slate-950/90 p-2 text-xs text-slate-200 shadow-2xl ring-1 ring-white/15 backdrop-blur-md">
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
            <StudioCloudList clouds={clouds} onScreenById={onScreenById} />
        </div>
    );
}

/** Multi-cloud pill: count badge that expands into the full list. */
function MultiCloudPill({
    clouds, onScreenById, anchorClassName,
}: Readonly<{ clouds: readonly LoadedLidarCloud[]; onScreenById: Record<string, boolean>; anchorClassName: string }>) {
    const [expanded, setExpanded] = useState(false);
    const anyOnScreen = clouds.some((c) => onScreenById[c.id]);

    return (
        <div className={`pointer-events-none absolute z-30 flex flex-col items-end gap-2 ${anchorClassName}`}>
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
 * Floating affordance that makes loaded LiDAR clouds discoverable on the
 * mobile shell, where there is no permanent panel. With frustum culling, an
 * off-screen cloud is no longer drawn — so without a cue the user can't tell
 * anything is loaded. A single cloud keeps the compact pill (recenter +
 * delete); a second one collapses it into a count badge that expands into the
 * full list.
 */
export function StudioCloudLocator({ anchorClassName = 'bottom-20 right-4' }: Readonly<{ anchorClassName?: string }>) {
    const clouds = useMapStore((s) => s.lidarClouds);
    const onScreenById = useCloudsOnScreen(clouds);

    if (clouds.length === 0) return null;
    if (clouds.length === 1) {
        return <SingleCloudPill cloud={clouds[0]} onScreen={onScreenById[clouds[0].id] ?? true} anchorClassName={anchorClassName} />;
    }
    return <MultiCloudPill clouds={clouds} onScreenById={onScreenById} anchorClassName={anchorClassName} />;
}
