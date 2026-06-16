import { lazy, Suspense } from 'react';
import { App } from './App';
import { useView } from './lib/useView';

// The LiDAR Studio is a heavy, dedicated shell — lazy-load it so the classic
// map view stays the lean default entry point.
const LidarStudio = lazy(() =>
    import('./components/lidar/LidarStudio').then((m) => ({ default: m.LidarStudio })),
);

/**
 * Root view switch. Reads `?view=` and renders either the classic map shell
 * (`<App/>`) or the dedicated LiDAR Studio. Shared-state restore already runs
 * in `main.tsx` before this mounts, so both shells read a populated store.
 */
export function Root() {
    const { view } = useView();
    if (view === 'lidar') {
        return (
            <Suspense fallback={<div className="h-screen w-screen bg-slate-950" />}>
                <LidarStudio />
            </Suspense>
        );
    }
    return <App />;
}
