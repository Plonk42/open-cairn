import { ScreenshotTab } from '@/components/shell/ScreenshotTab';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function TabButton({ active, onClick, children }: Readonly<{ active: boolean; onClick: () => void; children: ReactNode }>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
        >
            {children}
        </button>
    );
}

/**
 * Tabbed export dialog shared by both views. Tab 1 ("Image") is the shared
 * screenshot download (identical in every view); tab 2 is view-specific — a
 * LiDAR "Scène" export form in the Studio, a "GPX" export/import panel in the
 * Itinéraire view — supplied by the caller via `secondTab`. Theme-aware
 * (light default + `dark:` variants).
 */
export function ExportDialog({
    secondTabLabel,
    secondTab,
    onClose,
    title = 'Exporter cette vue',
}: Readonly<{
    secondTabLabel: string;
    secondTab: ReactNode;
    onClose: () => void;
    title?: string;
}>) {
    const [tab, setTab] = useState<'image' | 'second'>('image');

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-black/10 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        title="Fermer"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                    </button>
                </div>
                <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/5">
                    <TabButton active={tab === 'image'} onClick={() => setTab('image')}>Image</TabButton>
                    <TabButton active={tab === 'second'} onClick={() => setTab('second')}>{secondTabLabel}</TabButton>
                </div>
                <div className="mt-4">
                    {tab === 'image' ? <ScreenshotTab /> : secondTab}
                </div>
            </div>
        </div>,
        document.body,
    );
}
