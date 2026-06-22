import type { GalleryEntry } from '@/components/lidar/gallery/sceneData';
import { ignStaticMapUrl } from '@/lib/ign';
import { CLOUD_MODE_LABELS, type SavedCloud } from '@/lib/savedClouds';
import { loadSavedSceneThumb, type SavedScene } from '@/lib/savedScenes';
import type { SceneLoadProgress } from '@/lib/showcaseScene';
import { useEffect, useState } from 'react';

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

function GalleryTile({
    entry,
    busy,
    progress,
    onSelect,
}: Readonly<{ entry: GalleryEntry; busy: boolean; progress: SceneLoadProgress | null; onSelect: () => void }>) {
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={busy}
            className="group relative overflow-hidden rounded-lg bg-slate-50 text-left ring-1 ring-slate-200 transition hover:ring-emerald-400/60 disabled:cursor-wait dark:bg-slate-800 dark:ring-white/10"
        >
            <div className="relative aspect-video w-full bg-slate-100 dark:bg-slate-700">
                <img
                    src={entry.thumbUrl}
                    alt={entry.title}
                    loading="lazy"
                    className={`h-full w-full object-cover transition ${busy ? '' : 'group-hover:scale-[1.03]'}`}
                />
                {busy && <SceneProgressOverlay progress={progress} />}
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
    progress,
    onSelect,
}: Readonly<{
    entries: GalleryEntry[];
    loading: boolean;
    error: string | null;
    busyId: string | null;
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
    progress,
    onSelect,
    onDelete,
}: Readonly<{ scene: SavedScene; busy: boolean; progress: SceneLoadProgress | null; onSelect: () => void; onDelete: () => void }>) {
    return (
        <div className="group relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 transition hover:ring-emerald-400/60 dark:bg-slate-800 dark:ring-white/10">
            <button type="button" onClick={onSelect} disabled={busy} className="block w-full cursor-pointer text-left disabled:cursor-wait">
                <div className="relative">
                    <LocalThumb id={scene.id} alt={scene.title} />
                    {busy && <SceneProgressOverlay progress={progress} />}
                </div>
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
                <TrashGlyph />
            </button>
        </div>
    );
}

export function LocalGalleryBody({
    scenes,
    busyId,
    progress,
    onSelect,
    onDelete,
}: Readonly<{
    scenes: SavedScene[];
    busyId: string | null;
    progress: SceneLoadProgress | null;
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
                    busy={busyId === s.id}
                    progress={busyId === s.id ? progress : null}
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
                <TrashGlyph />
            </button>
        </div>
    );
}

export function RecentGalleryBody({
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

export function TabButton({
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
