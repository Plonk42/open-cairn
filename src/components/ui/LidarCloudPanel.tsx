import { LidarProgressBar } from '@/components/ui/lidar/LidarProgressBar';
import { LidarStatusLine } from '@/components/ui/lidar/LidarStatusLine';
import {
    deleteSavedCloud,
    listSavedClouds,
    loadSavedCloudData,
    type SavedCloud,
} from '@/lib/savedClouds';
import { useView } from '@/lib/useView';
import { useMapStore } from '@/stores/mapStore';
import { lazy, Suspense, useEffect, useState } from 'react';

const ShowcaseGallery = lazy(() =>
    import('@/components/lidar/ShowcaseGallery').then((m) => ({ default: m.ShowcaseGallery })),
);

const LIDAR_ICON = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <circle cx="4" cy="6" r="1.2" />
        <circle cx="10" cy="4" r="1.2" />
        <circle cx="16" cy="7" r="1.2" />
        <circle cx="6" cy="11" r="1.2" />
        <circle cx="13" cy="12" r="1.2" />
        <circle cx="4" cy="16" r="1.2" />
        <circle cx="11" cy="17" r="1.2" />
        <circle cx="17" cy="14" r="1.2" />
    </svg>
);

/** Compact list of the 3 most-recently-loaded clouds, click → instant re-open. */
function RecentClouds() {
    const [clouds, setClouds] = useState<SavedCloud[]>(() => listSavedClouds());
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
                deleteSavedCloud(c.id);
                return;
            }
            setLidarMode(c.mode);
            showSnapshot(data);
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

    if (clouds.length === 0) return null;
    const recent = clouds.slice(0, 3);

    return (
        <div className="space-y-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Récemment chargés</h4>
            <ul className="space-y-1">
                {recent.map((c) => (
                    <li key={c.id}>
                        <button
                            type="button"
                            onClick={() => { void handleLoad(c); }}
                            disabled={loadingId === c.id}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60"
                        >
                            <span className="truncate font-medium text-slate-700 dark:text-slate-200">{c.name}</span>
                            <span className="ml-auto flex-shrink-0 text-[10px] text-slate-400">
                                {new Date(c.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Minimal quick-load: radius slider + "Charger ici" + status/progress. */
function QuickLoad() {
    const radius = useMapStore((s) => s.lidarCloudRadius);
    const setRadius = useMapStore((s) => s.setLidarCloudRadius);
    const load = useMapStore((s) => s.loadLidarCloud);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const progress = useMapStore((s) => s.lidarCloudProgress);
    const error = useMapStore((s) => s.lidarCloudError);
    const shaded = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const hasData = shaded !== null || mesh !== null;
    const center = shaded ?? mesh;

    return (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Chargement rapide</h4>

            {loading && progress && <LidarProgressBar progress={progress} />}

            <label className="block">
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Rayon</span>
                    <span className="font-mono text-xs text-slate-400">{radius} m</span>
                </div>
                <input
                    aria-label="Rayon de chargement LiDAR"
                    type="range" min={50} max={600} step={25}
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="mt-1 w-full accent-green-600"
                />
            </label>

            <button
                type="button"
                onClick={() => { load(); }}
                disabled={loading}
                className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {loading ? 'Chargement…' : 'Charger ici'}
            </button>

            {hasData && !loading && center && <LidarStatusLine shaded={shaded} mesh={mesh} radius={center.radius} />}
            {error && (
                <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">
                    {error}
                </p>
            )}
        </div>
    );
}

/**
 * Compact launcher for the LiDAR feature: a hero CTA opening the dedicated
 * LiDAR Studio (`?view=lidar`), a minimal quick-load, and a recently-loaded
 * list. The fine-grained controls now live in the studio dock; both shells
 * read the same mapStore so there is no duplicated state.
 */
export function LidarCloudPanel() {
    const { setView } = useView();

    return (
        <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {LIDAR_ICON}
                Nuage de points LiDAR HD
            </h3>

            {/* Hero CTA → LiDAR Studio */}
            <button
                type="button"
                onClick={() => setView('lidar')}
                className="group flex w-full items-center gap-3 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 p-3.5 text-left text-white shadow-md transition hover:from-green-500 hover:to-emerald-600"
            >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/15">
                    {LIDAR_ICON}
                </span>
                <span className="min-w-0">
                    <span className="block text-sm font-semibold">Ouvrir le studio LiDAR</span>
                    <span className="block text-[11px] text-white/80">Relief 3D plein écran, réglages avancés &amp; ambiances</span>
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="ml-auto h-5 w-5 flex-shrink-0 opacity-80 transition group-hover:translate-x-0.5">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
            </button>

            <QuickLoad />
            <RecentClouds />

            <Suspense fallback={null}>
                <ShowcaseGallery variant="light" />
            </Suspense>
        </div>
    );
}
