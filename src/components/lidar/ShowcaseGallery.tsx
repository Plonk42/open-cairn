import { ignStaticMapUrl } from '@/lib/ign';
import {
    CLOUD_MODE_LABELS,
    clearAllSavedClouds,
    deleteSavedCloud,
    listSavedClouds,
    loadSavedCloudData,
    type SavedCloud,
} from '@/lib/savedClouds';
import {
    deleteSavedScene,
    importSceneFromZip,
    listSavedScenes,
    loadSavedSceneData,
    loadSavedSceneThumb,
    type SavedScene,
} from '@/lib/savedScenes';
import {
    fetchShowcaseManifest,
    loadShowcaseScene,
    showcaseScenePaths,
    type ShowcaseAmbiance,
    type ShowcaseCamera,
    type ShowcaseManifest,
    type ShowcaseScene,
} from '@/lib/showcaseScene';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

const INDEX_URL = `${import.meta.env.BASE_URL}showcase/index.json`;

function GalleryIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
        </svg>
    );
}

function resolveUrl(ref: string): string {
    if (/^https?:\/\//.test(ref) || ref.startsWith('/')) return ref;
    return `${import.meta.env.BASE_URL}${ref}`;
}

/** A gallery card: scene id + its loaded manifest + resolved asset URLs. */
interface GalleryEntry {
    id: string;
    title: string;
    description?: string;
    thumbUrl: string;
    geometryUrl: string;
    manifest: ShowcaseManifest;
}

/** Keep only non-empty string ids; warn about the rest. */
function sanitizeIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids: string[] = [];
    for (const item of raw) {
        if (typeof item === 'string' && item.length > 0) ids.push(item);
        else console.warn('showcase: entrée ignorée (id attendu)', item);
    }
    return ids;
}

/** Resolve one scene id to a gallery card by loading its sidecar manifest. */
async function buildEntry(id: string): Promise<GalleryEntry> {
    const paths = showcaseScenePaths(id);
    const manifest = await fetchShowcaseManifest(resolveUrl(paths.manifest));
    return {
        id,
        title: manifest.title || id,
        description: manifest.description,
        thumbUrl: resolveUrl(paths.thumb),
        geometryUrl: resolveUrl(paths.geometry),
        manifest,
    };
}

/**
 * Load the gallery: fetch the id list from `index.json`, then each scene's
 * manifest in parallel. Scenes whose manifest fails to load are skipped.
 */
async function loadGalleryEntries(): Promise<GalleryEntry[]> {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`Galerie indisponible (${res.status})`);
    const data = (await res.json()) as { scenes?: unknown };
    const ids = sanitizeIds(data.scenes);
    const settled = await Promise.allSettled(ids.map(buildEntry));
    const entries: GalleryEntry[] = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') entries.push(r.value);
        else console.warn('showcase: scène ignorée', r.reason);
    }
    return entries;
}

function applyAmbiance(a: ShowcaseAmbiance) {
    const st = useMapStore.getState();
    st.setLidarMode(a.lidarMode);
    st.setLidarShader(a.lidarShader);
    st.setLidarSunDate(a.lidarSunDate);
    st.setLidarShadows(a.lidarShadows);
    st.setLidarShadowStrength(a.lidarShadowStrength);
    st.setLidarCloudEdl(a.lidarCloudEdl);
    st.setLidarCloudEdlStrength(a.lidarCloudEdlStrength);
    st.setLidarCloudEdlRadius(a.lidarCloudEdlRadius);
    st.setLidarCloudEdlFarPlane(a.lidarCloudEdlFarPlane);
    st.setLidarCloudPointSize(a.lidarCloudPointSize);
    st.setLidarCloudSizeCompensation(a.lidarCloudSizeCompensation);
    st.setLidarCloudOpacity(a.lidarCloudOpacity);
    st.setLidarCloudPhotoOpacity(a.lidarCloudPhotoOpacity);
    // Backward compat: legacy scenes stored a `lidarCloudHideBasemap` boolean.
    const legacy = a as ShowcaseAmbiance & { lidarCloudHideBasemap?: boolean };
    st.setLidarCloudBasemapOpacity(
        legacy.lidarCloudBasemapOpacity ?? (legacy.lidarCloudHideBasemap ? 0.15 : 1),
    );
    st.setLidarCloudClasses(a.lidarCloudClasses);
}

function applyScene(scene: ShowcaseScene) {
    applyAmbiance(scene.ambiance);
    useMapStore.getState().showLidarCloudSnapshot({ shaded: scene.shaded, mesh: scene.mesh });
    const map = useMapStore.getState().mapInstance;
    if (map) {
        flyToScene(map, scene.camera);
    }
}

/**
 * Fly to the scene's saved camera, correctly framed over 3D terrain.
 *
 * With terrain on, `flyTo` carries over the *start* center elevation and never
 * recomputes it for the destination, so the camera target ends up above/below
 * the relief and the cloud isn't framed. Pre-seeding the destination's center
 * elevation *before* the flight makes `flyTo` retain it and land perfectly
 * synced — the elevation is set at the very start of the motion, so it blends
 * into the flight instead of snapping at the end.
 *
 * (`freezeElevation`, the "official" flyTo option for this, hangs the animation
 * for non-trivial moves; syncing elevation every frame breaks the flight; and a
 * post-flight `setCenterElevation` + `jumpTo` produces a visible jump.)
 */
function flyToScene(map: maplibregl.Map, camera: ShowcaseCamera) {
    const target = {
        center: camera.center,
        zoom: camera.zoom,
        pitch: camera.pitch,
        bearing: camera.bearing,
    };
    const hasTerrain = Boolean(map.getTerrain());

    if (hasTerrain && typeof camera.centerElevation === 'number' && Number.isFinite(camera.centerElevation)) {
        map.setCenterElevation(camera.centerElevation);
        map.flyTo({ ...target, duration: 1400, essential: true });
        return;
    }

    map.flyTo({ ...target, duration: 1400, essential: true });

    // Fallback for scenes saved without a stored center elevation: once the
    // flight settles and destination terrain has loaded, sync to the relief if
    // the elevation drifted.
    if (!hasTerrain) return;
    map.once('moveend', () => {
        const elevation = map.queryTerrainElevation(map.getCenter());
        if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return;
        if (Math.abs(map.getCenterElevation() - elevation) < 1) return;
        map.setCenterElevation(elevation);
        map.jumpTo(target);
    });
}

function GalleryTile({
    entry,
    busy,
    onSelect,
}: Readonly<{ entry: GalleryEntry; busy: boolean; onSelect: () => void }>) {
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={busy}
            className="group relative overflow-hidden rounded-lg bg-slate-50 text-left ring-1 ring-slate-200 transition hover:ring-emerald-400/60 disabled:opacity-50 dark:bg-slate-800 dark:ring-white/10"
        >
            <div className="aspect-video w-full bg-slate-100 dark:bg-slate-700">
                <img
                    src={entry.thumbUrl}
                    alt={entry.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                />
            </div>
            <div className="p-2.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{entry.title}</div>
                {entry.description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{entry.description}</p>}
            </div>
        </button>
    );
}

function GalleryBody({
    entries,
    loading,
    error,
    busyId,
    onSelect,
}: Readonly<{
    entries: GalleryEntry[];
    loading: boolean;
    error: string | null;
    busyId: string | null;
    onSelect: (e: GalleryEntry) => void;
}>) {
    if (loading) return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Chargement de la galerie…</p>;
    if (error) return <p className="py-8 text-center text-sm text-rose-500 dark:text-rose-300">{error}</p>;
    if (entries.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucune scène pour l’instant. Exportez une vue puis ajoutez-la à <code>public/showcase/index.json</code>.
            </p>
        );
    }
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {entries.map((e) => (
                <GalleryTile key={e.id} entry={e} busy={busyId !== null} onSelect={() => onSelect(e)} />
            ))}
        </div>
    );
}

/** Async-loaded thumbnail for a locally-stored scene (object URL from IndexedDB). */
function LocalThumb({ id, alt }: Readonly<{ id: string; alt: string }>) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let revoked: string | null = null;
        let cancelled = false;
        loadSavedSceneThumb(id).then((bytes) => {
            if (cancelled || !bytes) return;
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            const objectUrl = URL.createObjectURL(new Blob([buf], { type: 'image/webp' }));
            revoked = objectUrl;
            setUrl(objectUrl);
        });
        return () => {
            cancelled = true;
            if (revoked) URL.revokeObjectURL(revoked);
        };
    }, [id]);
    return (
        <div className="aspect-video w-full bg-slate-100 dark:bg-slate-700">
            {url && (
                <img
                    src={url}
                    alt={alt}
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                />
            )}
        </div>
    );
}

function LocalTile({
    scene,
    busy,
    onSelect,
    onDelete,
}: Readonly<{ scene: SavedScene; busy: boolean; onSelect: () => void; onDelete: () => void }>) {
    return (
        <div className="group relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button type="button" onClick={onSelect} disabled={busy} className="block w-full text-left disabled:opacity-50">
                <LocalThumb id={scene.id} alt={scene.title} />
                <div className="p-2.5">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{scene.title}</div>
                    {scene.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-300">{scene.description}</p>}
                </div>
            </button>
            <button
                type="button"
                onClick={onDelete}
                title="Supprimer cette vue"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 opacity-0 ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white group-hover:opacity-100 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-white/10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.177-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
            </button>
        </div>
    );
}

function LocalGalleryBody({
    scenes,
    busyId,
    onSelect,
    onDelete,
}: Readonly<{
    scenes: SavedScene[];
    busyId: string | null;
    onSelect: (s: SavedScene) => void;
    onDelete: (s: SavedScene) => void;
}>) {
    if (scenes.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucune vue enregistrée. Exportez une vue avec « Stocker dans Mes vues » pour la retrouver ici.
            </p>
        );
    }
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scenes.map((s) => (
                <LocalTile
                    key={s.id}
                    scene={s}
                    busy={busyId !== null}
                    onSelect={() => onSelect(s)}
                    onDelete={() => onDelete(s)}
                />
            ))}
        </div>
    );
}

/** Thumbnail for a recently-loaded cloud: the IGN Plan map framing the loaded area. */
function CloudThumb({ cloud }: Readonly<{ cloud: SavedCloud }>) {
    const src = ignStaticMapUrl({
        centerLng: cloud.centerLng,
        centerLat: cloud.centerLat,
        radius: cloud.radius,
    });
    return (
        <div className="aspect-video w-full bg-slate-100 dark:bg-slate-900">
            <img
                src={src}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
            />
        </div>
    );
}

function formatCount(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} k`;
    return String(n);
}

function RecentTile({
    cloud,
    busy,
    onSelect,
    onDelete,
}: Readonly<{ cloud: SavedCloud; busy: boolean; onSelect: () => void; onDelete: () => void }>) {
    return (
        <div className="group relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button type="button" onClick={onSelect} disabled={busy} className="block w-full text-left disabled:opacity-50">
                <CloudThumb cloud={cloud} />
                <div className="p-2.5">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{cloud.name}</div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-300">
                        <span className="rounded bg-slate-200/70 px-1 text-[10px] dark:bg-white/10">{CLOUD_MODE_LABELS[cloud.mode]}</span>
                        <span>r {cloud.radius} m</span>
                        {cloud.pointCount > 0 && <span>· {formatCount(cloud.pointCount)} pts</span>}
                        {cloud.hasMesh && cloud.vertexCount && <span>· {formatCount(cloud.vertexCount)} v</span>}
                    </p>
                </div>
            </button>
            <button
                type="button"
                onClick={onDelete}
                title="Supprimer ce nuage"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 opacity-0 ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white group-hover:opacity-100 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-white/10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.177-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
            </button>
        </div>
    );
}

function RecentGalleryBody({
    clouds,
    busyId,
    onSelect,
    onDelete,
}: Readonly<{
    clouds: SavedCloud[];
    busyId: string | null;
    onSelect: (c: SavedCloud) => void;
    onDelete: (c: SavedCloud) => void;
}>) {
    if (clouds.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun nuage chargé récemment. Chargez un nuage pour le retrouver ici, même sans l’enregistrer.
            </p>
        );
    }
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clouds.map((c) => (
                <RecentTile
                    key={c.id}
                    cloud={c}
                    busy={busyId !== null}
                    onSelect={() => onSelect(c)}
                    onDelete={() => onDelete(c)}
                />
            ))}
        </div>
    );
}

/**
 * Showcase gallery — lists baked scenes from `public/showcase/index.json` and
 * loads them instantly (bypassing the WFS/COPC/Poisson pipeline) by feeding the
 * decoded geometry straight into the store via `showLidarCloudSnapshot`.
 */
export function ShowcaseGallery({ variant = 'dark', inline = false }: Readonly<{ variant?: 'dark' | 'light'; inline?: boolean }>) {
    const [open, setOpen] = useState(false);
    const isOpen = inline || open;
    const [tab, setTab] = useState<'featured' | 'mine' | 'recent'>('featured');
    const [entries, setEntries] = useState<GalleryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [localScenes, setLocalScenes] = useState<SavedScene[]>(() => listSavedScenes());
    const [recentClouds, setRecentClouds] = useState<SavedCloud[]>(() => listSavedClouds());
    const [confirmClearRecent, setConfirmClearRecent] = useState(false);
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen || entries.length > 0) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        loadGalleryEntries()
            .then((loaded) => {
                if (!cancelled) setEntries(loaded);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Échec du chargement de la galerie.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, entries.length]);

    useEffect(() => {
        const refresh = () => setLocalScenes(listSavedScenes());
        globalThis.addEventListener('open-cairn-saved-scenes-changed', refresh);
        return () => globalThis.removeEventListener('open-cairn-saved-scenes-changed', refresh);
    }, []);

    useEffect(() => {
        const refresh = () => setRecentClouds(listSavedClouds());
        globalThis.addEventListener('open-cairn-saved-clouds-changed', refresh);
        return () => globalThis.removeEventListener('open-cairn-saved-clouds-changed', refresh);
    }, []);

    const onSelect = async (entry: GalleryEntry) => {
        setError(null);
        setBusyId(entry.id);
        try {
            const scene = await loadShowcaseScene({
                id: entry.id,
                geometryUrl: entry.geometryUrl,
                manifest: entry.manifest,
            });
            applyScene(scene);
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossible de charger la scène.');
        } finally {
            setBusyId(null);
        }
    };

    const onSelectLocal = async (saved: SavedScene) => {
        setError(null);
        setBusyId(saved.id);
        try {
            const data = await loadSavedSceneData(saved.id);
            if (!data) {
                deleteSavedScene(saved.id); // payload gone — drop the stale entry
                return;
            }
            applyScene({
                id: saved.id,
                title: saved.title,
                description: saved.description,
                camera: data.camera,
                ambiance: data.ambiance,
                shaded: data.shaded,
                mesh: data.mesh,
            });
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossible de charger la vue.');
        } finally {
            setBusyId(null);
        }
    };

    const onSelectRecent = async (cloud: SavedCloud) => {
        setError(null);
        setBusyId(cloud.id);
        try {
            const data = await loadSavedCloudData(cloud.id);
            if (!data) {
                deleteSavedCloud(cloud.id); // payload gone (cache cleared) — drop the stale entry
                return;
            }
            const st = useMapStore.getState();
            st.setLidarMode(cloud.mode);
            st.showLidarCloudSnapshot(data);
            const dLat = cloud.radius / 111320;
            const dLng = cloud.radius / (111320 * Math.cos((cloud.centerLat * Math.PI) / 180));
            st.fitBounds(
                [cloud.centerLng - dLng, cloud.centerLat - dLat, cloud.centerLng + dLng, cloud.centerLat + dLat],
                { padding: 60 },
            );
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossible de charger le nuage.');
        } finally {
            setBusyId(null);
        }
    };

    const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-importing the same file
        if (!file) return;
        setError(null);
        setImporting(true);
        try {
            const saved = await importSceneFromZip(file);
            if (!saved) throw new Error('Import impossible (géométrie vide ?).');
            setTab('mine');
        } catch (err) {
            setTab('mine');
            setError(err instanceof Error ? err.message : 'Import impossible.');
        } finally {
            setImporting(false);
        }
    };

    const galleryPanel = (
        <>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Galerie de scènes</h2>
                {!inline && (
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        title="Fermer"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                    </button>
                )}
            </div>
            <div className="flex gap-1 border-b border-slate-200 px-4 pt-2 dark:border-white/10">
                <TabButton active={tab === 'featured'} onClick={() => setTab('featured')}>
                    Mis en avant
                </TabButton>
                <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
                    Mes vues{localScenes.length > 0 ? ` (${localScenes.length})` : ''}
                </TabButton>
                <TabButton active={tab === 'recent'} onClick={() => setTab('recent')}>
                    Nuages récents{recentClouds.length > 0 ? ` (${recentClouds.length})` : ''}
                </TabButton>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {tab === 'featured' && (
                    <GalleryBody
                        entries={entries}
                        loading={loading}
                        error={error}
                        busyId={busyId}
                        onSelect={(e) => { onSelect(e); }}
                    />
                )}
                {tab === 'mine' && (
                    <>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Vues stockées dans ce navigateur.
                            </p>
                            <button
                                type="button"
                                onClick={() => importInputRef.current?.click()}
                                disabled={importing}
                                className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path d="M10 1a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 011.06-1.06l2.22 2.22V1.75A.75.75 0 0110 1z" />
                                    <path d="M3.5 12.75a.75.75 0 01.75.75v2.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0115.5 17.75h-11A1.75 1.75 0 012.75 16v-2.5a.75.75 0 01.75-.75z" />
                                </svg>
                                {importing ? 'Import…' : 'Importer un .zip'}
                            </button>
                        </div>
                        {error && <p className="mb-3 text-center text-sm text-rose-300">{error}</p>}
                        <LocalGalleryBody
                            scenes={localScenes}
                            busyId={busyId}
                            onSelect={(s) => { onSelectLocal(s); }}
                            onDelete={(s) => deleteSavedScene(s.id)}
                        />
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            onChange={(e) => { onImportFile(e); }}
                            className="hidden"
                        />
                    </>
                )}
                {tab === 'recent' && (
                    <>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Nuages chargés récemment dans ce navigateur.
                            </p>
                            {recentClouds.length > 0 && (
                                confirmClearRecent ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-slate-600 dark:text-slate-300">Tout supprimer ?</span>
                                        <button
                                            type="button"
                                            onClick={() => { clearAllSavedClouds(); setConfirmClearRecent(false); }}
                                            className="rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
                                        >
                                            Confirmer
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmClearRecent(false)}
                                            className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
                                        >
                                            Annuler
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmClearRecent(true)}
                                        className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-slate-200 transition hover:bg-rose-50 dark:bg-white/5 dark:text-rose-300 dark:ring-white/15 dark:hover:bg-rose-600/20"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.177-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                                        </svg>
                                        Tout supprimer
                                    </button>
                                )
                            )}
                        </div>
                        {error && <p className="mb-3 text-center text-sm text-rose-300">{error}</p>}
                        <RecentGalleryBody
                            clouds={recentClouds}
                            busyId={busyId}
                            onSelect={(c) => { onSelectRecent(c); }}
                            onDelete={(c) => deleteSavedCloud(c.id)}
                        />
                    </>
                )}
            </div>
        </>
    );

    if (inline) {
        return (
            <div className="flex max-h-[60vh] flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                {galleryPanel}
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={
                    variant === 'light'
                        ? 'flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/60'
                        : 'inline-flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10'
                }
            >
                <GalleryIcon className="h-4 w-4" />
                <span>Galerie</span>
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="dark flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-slate-100 shadow-2xl ring-1 ring-white/10">
                        {galleryPanel}
                    </div>
                </div>
            )}
        </>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: Readonly<{ active: boolean; onClick: () => void; children: React.ReactNode }>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition ${active
                ? 'border-emerald-400 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
        >
            {children}
        </button>
    );
}
