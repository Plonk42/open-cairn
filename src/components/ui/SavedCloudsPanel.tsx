import { ignStaticMapUrl } from '@/lib/ign';
import {
    CLOUD_MODE_LABELS,
    deleteSavedCloud,
    listSavedClouds,
    loadSavedCloudData,
    renameSavedCloud,
    type SavedCloud,
} from '@/lib/savedClouds';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useState } from 'react';

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' })
            + ' · '
            + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

function formatCount(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} k`;
    return String(n);
}

/** IGN Plan map framing the loaded area. */
function CloudThumb({ cloud }: Readonly<{ cloud: SavedCloud }>) {
    const src = ignStaticMapUrl({
        centerLng: cloud.centerLng,
        centerLat: cloud.centerLat,
        radius: cloud.radius,
    });
    return (
        <img
            src={src}
            alt=""
            loading="lazy"
            className="h-[80px] w-[120px] flex-shrink-0 rounded bg-slate-900 object-cover ring-1 ring-slate-200 dark:ring-slate-700"
        />
    );
}

export function SavedCloudsPanel() {
    const [clouds, setClouds] = useState<SavedCloud[]>(() => listSavedClouds());
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const showSnapshot = useMapStore((s) => s.showLidarCloudSnapshot);
    const setLidarMode = useMapStore((s) => s.setLidarMode);
    const fitBounds = useMapStore((s) => s.fitBounds);

    useEffect(() => {
        const refresh = () => setClouds(listSavedClouds());
        globalThis.addEventListener('open-cairn-saved-clouds-changed', refresh);
        return () => globalThis.removeEventListener('open-cairn-saved-clouds-changed', refresh);
    }, []);

    const handleLoad = async (c: SavedCloud) => {
        setLoadingId(c.id);
        try {
            const data = await loadSavedCloudData(c.id);
            if (!data) {
                deleteSavedCloud(c.id); // payload gone (cache cleared) — drop the stale entry
                return;
            }
            setLidarMode(c.mode);
            showSnapshot(data);
            // Frame the loaded area: convert the request radius (m) to degrees.
            const dLat = c.radius / 111320;
            const dLng = c.radius / (111320 * Math.cos((c.centerLat * Math.PI) / 180));
            fitBounds(
                [c.centerLng - dLng, c.centerLat - dLat, c.centerLng + dLng, c.centerLat + dLat],
                { padding: 60 },
            );
        } finally {
            setLoadingId(null);
        }
    };

    const startRename = (c: SavedCloud) => {
        setRenaming(c.id);
        setRenameValue(c.name);
    };
    const commitRename = (id: string) => {
        const next = renameValue.trim();
        if (next) renameSavedCloud(id, next);
        setRenaming(null);
    };

    return (
        <div className="space-y-3">
            {clouds.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aucun nuage chargé pour le moment. Chargez un nuage pour le retrouver ici.
                </p>
            ) : (
                <ul className="space-y-2">
                    {clouds.map((c) => {
                        const isRenaming = renaming === c.id;
                        const isConfirming = confirmDelete === c.id;
                        const isLoading = loadingId === c.id;
                        return (
                            <li
                                key={c.id}
                                className="rounded-lg bg-gray-50 p-2 ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700"
                            >
                                <div className="flex gap-2.5">
                                    <button
                                        type="button"
                                        onClick={() => handleLoad(c)}
                                        title="Réafficher ce nuage"
                                        className="relative flex-shrink-0 cursor-pointer rounded transition hover:opacity-80"
                                    >
                                        <CloudThumb cloud={c} />
                                        {isLoading && (
                                            <span className="absolute inset-0 flex items-center justify-center rounded bg-slate-900/50 text-[10px] text-white">
                                                …
                                            </span>
                                        )}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        {isRenaming ? (
                                            <input
                                                type="text"
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onBlur={() => commitRename(c.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') commitRename(c.id);
                                                    else if (e.key === 'Escape') setRenaming(null);
                                                }}
                                                autoFocus
                                                className="w-full rounded bg-white px-1.5 py-0.5 text-xs text-slate-800 ring-1 ring-green-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onDoubleClick={() => startRename(c)}
                                                onClick={() => handleLoad(c)}
                                                title="Réafficher (clic) ou renommer (double-clic)"
                                                className="block w-full cursor-pointer truncate text-left text-xs font-semibold text-slate-700 hover:text-green-700 dark:text-slate-200 dark:hover:text-emerald-400"
                                            >
                                                {c.name}
                                            </button>
                                        )}
                                        <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                                            {formatDate(c.createdAt)}
                                        </p>
                                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                                            <span className="rounded bg-slate-200/70 px-1 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                {CLOUD_MODE_LABELS[c.mode]}
                                            </span>
                                            <span>r {c.radius} m</span>
                                            {c.pointCount > 0 && <span>· {formatCount(c.pointCount)} pts</span>}
                                            {c.hasMesh && c.vertexCount && <span>· {formatCount(c.vertexCount)} v</span>}
                                        </p>
                                        <div className="mt-1.5 flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => handleLoad(c)}
                                                title="Réafficher ce nuage"
                                                className="flex h-6 w-6 items-center justify-center rounded bg-green-600/10 text-green-700 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path d="M10 3.5a6.5 6.5 0 1 0 6.326 8.064.75.75 0 1 1 1.456.362A8 8 0 1 1 10 2a.75.75 0 0 1 0 1.5z" />
                                                    <path d="M10 6.5a.75.75 0 0 1 .75.75v2h2a.75.75 0 0 1 0 1.5h-2.75a.75.75 0 0 1-.75-.75V7.25A.75.75 0 0 1 10 6.5z" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => startRename(c)}
                                                title="Renommer"
                                                className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                                </svg>
                                            </button>
                                            {isConfirming ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => { deleteSavedCloud(c.id); setConfirmDelete(null); }}
                                                        title="Confirmer la suppression"
                                                        className="ml-auto flex h-6 items-center gap-1 rounded bg-rose-600 px-1.5 text-[10.5px] font-medium text-white transition hover:bg-rose-700"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                        </svg>
                                                        OK
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDelete(null)}
                                                        title="Annuler"
                                                        className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                                        </svg>
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDelete(c.id)}
                                                    title="Supprimer"
                                                    className="ml-auto flex h-6 w-6 items-center justify-center rounded bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
