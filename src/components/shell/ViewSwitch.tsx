import { type AppView, useView } from '@/lib/useView';

const VIEWS: ReadonlyArray<{ id: AppView; label: string }> = [
    { id: 'map', label: 'Itinéraire' },
    { id: 'lidar', label: 'Studio LiDAR' },
];

/**
 * Shared segmented control switching the top-level app view
 * (Itinéraire ↔ Studio LiDAR) via `useView().setView`. Theme-aware (light
 * default + `dark:` variants); wrap in a `dark` element to force the dark look
 * (as the LiDAR Studio does).
 */
export function ViewSwitch() {
    const { view, setView } = useView();

    return (
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-white/85 p-0.5 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-950/85 dark:ring-white/10">
            {VIEWS.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => setView(id)}
                    aria-pressed={view === id}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === id
                        ? 'bg-green-600 text-white dark:bg-emerald-500'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
