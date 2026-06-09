import { SavedCloudsPanel } from '@/components/ui/SavedCloudsPanel';
import { SavedRoutesPanel } from '@/components/ui/SavedRoutesPanel';
import { useState } from 'react';

type SavedTab = 'routes' | 'clouds';

function SubTabButton({ active, label, icon, onClick }: Readonly<{
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${active
                ? 'bg-white text-green-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
        >
            {icon}
            {label}
        </button>
    );
}

const ROUTES_ICON = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M5 2.75A2.75 2.75 0 017.75 0h4.5A2.75 2.75 0 0115 2.75V18.5a.75.75 0 01-1.18.614L10 16.367 6.18 19.114A.75.75 0 015 18.5V2.75z" />
    </svg>
);

const CLOUDS_ICON = (
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
 * "Enregistrés" panel: groups saved routes and saved LiDAR clouds behind two
 * sub-tabs so both share a single sidebar entry.
 */
export function SavedPanel() {
    const [tab, setTab] = useState<SavedTab>('routes');
    return (
        <div className="space-y-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <SubTabButton active={tab === 'routes'} label="Itinéraires" icon={ROUTES_ICON} onClick={() => setTab('routes')} />
                <SubTabButton active={tab === 'clouds'} label="Nuages LiDAR" icon={CLOUDS_ICON} onClick={() => setTab('clouds')} />
            </div>
            {tab === 'routes' ? <SavedRoutesPanel /> : <SavedCloudsPanel />}
        </div>
    );
}
