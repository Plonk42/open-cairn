import { CursorCoordinates } from '@/components/map/CursorCoordinates';
import { SearchBox } from '@/components/map/SearchBox';
import { useShare } from '@/lib/useShare';

/**
 * Shared top-left chrome box: app logo + name + Share button + search field +
 * cursor coordinates. Theme-aware (light default + `dark:` variants) so it can
 * be composed into both the classic Itinéraire view (following `uiTheme`) and
 * the LiDAR Studio (wrapped in a `dark` element for its permanent dark look).
 *
 * Self-contained — owns its own `useShare` so both views get identical
 * share-copy behaviour without threading props through.
 */
export function AppHeaderBox() {
    const { shareTooltip, handleShare } = useShare();

    return (
        <div className="w-72">
            <div className="overflow-hidden rounded-lg bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/75 dark:ring-white/10">
                <div className="flex select-none items-center gap-1.5 px-3 py-1.5 text-sm font-semibold">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-4 w-3.5 text-green-600 dark:text-emerald-400">
                        <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                        <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                        <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                        <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                    </svg>
                    <span className="text-slate-700 dark:text-slate-100">open-cairn</span>
                    <button
                        type="button"
                        onClick={handleShare}
                        className="pointer-events-auto relative ml-auto flex items-center gap-1 rounded-md bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                        title="Partager la vue actuelle"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
                            <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        </svg>
                        Partager
                        {shareTooltip && (
                            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow dark:bg-slate-700">
                                Lien copié !
                            </span>
                        )}
                    </button>
                </div>
                <div className="border-t border-black/5 dark:border-white/10">
                    <SearchBox flat />
                </div>
                <div className="border-t border-black/5 px-2 py-1 dark:border-white/10">
                    <CursorCoordinates flat />
                </div>
            </div>
        </div>
    );
}
