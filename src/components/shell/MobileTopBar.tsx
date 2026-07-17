import { SearchBox } from '@/components/map/SearchBox';
import { ViewSwitch } from '@/components/shell/ViewSwitch';
import { useMapStore } from '@/stores/mapStore';
import { useState, type ReactNode } from 'react';

/** Sun (→ light) / moon (→ dark) glyph, compact variant of the header toggle. */
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
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
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
 * Shared compact mobile top overlay: app badge (logo + theme toggle + search
 * toggle) on the left, an optional `actions` node and the `ViewSwitch` on the
 * right, and an expandable IGN search field. Theme-aware — composed identically
 * into the Itinéraire and Studio mobile shells so switching views keeps the
 * chrome in place. The "Partager" (copy-link) action is NOT here — it lives in
 * the Itinéraire view's actions menu only (see `RouteShareButton`), since a
 * share URL can't carry a LiDAR cloud.
 */
export function MobileTopBar({ actions }: Readonly<{ actions?: ReactNode }>) {
    const [searchOpen, setSearchOpen] = useState(false);

    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-1.5 p-2">
            <div className="flex items-center gap-2">
                <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-white/85 px-1.5 py-1 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/75 dark:ring-white/10">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-4 w-3.5 text-green-600 dark:text-emerald-400" aria-hidden="true">
                        <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                        <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                        <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                        <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                    </svg>
                    <ThemeToggle />
                    <button
                        type="button"
                        onClick={() => setSearchOpen((o) => !o)}
                        title="Rechercher un lieu"
                        aria-label="Rechercher un lieu"
                        aria-pressed={searchOpen}
                        className={`flex h-7 w-7 items-center justify-center rounded-md transition ${searchOpen
                            ? 'bg-green-600/10 text-green-700 dark:bg-emerald-400/10 dark:text-emerald-300'
                            : 'text-slate-500 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <div className="pointer-events-auto ml-auto flex items-center gap-2">
                    {actions}
                    <ViewSwitch />
                </div>
            </div>

            {searchOpen && (
                <div className="pointer-events-auto overflow-hidden rounded-lg bg-white/90 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/80 dark:ring-white/10">
                    <SearchBox flat />
                </div>
            )}
        </div>
    );
}
