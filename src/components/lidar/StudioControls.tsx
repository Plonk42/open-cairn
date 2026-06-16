import { useMapStore } from '@/stores/mapStore';
import { useState } from 'react';

interface DockSectionProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

/** A collapsible titled section inside the studio dock. */
export function DockSection({ title, defaultOpen = false, children }: Readonly<DockSectionProps>) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/40">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-300 transition hover:bg-white/5"
                aria-expanded={open}
            >
                <span>{title}</span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                >
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
            </button>
            {open && <div className="border-t border-white/10 px-3 py-3">{children}</div>}
        </div>
    );
}

const BASEMAPS: ReadonlyArray<{ id: 'ortho' | 'plan'; label: string }> = [
    { id: 'ortho', label: 'Photo' },
    { id: 'plan', label: 'Plan' },
];

/** Quick base-map switch (Photo / Plan) used in the studio top bar. */
export function QuickBasemapSwitch() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    const hideBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const setHideBasemap = useMapStore((s) => s.setLidarCloudHideBasemap);
    const contours = useMapStore((s) => s.contourLinesEnabled);
    const setContours = useMapStore((s) => s.setContourLinesEnabled);

    return (
        <div className="flex items-center gap-1.5">
            <fieldset className="inline-flex overflow-hidden rounded-md ring-1 ring-white/15">
                {BASEMAPS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setBaseLayer(id)}
                        className={`px-2.5 py-1 text-xs transition ${baseLayer === id ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                    >
                        {label}
                    </button>
                ))}
            </fieldset>
            <button
                type="button"
                onClick={() => setHideBasemap(!hideBasemap)}
                title={hideBasemap ? 'Afficher le fond de carte' : 'Masquer le fond de carte'}
                aria-pressed={hideBasemap}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs transition ring-1 ${hideBasemap ? 'bg-white/5 text-slate-300 ring-white/15 hover:bg-white/10' : 'bg-emerald-500 text-white ring-emerald-400'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M10 3.5c-3.9 0-7.2 2.4-8.5 5.9a1.7 1.7 0 000 1.2C2.8 14.1 6.1 16.5 10 16.5s7.2-2.4 8.5-5.9a1.7 1.7 0 000-1.2C17.2 5.9 13.9 3.5 10 3.5zm0 10a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
                </svg>
                Fond
            </button>
            <button
                type="button"
                onClick={() => setContours(!contours)}
                title={contours ? 'Masquer les lignes de niveau' : 'Afficher les lignes de niveau'}
                aria-pressed={contours}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs transition ring-1 ${contours ? 'bg-emerald-500 text-white ring-emerald-400' : 'bg-white/5 text-slate-300 ring-white/15 hover:bg-white/10'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 13c2-3 5-4.5 8-4.5S16 10 18 13M4 16c1.8-2.2 4-3.3 6-3.3S14.2 13.8 16 16M7 9.2C8 7.8 9.3 7 10 7s2 .8 3 2.2" />
                </svg>
                Niveaux
            </button>
        </div>
    );
}
