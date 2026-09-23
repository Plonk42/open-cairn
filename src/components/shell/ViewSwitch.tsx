import { type AppView, useView } from '@/lib/useView';

const VIEWS: ReadonlyArray<{ id: AppView; label: string }> = [
    { id: 'map', label: 'Itinéraire' },
    { id: 'lidar', label: 'Studio LiDAR' },
];

/**
 * Segmented control switching the top-level app view (Itinéraire ↔ Studio
 * LiDAR) via `useView().setView`: the side panel's title on desktop, a pill in
 * the top bar on mobile. Theme-aware (light default + `dark:` variants).
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
