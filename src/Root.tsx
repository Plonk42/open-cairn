import { lazy, Suspense, useEffect } from 'react';
import { App } from './App';
import { MapContainer } from './components/map/MapContainer';
import { useView } from './lib/useView';
import { useMapStore } from './stores/mapStore';

// The LiDAR Studio is a heavy, dedicated shell — lazy-load it so the classic
// map view stays the lean default entry point.
const LidarStudio = lazy(() =>
    import('./components/lidar/LidarStudio').then((m) => ({ default: m.LidarStudio })),
);

/**
 * Root view switch. Reads `?view=` and renders either the classic map shell
 * (`<App/>`) or the dedicated LiDAR Studio. Shared-state restore already runs
 * in `main.tsx` before this mounts, so both shells read a populated store.
 *
 * A single, persistent `<MapContainer/>` is mounted here — above the swapped
 * view chrome — so the MapLibre instance (WebGL context, loaded tiles, terrain
 * mesh) survives a `?view=` switch. Each view renders a `<MapSlot/>` into which
 * this shared map is reparented, instead of building its own map.
 */
export function Root() {
    const { view } = useView();
    const uiTheme = useMapStore((s) => s.uiTheme);

    // Apply the UI theme at the document root so it drives every view. This
    // lives here (not in `App`) because `App` is only mounted for the map view
    // — the Studio would otherwise never react to the theme toggle.
    useEffect(() => {
        document.documentElement.classList.toggle('dark', uiTheme === 'dark');
    }, [uiTheme]);

    // Mirror the URL-driven top-level view into the store so the map-style
    // setters know which per-view copy to write, and swap the active style
    // bundle whenever the view changes.
    useEffect(() => {
        useMapStore.getState().setAppView(view);
    }, [view]);

    return (
        <>
            <MapContainer />
            {view === 'lidar' ? (
                <Suspense fallback={<div className="h-screen w-screen bg-slate-950" />}>
                    <LidarStudio />
                </Suspense>
            ) : (
                <App />
            )}
        </>
    );
}
