import { useMapStore } from '@/stores/mapStore';

const BASEMAPS: ReadonlyArray<{ id: 'ortho' | 'plan'; label: string }> = [
    { id: 'ortho', label: 'Photo' },
    { id: 'plan', label: 'Plan' },
];

/** Quick base-map switch (Photo / Plan) + an "Estomper" dim toggle, grouped. */
export function QuickBasemapSwitch() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);
    // lidarCloudHideBasemap fades the basemap (raster-opacity 0.15) — it stays
    // visible underneath the cloud, hence the "Estomper" label (not "hide").
    const dimBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const setDimBasemap = useMapStore((s) => s.setLidarCloudHideBasemap);
    const contours = useMapStore((s) => s.contourLinesEnabled);
    const setContours = useMapStore((s) => s.setContourLinesEnabled);

    return (
        <div className="flex items-center gap-1.5">
            {/* Basemap group: layer selector + its "Estomper" dim toggle, in one pill. */}
            <div className="inline-flex items-center overflow-hidden rounded-md ring-1 ring-white/15">
                <fieldset className="inline-flex">
                    {BASEMAPS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setBaseLayer(id)}
                            aria-pressed={baseLayer === id}
                            className={`px-2.5 py-1 text-xs transition ${baseLayer === id ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                        >
                            {label}
                        </button>
                    ))}
                </fieldset>
                <button
                    type="button"
                    onClick={() => setDimBasemap(!dimBasemap)}
                    title={dimBasemap ? 'Rétablir le fond de carte' : 'Estomper le fond de carte sous le nuage'}
                    aria-pressed={!dimBasemap}
                    className={`flex h-7 items-center gap-1 border-l border-white/15 px-2 text-xs transition ${dimBasemap ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-emerald-500 text-white'}`}
                >
                    {dimBasemap ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l2.4 2.4C2.9 6.92 1.7 8.4 1.07 9.4a1.7 1.7 0 000 1.2C2.32 13.7 5.46 16 9.9 16c1.46 0 2.82-.3 4.02-.84l2.8 2.8a.75.75 0 101.06-1.06L3.28 2.22zM10 13.5a3.5 3.5 0 01-3.32-4.6l4.42 4.42c-.34.12-.71.18-1.1.18zm3.5-3.5c0 .39-.06.76-.18 1.1L8.9 6.68A3.5 3.5 0 0113.5 10z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M10 3.5c-3.9 0-7.2 2.4-8.5 5.9a1.7 1.7 0 000 1.2C2.8 14.1 6.1 16.5 10 16.5s7.2-2.4 8.5-5.9a1.7 1.7 0 000-1.2C17.2 5.9 13.9 3.5 10 3.5zm0 10a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
                        </svg>
                    )}
                    Estomper
                </button>
            </div>
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
