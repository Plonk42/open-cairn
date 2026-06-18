import { useView } from '@/lib/useView';
import { lazy, Suspense } from 'react';

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

/**
 * Compact launcher for the LiDAR feature: a hero CTA opening the dedicated
 * LiDAR Studio (`?view=lidar`) and the showcase gallery. Loading/capturing
 * clouds happens exclusively inside the studio now — the main app only browses
 * existing scenes through the gallery.
 */
export function LidarCloudPanel() {
    const { setView } = useView();

    return (
        <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {LIDAR_ICON}
                Rendu 3D LiDAR
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

            <Suspense fallback={null}>
                <ShowcaseGallery inline />
            </Suspense>
        </div>
    );
}
