import { useMapStore } from '@/stores/mapStore';

/**
 * Effects controls brick: Eye-Dome Lighting toggle + strength / neighbour
 * distance / depth sliders. Reads/writes the shared mapStore.
 */
export function LidarEffectsControls() {
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const setEdl = useMapStore((s) => s.setLidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const setEdlStrength = useMapStore((s) => s.setLidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const setEdlRadius = useMapStore((s) => s.setLidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const setEdlFarPlane = useMapStore((s) => s.setLidarCloudEdlFarPlane);

    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Eye-Dome Lighting</span>
                <button
                    type="button"
                    onClick={() => setEdl(!edl)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${edl ? 'bg-green-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                    role="switch"
                    aria-checked={edl}
                >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${edl ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
            </div>
            <fieldset
                disabled={!edl}
                className={`m-0 mt-2 min-w-0 space-y-2 rounded-md border border-slate-200 bg-white/50 p-2 dark:border-slate-600 dark:bg-slate-800/50 ${edl ? '' : 'opacity-50'}`}
            >
                <label className="block">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>Intensité</span>
                        <span className="font-mono text-[10px] text-slate-400">{edlStrength.toFixed(1)}</span>
                    </div>
                    <input
                        aria-label="Intensité EDL"
                        type="range" min={0} max={50} step={0.5}
                        value={edlStrength}
                        onChange={(e) => setEdlStrength(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
                <label className="block">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>Distance voisins</span>
                        <span className="font-mono text-[10px] text-slate-400">{edlRadius.toFixed(1)}</span>
                    </div>
                    <input
                        aria-label="Distance voisins EDL"
                        type="range" min={0.5} max={6} step={0.1}
                        value={edlRadius}
                        onChange={(e) => setEdlRadius(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
                <label className="block">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>Profondeur</span>
                        <span className="font-mono text-[10px] text-slate-400">{edlFarPlane.toFixed(0)}</span>
                    </div>
                    <input
                        aria-label="Profondeur EDL"
                        type="range" min={100} max={5000} step={50}
                        value={edlFarPlane}
                        onChange={(e) => setEdlFarPlane(Number(e.target.value))}
                        className="mt-1 w-full accent-green-600"
                    />
                </label>
            </fieldset>
        </div>
    );
}
