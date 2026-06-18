import { useMapStore } from '@/stores/mapStore';

const BASEMAPS: ReadonlyArray<{ id: 'ortho' | 'plan'; label: string }> = [
    { id: 'ortho', label: 'Photo' },
    { id: 'plan', label: 'Plan' },
];

/** Quick base-map switch (Photo / Plan). */
export function QuickBasemapSwitch() {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);

    return (
        <div className="flex items-center gap-1.5">
            {/* Basemap layer selector (Photo / Plan). */}
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
            </div>
        </div>
    );
}
