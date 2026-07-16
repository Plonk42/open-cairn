import {
    applyScene,
    type GalleryEntry,
    loadGalleryEntries,
} from '@/components/lidar/gallery/sceneData';
import {
    GalleryBody,
    GalleryIcon,
    LocalGalleryBody,
    RecentGalleryBody,
    TabButton,
} from '@/components/lidar/gallery/tiles';
import { rectEnclosingRadiusM } from '@/lib/lidarCaptureRect';
import {
    clearAllSavedClouds,
    deleteSavedCloud,
    loadSavedCloudData,
    type SavedCloud,
    useSavedClouds,
} from '@/lib/savedClouds';
import {
    deleteSavedScene,
    importSceneFromUrl,
    importSceneFromZip,
    loadSavedSceneData,
    type SavedScene,
    useSavedScenes,
} from '@/lib/savedScenes';
import { loadShowcaseScene, type SceneLoadProgress } from '@/lib/showcaseScene';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Showcase gallery — lists baked scenes from `public/showcase/index.json` and
 * loads them instantly (bypassing the WFS/COPC/Poisson pipeline) by feeding the
 * decoded geometry straight into the store via `addLidarCloudSnapshot`, which
 * appends alongside any clouds already displayed. Tiles matching an
 * already-loaded cloud (by scene id / recent-cloud key) are badged and
 * disabled until removed from the LiDAR Studio pill.
 */
export function ShowcaseGallery({ variant = 'dark', inline = false }: Readonly<{ variant?: 'dark' | 'light'; inline?: boolean }>) {
    const [open, setOpen] = useState(false);
    const isOpen = inline || open;
    const [tab, setTab] = useState<'featured' | 'mine' | 'recent'>('featured');
    const [entries, setEntries] = useState<GalleryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [sceneProgress, setSceneProgress] = useState<SceneLoadProgress | null>(null);
    const localScenes = useSavedScenes();
    const recentClouds = useSavedClouds();
    const [confirmClearRecent, setConfirmClearRecent] = useState(false);
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [urlImportOpen, setUrlImportOpen] = useState(false);
    const [urlValue, setUrlValue] = useState('');

    // Already-loaded clouds (shown in the pill) drive the Gallery's "already
    // loaded" badge/disable state, matched by scene id (Featured/Mes vues) or
    // by recent-cloud dedupe key (Nuages récents).
    const loadedClouds = useMapStore((s) => s.lidarClouds);
    const loadedSceneIds = useMemo(
        () => new Set(loadedClouds.map((c) => c.sourceSceneId).filter((id): id is string => Boolean(id))),
        [loadedClouds],
    );
    const loadedCloudKeys = useMemo(
        () => new Set(loadedClouds.map((c) => c.sourceKey).filter((key): key is string => Boolean(key))),
        [loadedClouds],
    );

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

    const onSelect = async (entry: GalleryEntry) => {
        setError(null);
        setBusyId(entry.id);
        setSceneProgress(null);
        try {
            const scene = await loadShowcaseScene(
                { id: entry.id, geometryUrl: entry.geometryUrl, manifest: entry.manifest },
                (p) => setSceneProgress(p),
            );
            applyScene(scene);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossible de charger la scène.');
        } finally {
            setBusyId(null);
            setSceneProgress(null);
        }
    };

    const onSelectLocal = async (saved: SavedScene) => {
        setError(null);
        setBusyId(saved.id);
        setSceneProgress(null);
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
                extraClouds: data.extraClouds,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Impossible de charger la vue.');
        } finally {
            setBusyId(null);
            setSceneProgress(null);
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
            st.addLidarCloudSnapshot(data, { mode: cloud.mode, sourceKey: cloud.key });
            const radius = rectEnclosingRadiusM(cloud.widthM, cloud.lengthM);
            const dLat = radius / 111320;
            const dLng = radius / (111320 * Math.cos((cloud.centerLat * Math.PI) / 180));
            st.fitBounds(
                [cloud.centerLng - dLng, cloud.centerLat - dLat, cloud.centerLng + dLng, cloud.centerLat + dLat],
                { padding: 60 },
            );
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

    const onImportUrl = async () => {
        const url = urlValue.trim();
        if (!url) return;
        setError(null);
        setImporting(true);
        setSceneProgress(null);
        try {
            const saved = await importSceneFromUrl(url, (p) => setSceneProgress(p));
            if (!saved) throw new Error('Import impossible (géométrie vide ?).');
            setUrlValue('');
            setUrlImportOpen(false);
            setTab('mine');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import impossible.');
        } finally {
            setImporting(false);
            setSceneProgress(null);
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
                        loadedIds={loadedSceneIds}
                        progress={sceneProgress}
                        onSelect={(e) => { onSelect(e); }}
                    />
                )}
                {tab === 'mine' && (
                    <>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Vues stockées dans ce navigateur.
                            </p>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => { setUrlImportOpen((v) => !v); }}
                                    disabled={importing}
                                    className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                        <path fillRule="evenodd" d="M12.207 2.232a.75.75 0 00.025 1.06l4.146 3.958H6.375a5.375 5.375 0 000 10.75H9.75a.75.75 0 000-1.5H6.375a3.875 3.875 0 010-7.75h10.003l-4.146 3.957a.75.75 0 001.036 1.085l5.5-5.25a.75.75 0 000-1.085l-5.5-5.25a.75.75 0 00-1.061.025z" clipRule="evenodd" />
                                    </svg>
                                    URL
                                </button>
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
                        </div>
                        {urlImportOpen && (
                            <div className="mb-3">
                                {importing && sceneProgress ? (
                                    <div className="rounded-md bg-slate-100 p-2.5 dark:bg-white/5">
                                        {sceneProgress.phase === 'download' && (sceneProgress.total ?? 0) > 0 ? (
                                            <>
                                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700">
                                                    <div
                                                        className="h-full rounded-full bg-emerald-500 transition-all duration-150"
                                                        style={{ width: `${Math.round(((sceneProgress.loaded ?? 0) / (sceneProgress.total ?? 1)) * 100)}%` }}
                                                    />
                                                </div>
                                                <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
                                                    Téléchargement… {Math.round(((sceneProgress.loaded ?? 0) / (sceneProgress.total ?? 1)) * 100)} %
                                                </p>
                                            </>
                                        ) : (
                                            <p className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                                                {sceneProgress.phase === 'decode' ? 'Décodage…' : 'Téléchargement…'}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <input
                                            type="url"
                                            value={urlValue}
                                            onChange={(e) => setUrlValue(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { onImportUrl(); } }}
                                            placeholder="https://…/scene.zip"
                                            disabled={importing}
                                            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:placeholder-slate-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => { onImportUrl(); }}
                                            disabled={importing || !urlValue.trim()}
                                            className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                                        >
                                            Importer
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        {error && <p className="mb-3 text-center text-sm text-rose-300">{error}</p>}
                        <LocalGalleryBody
                            scenes={localScenes}
                            busyId={busyId}
                            loadedIds={loadedSceneIds}
                            progress={sceneProgress}
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
                            loadedKeys={loadedCloudKeys}
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
            <div className="overflow-hidden rounded-2xl bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                {galleryPanel}
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                data-tutorial="gallery"
                onClick={() => setOpen(true)}
                className={
                    variant === 'light'
                        ? 'flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/60'
                        : 'inline-flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10'
                }
            >
                <GalleryIcon className="h-4 w-4" />
                <span>Galerie</span>
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                        {galleryPanel}
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
