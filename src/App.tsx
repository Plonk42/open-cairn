import { useState } from 'react';
import { MapContainer } from './components/map/MapContainer';
import { LayerSwitcher } from './components/ui/LayerSwitcher';
import { SettingsPanel } from './components/ui/SettingsPanel';

type OpenPanel = 'layers' | 'settings' | null;

export function App() {
    const [openPanel, setOpenPanel] = useState(null as OpenPanel);

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-900 text-slate-100">
            <MapContainer />

            {/* Top-left: app title */}
            <div className="pointer-events-none absolute left-3 top-3 z-10 select-none">
                <div className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm font-semibold backdrop-blur-md ring-1 ring-white/10">
                    open-crete
                </div>
            </div>

            <div className="pointer-events-auto absolute right-3 top-3 z-10 flex w-72 flex-col items-end gap-2">
                <LayerSwitcher
                    open={openPanel === 'layers'}
                    onToggle={() => setOpenPanel((panel) => panel === 'layers' ? null : 'layers')}
                />
                <SettingsPanel
                    open={openPanel === 'settings'}
                    onToggle={() => setOpenPanel((panel) => panel === 'settings' ? null : 'settings')}
                />
            </div>
        </div>
    );
}
