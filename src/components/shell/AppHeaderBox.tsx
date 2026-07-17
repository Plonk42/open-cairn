import { CursorCoordinates } from '@/components/map/CursorCoordinates';
import { SearchBox } from '@/components/map/SearchBox';
import { useMapStore } from '@/stores/mapStore';

/** Sun (→ switch to light) / moon (→ switch to dark) glyph for the theme toggle. */
function ThemeToggle() {
    const uiTheme = useMapStore((s) => s.uiTheme);
    const setUiTheme = useMapStore((s) => s.setUiTheme);
    const isDark = uiTheme === 'dark';
    return (
        <button
            type="button"
            onClick={() => setUiTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
            aria-label={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
            className="pointer-events-auto ml-auto flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
            {isDark ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                    <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 101.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.061 1.06l1.06 1.06z" />
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                    <path d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z" />
                </svg>
            )}
        </button>
    );
}

/**
 * Shared top-left chrome box: app logo + name + theme toggle + search field +
 * cursor coordinates. Theme-aware (light default + `dark:` variants) so it can
 * be composed into both the classic Itinéraire view and the LiDAR Studio, both
 * following `uiTheme`.
 *
 * The "Partager" (copy-link) action deliberately lives NOT here but in the
 * Itinéraire view's action group (`RouteShareButton`, beside "Exporter cette
 * vue"): a share URL can't carry a LiDAR cloud, so it only makes sense in the
 * Itinéraire view — keeping it out of this shared box avoids implying it works
 * in the Studio.
 */
export function AppHeaderBox() {
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
                    <ThemeToggle />
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
