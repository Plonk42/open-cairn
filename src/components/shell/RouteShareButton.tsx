import { useShare } from '@/lib/useShare';

function ShareIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
            <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
    );
}

/**
 * Itinéraire-view "Partager" button — copies a URL encoding the current camera,
 * layers and route/cliff state to the clipboard.
 *
 * Deliberately scoped to the Itinéraire view only (composed beside "Exporter
 * cette vue", never into the Studio): a share URL cannot carry a LiDAR point
 * cloud, so link-sharing is meaningless in the Studio — which persists/shares
 * scenes through the gallery + scene export instead. Keeping this button out of
 * the shared header chrome and next to the Itinéraire export makes its scope
 * self-evident. Styled to fit both the desktop top-bar action group and the
 * mobile actions dropdown.
 */
export function RouteShareButton() {
    const { shareTooltip, handleShare } = useShare();
    return (
        <button
            type="button"
            onClick={handleShare}
            title="Copier un lien vers cette vue (position, calques, itinéraire)"
            className="relative inline-flex items-center gap-1.5 rounded-md bg-green-600/10 px-3 py-1.5 text-xs font-medium text-green-700 ring-1 ring-green-600/20 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20 dark:hover:bg-emerald-400/20"
        >
            <ShareIcon className="h-4 w-4" />
            <span>Partager</span>
            {shareTooltip && (
                <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow dark:bg-slate-700">
                    Lien copié !
                </span>
            )}
        </button>
    );
}
