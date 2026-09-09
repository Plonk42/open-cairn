import { useFlyover } from '@/lib/useFlyover';

/** Start/stop the 3D flyover. Shared by the route panel and the collapsed dock bar. */
export function FlyoverButton({ size }: Readonly<{ size: 'sm' | 'md' }>) {
    const { isFlying, canFly, toggleFlyover } = useFlyover();

    return (
        <button
            type="button"
            onClick={toggleFlyover}
            disabled={!canFly}
            className={`flex items-center justify-center rounded-md ring-1 ring-gray-200 transition disabled:cursor-not-allowed disabled:opacity-30 dark:ring-slate-600 ${isFlying ? 'bg-violet-50 text-violet-600 ring-violet-300 dark:bg-violet-900/30 dark:text-violet-400 dark:ring-violet-700' : 'text-slate-400 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-900/30'} ${size === 'md' ? 'h-9 w-9' : 'h-7 w-7'}`}
            title={isFlying ? 'Arrêter le survol' : 'Survoler l\'itinéraire en 3D'}
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M3.105 2.29a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.897 28.897 0 0015.293-7.155.75.75 0 000-1.114A28.897 28.897 0 003.105 2.289z" />
            </svg>
        </button>
    );
}
