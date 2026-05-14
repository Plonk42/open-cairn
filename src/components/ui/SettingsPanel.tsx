import { useState } from 'react';
import { useMapStore } from '@/stores/mapStore';

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
  const setHillshadeIntensity = useMapStore((s) => s.setHillshadeIntensity);
  const terrainEnabled = useMapStore((s) => s.terrainEnabled);
  const setTerrainEnabled = useMapStore((s) => s.setTerrainEnabled);
  const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
  const setTerrainExaggeration = useMapStore((s) => s.setTerrainExaggeration);

  return (
    <div className="pointer-events-auto absolute right-3 top-16 z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-slate-900/70 px-3 py-2 text-sm font-medium backdrop-blur-md ring-1 ring-white/10 hover:bg-slate-800/80"
        aria-label="Réglages"
      >
        Réglages
      </button>
      {open && (
        <div className="mt-2 w-72 rounded-lg bg-slate-900/85 p-3 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur-md">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            Composition
          </div>
          <label className="block">
            <div className="flex items-center justify-between text-slate-200">
              <span>Intensité ombrage</span>
              <span className="font-mono text-xs text-slate-400">
                {Math.round(hillshadeIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={hillshadeIntensity}
              onChange={(e) => setHillshadeIntensity(Number(e.target.value))}
              className="mt-1 w-full accent-emerald-500"
            />
          </label>

          <div className="my-3 h-px bg-white/10" />

          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            Terrain 3D
          </div>
          <label className="flex items-center justify-between">
            <span className="text-slate-200">Activer</span>
            <input
              type="checkbox"
              checked={terrainEnabled}
              onChange={(e) => setTerrainEnabled(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>
          <label className="mt-2 block">
            <div className="flex items-center justify-between text-slate-200">
              <span>Exagération</span>
              <span className="font-mono text-xs text-slate-400">
                ×{terrainExaggeration.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={terrainExaggeration}
              onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
              disabled={!terrainEnabled}
              className="mt-1 w-full accent-emerald-500 disabled:opacity-40"
            />
          </label>
        </div>
      )}
    </div>
  );
}
