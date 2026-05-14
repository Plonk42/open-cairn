import { MapContainer } from './components/map/MapContainer';
import { LayerSwitcher } from './components/ui/LayerSwitcher';
import { SettingsPanel } from './components/ui/SettingsPanel';

export function App() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-900 text-slate-100">
      <MapContainer />

      {/* Top-left: app title */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 select-none">
        <div className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm font-semibold backdrop-blur-md ring-1 ring-white/10">
          open-crete
        </div>
      </div>

      <LayerSwitcher />
      <SettingsPanel />
    </div>
  );
}
