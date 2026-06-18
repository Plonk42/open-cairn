import { SavedRoutesPanel } from '@/components/ui/SavedRoutesPanel';

/**
 * "Enregistrés" panel: lists saved routes. LiDAR clouds are now browsed
 * exclusively through the studio gallery, so they no longer appear here.
 */
export function SavedPanel() {
    return (
        <div className="space-y-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M5 2.75A2.75 2.75 0 017.75 0h4.5A2.75 2.75 0 0115 2.75V18.5a.75.75 0 01-1.18.614L10 16.367 6.18 19.114A.75.75 0 015 18.5V2.75z" />
                </svg>
                Mes itinéraires
            </h3>
            <SavedRoutesPanel />
        </div>
    );
}
