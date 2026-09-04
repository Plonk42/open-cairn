import type { GalleryEntry } from '@/components/lidar/gallery/sceneData';
import { PreviewThumb } from '@/components/ui/SavedRoutesPanel';
import { captureParamEntries, differingCaptureParamKeys, type CaptureParamEntry } from '@/lib/captureParams';
import { formatDistance, formatElevation } from '@/lib/geo';
import { ignStaticMapUrl } from '@/lib/ign';
import { rectEnclosingRadiusM } from '@/lib/lidarCaptureRect';
import { CLOUD_MODE_LABELS, type SavedCloud } from '@/lib/savedClouds';
import { deleteSavedRoute, renameSavedRoute, type SavedRoute } from '@/lib/savedRoutes';
import { loadSavedSceneThumb, type SavedScene } from '@/lib/savedScenes';
import type { SceneLoadProgress } from '@/lib/showcaseScene';
import { Fragment, useEffect, useMemo, useState } from 'react';

/** Overlay rendered on a tile while it is being loaded (download + decode). */
function SceneProgressOverlay({ progress }: Readonly<{ progress: SceneLoadProgress | null }>) {
    const isDownload = progress?.phase === 'download';
    const total = progress?.total ?? 0;
    const loaded = progress?.loaded ?? 0;
    const pct = isDownload && total > 0 ? Math.round((loaded / total) * 100) : null;
    let label: string;
    if (progress?.phase === 'decode') label = 'Décodage…';
    else if (pct === null) label = 'Téléchargement…';
    else label = `${pct} %`;

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-[2px]">
            {pct === null ? (
                <div className="flex flex-col items-center gap-1.5">
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                    <p className="text-xs font-medium text-white">{label}</p>
                </div>
            ) : (
                <div className="w-3/4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div
                            className="h-full rounded-full bg-emerald-400 transition-all duration-150"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="mt-1.5 text-center text-xs font-medium text-white">{label}</p>
                </div>
            )}
        </div>
    );
}

export function GalleryIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
        </svg>
    );
}

const TrashGlyph = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.177-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
);

/** Small pill shown over a tile's thumbnail when it is already loaded. */
function LoadedBadge() {
    return (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-medium text-white shadow">
            Déjà chargé
        </span>
    );
}

function GalleryTile({
    entry,
    busy,
    loaded,
    progress,
    onSelect,
}: Readonly<{ entry: GalleryEntry; busy: boolean; loaded: boolean; progress: SceneLoadProgress | null; onSelect: () => void }>) {
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={busy || loaded}
            title={loaded ? 'Déjà chargé — supprimez-le depuis la pastille pour le recharger' : undefined}
            className="group relative overflow-hidden rounded-lg bg-slate-50 text-left ring-1 ring-slate-200 transition hover:ring-emerald-400/60 disabled:cursor-not-allowed dark:bg-slate-800 dark:ring-white/10"
        >
            <div className="relative aspect-video w-full bg-slate-100 dark:bg-slate-700">
                <img
                    src={entry.thumbUrl}
                    alt={entry.title}
                    loading="lazy"
                    className={`h-full w-full object-cover transition ${busy || loaded ? '' : 'group-hover:scale-[1.03]'} ${loaded ? 'opacity-60' : ''}`}
                />
                {busy && <SceneProgressOverlay progress={progress} />}
                {loaded && !busy && <LoadedBadge />}
            </div>
            <div className="p-2.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{entry.title}</div>
                {entry.description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{entry.description}</p>}
            </div>
        </button>
    );
}

export function GalleryBody({
    entries,
    loading,
    error,
    busyId,
    loadedIds,
    progress,
    onSelect,
}: Readonly<{
    entries: GalleryEntry[];
    loading: boolean;
    error: string | null;
    busyId: string | null;
    loadedIds: ReadonlySet<string>;
    progress: SceneLoadProgress | null;
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
                <GalleryTile
                    key={e.id}
                    entry={e}
                    busy={busyId === e.id}
                    loaded={loadedIds.has(e.id)}
                    progress={busyId === e.id ? progress : null}
                    onSelect={() => onSelect(e)}
                />
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
    loaded,
    progress,
    onSelect,
    onApplyStyle,
    onDelete,
}: Readonly<{ scene: SavedScene; busy: boolean; loaded: boolean; progress: SceneLoadProgress | null; onSelect: () => void; onApplyStyle: () => void; onDelete: () => void }>) {
    return (
        <div className="group relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button
                type="button"
                onClick={onSelect}
                disabled={busy || loaded}
                title={loaded ? 'Déjà chargé — supprimez-le depuis la pastille pour le recharger' : undefined}
                className="block w-full cursor-pointer text-left disabled:cursor-not-allowed"
            >
                <div className="relative">
                    <LocalThumb id={scene.id} alt={scene.title} />
                    {busy && <SceneProgressOverlay progress={progress} />}
                    {loaded && !busy && <LoadedBadge />}
                </div>
                <div className="p-2.5">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{scene.title}</div>
                    {scene.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-300">{scene.description}</p>}
                    {scene.cloudCount > 1 && (
                        <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-300">
                            <span className="rounded bg-slate-200/70 px-1 text-[10px] dark:bg-white/10">{scene.cloudCount} nuages</span>
                        </p>
                    )}
                </div>
            </button>
            <div className="flex items-center justify-end border-t border-slate-200 px-2.5 py-1.5 dark:border-white/10">
                <button
                    type="button"
                    onClick={onApplyStyle}
                    disabled={busy}
                    title="Appliquer l'aspect de cette vue aux nuages actuellement chargés, sans rien charger"
                    className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                >
                    Appliquer le style
                </button>
            </div>
            <button
                type="button"
                onClick={onDelete}
                title="Supprimer cette vue"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 opacity-0 ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white group-hover:opacity-100 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-white/10"
            >
                <TrashGlyph />
            </button>
        </div>
    );
}

export function LocalGalleryBody({
    scenes,
    busyId,
    loadedIds,
    progress,
    onSelect,
    onApplyStyle,
    onDelete,
}: Readonly<{
    scenes: SavedScene[];
    busyId: string | null;
    loadedIds: ReadonlySet<string>;
    progress: SceneLoadProgress | null;
    onSelect: (s: SavedScene) => void;
    onApplyStyle: (s: SavedScene) => void;
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
                    busy={busyId === s.id}
                    loaded={loadedIds.has(s.id)}
                    progress={busyId === s.id ? progress : null}
                    onSelect={() => onSelect(s)}
                    onApplyStyle={() => onApplyStyle(s)}
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
        radius: rectEnclosingRadiusM(cloud.widthM, cloud.lengthM),
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

/** Capture-zone size label from the rectangle dimensions. */
function captureSizeLabel(cloud: SavedCloud): string {
    return `${Math.round(cloud.widthM)} × ${Math.round(cloud.lengthM)} m`;
}

/** Jour + heure : deux essais de la même zone ne se distinguent souvent que par là. */
function captureTimeLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ChevronGlyph = ({ open }: Readonly<{ open: boolean }>) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
        aria-hidden="true"
    >
        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
    </svg>
);

/** Liste dépliable de tous les réglages, plus le repère de la capture. */
function CaptureDetails({ cloud, entries }: Readonly<{ cloud: SavedCloud; entries: readonly CaptureParamEntry[] }>) {
    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2.5 pb-2.5 text-[11px]">
            <dt className="text-slate-500 dark:text-slate-400">Zone</dt>
            <dd className="tabular-nums text-slate-700 dark:text-slate-200">{captureSizeLabel(cloud)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Centre</dt>
            <dd className="tabular-nums text-slate-700 dark:text-slate-200">
                {cloud.centerLat.toFixed(5)}, {cloud.centerLng.toFixed(5)}
            </dd>
            {entries.map((e) => (
                <Fragment key={e.key}>
                    <dt className="text-slate-500 dark:text-slate-400">{e.label}</dt>
                    <dd className="tabular-nums text-slate-700 dark:text-slate-200">{e.text}</dd>
                </Fragment>
            ))}
        </dl>
    );
}

function RecentTile({
    cloud,
    busy,
    loaded,
    highlightKeys,
    onSelect,
    onRecapture,
    onDelete,
}: Readonly<{
    cloud: SavedCloud;
    busy: boolean;
    loaded: boolean;
    highlightKeys: readonly string[];
    onSelect: () => void;
    onRecapture: () => void;
    onDelete: () => void;
}>) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const allParams = captureParamEntries(cloud.params);
    const highlighted = captureParamEntries(cloud.params, highlightKeys);
    const paramsTitle = allParams.map((e) => `${e.label} : ${e.text}`).join('\n') || undefined;
    return (
        <div className="group relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button
                type="button"
                onClick={onSelect}
                disabled={busy || loaded}
                title={loaded ? 'Déjà chargé — supprimez-le depuis la pastille pour le recharger' : undefined}
                className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
                <div className="relative">
                    <CloudThumb cloud={cloud} />
                    {loaded && <LoadedBadge />}
                </div>
                <div className="p-2.5">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{cloud.name}</div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-300" title={paramsTitle}>
                        <span className="rounded bg-slate-200/70 px-1 text-[10px] dark:bg-white/10">{CLOUD_MODE_LABELS[cloud.mode]}</span>
                        <span>{captureSizeLabel(cloud)}</span>
                        {cloud.pointCount > 0 && <span>· {formatCount(cloud.pointCount)} pts</span>}
                        {cloud.hasMesh && cloud.vertexCount && <span>· {formatCount(cloud.vertexCount)} v</span>}
                        <span className="text-slate-400 dark:text-slate-400">· {captureTimeLabel(cloud.createdAt)}</span>
                    </p>
                    {highlighted.length > 0 && (
                        <p className="mt-1 flex flex-wrap items-center gap-1" title={paramsTitle}>
                            {highlighted.map((e) => (
                                <span
                                    key={e.key}
                                    className="rounded bg-amber-100 px-1 text-[10px] tabular-nums text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"
                                >
                                    {e.label} {e.text}
                                </span>
                            ))}
                        </p>
                    )}
                </div>
            </button>
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-2.5 py-1.5 dark:border-white/10">
                <button
                    type="button"
                    onClick={() => setDetailsOpen((v) => !v)}
                    aria-expanded={detailsOpen}
                    className="flex items-center gap-1 rounded text-[11px] font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                >
                    <ChevronGlyph open={detailsOpen} />
                    Détails
                </button>
                <button
                    type="button"
                    onClick={onRecapture}
                    title="Reprendre l’emprise et les réglages de cette capture, sans la lancer"
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                >
                    Recapturer
                </button>
            </div>
            {detailsOpen && <CaptureDetails cloud={cloud} entries={allParams} />}
            <button
                type="button"
                onClick={onDelete}
                title="Supprimer ce nuage"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-slate-500 opacity-0 ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white group-hover:opacity-100 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-white/10"
            >
                <TrashGlyph />
            </button>
        </div>
    );
}

/** Regroupe les captures par zone : même mode, même centre, même rectangle. */
function zoneGroupKey(c: SavedCloud): string {
    return `${c.mode}:${c.centerLng.toFixed(4)}:${c.centerLat.toFixed(4)}:${Math.round(c.widthM)}x${Math.round(c.lengthM)}`;
}

/**
 * Pour chaque nuage, les réglages qui le distinguent des *autres captures de la
 * même zone*. Comparé à l'ensemble de la liste, presque tout différerait et la
 * tuile deviendrait illisible ; entre voisins d'une même zone, il ne reste que
 * la poignée de curseurs qu'on était justement en train de comparer.
 */
function useHighlightKeys(clouds: SavedCloud[]): ReadonlyMap<string, string[]> {
    return useMemo(() => {
        const groups = new Map<string, SavedCloud[]>();
        for (const c of clouds) {
            const existing = groups.get(zoneGroupKey(c));
            if (existing) existing.push(c);
            else groups.set(zoneGroupKey(c), [c]);
        }
        const byId = new Map<string, string[]>();
        for (const group of groups.values()) {
            const keys = group.length > 1 ? differingCaptureParamKeys(group.map((c) => c.params)) : [];
            for (const c of group) byId.set(c.id, keys);
        }
        return byId;
    }, [clouds]);
}

export function RecentGalleryBody({
    clouds,
    busyId,
    loadedKeys,
    onSelect,
    onRecapture,
    onDelete,
}: Readonly<{
    clouds: SavedCloud[];
    busyId: string | null;
    loadedKeys: ReadonlySet<string>;
    onSelect: (c: SavedCloud) => void;
    onRecapture: (c: SavedCloud) => void;
    onDelete: (c: SavedCloud) => void;
}>) {
    const highlightKeys = useHighlightKeys(clouds);
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
                    loaded={loadedKeys.has(c.key)}
                    highlightKeys={highlightKeys.get(c.id) ?? []}
                    onSelect={() => onSelect(c)}
                    onRecapture={() => onRecapture(c)}
                    onDelete={() => onDelete(c)}
                />
            ))}
        </div>
    );
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

/** One saved-route tile: preview thumbnail + name (rename on double-click) + stats + delete. */
function RouteTile({ route, onLoad }: Readonly<{ route: SavedRoute; onLoad: (r: SavedRoute) => void }>) {
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(route.name);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const commitRename = () => {
        const next = renameValue.trim();
        if (next) renameSavedRoute(route.id, next);
        setRenaming(false);
    };

    return (
        <div className="group relative flex flex-col overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button
                type="button"
                onClick={() => onLoad(route)}
                title="Charger cet itinéraire"
                className="flex items-center justify-center p-2"
            >
                <PreviewThumb preview={route.preview} />
            </button>
            <div className="flex flex-1 flex-col px-2.5 pb-2.5">
                {renaming ? (
                    <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            else if (e.key === 'Escape') setRenaming(false);
                        }}
                        autoFocus
                        className="w-full rounded bg-white px-1.5 py-0.5 text-xs text-slate-800 ring-1 ring-emerald-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => onLoad(route)}
                        onDoubleClick={() => { setRenameValue(route.name); setRenaming(true); }}
                        title="Charger (clic) ou renommer (double-clic)"
                        className="truncate text-left text-xs font-semibold text-slate-700 hover:text-emerald-700 dark:text-slate-200 dark:hover:text-emerald-400"
                    >
                        {route.name}
                    </button>
                )}
                <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">{formatDate(route.createdAt)}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                    {formatDistance(route.stats.distance)}
                    {route.stats.ascent > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400"> ↑ {formatElevation(route.stats.ascent)}</span>
                    )}
                    {route.stats.descent > 0 && (
                        <span className="text-rose-500 dark:text-rose-400"> ↓ {formatElevation(route.stats.descent)}</span>
                    )}
                </p>
            </div>

            {confirmDelete ? (
                <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => { deleteSavedRoute(route.id); setConfirmDelete(false); }}
                        title="Confirmer la suppression"
                        className="rounded bg-rose-600 px-1.5 py-0.5 text-[10.5px] font-medium text-white transition hover:bg-rose-700"
                    >
                        OK
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        title="Annuler"
                        className="rounded bg-slate-200 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                        ✕
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    title="Supprimer"
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-white/90 text-rose-600 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-rose-50 group-hover:opacity-100 dark:bg-slate-900/90 dark:text-rose-400 dark:ring-white/10 dark:hover:bg-rose-600/20"
                >
                    <TrashGlyph />
                </button>
            )}
        </div>
    );
}

export function RouteGalleryBody({
    routes,
    onLoad,
}: Readonly<{ routes: SavedRoute[]; onLoad: (r: SavedRoute) => void }>) {
    if (routes.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun itinéraire sauvegardé pour le moment.
            </p>
        );
    }
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {routes.map((r) => (
                <RouteTile key={r.id} route={r} onLoad={onLoad} />
            ))}
        </div>
    );
}

export function TabButton({
    active,
    onClick,
    children,
}: Readonly<{ active: boolean; onClick: () => void; children: React.ReactNode }>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`-mb-px shrink-0 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition ${active
                ? 'border-emerald-400 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
        >
            {children}
        </button>
    );
}
