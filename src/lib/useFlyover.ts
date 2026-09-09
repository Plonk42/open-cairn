import { FlyoverController } from '@/lib/flyover';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback } from 'react';

// Module scope: the flight has to survive `RoutePanel` unmounting, which is
// exactly what happens when the dock is collapsed to its summary bar mid-flight.
let controller: FlyoverController | null = null;

/** Shared start/stop of the 3D flyover, usable from any button in the UI. */
export function useFlyover() {
    const isFlying = useRouteStore((s) => s.flyoverActive);
    const canFly = useRouteStore((s) => s.routeCoordinates.length >= 2);

    const toggleFlyover = useCallback(() => {
        const route = useRouteStore.getState();
        if (route.flyoverActive) {
            // `stop()` cancels the pending frame, so `onEnd` never fires.
            controller?.stop();
            route.setFlyoverActive(false);
            route.setHoverDistance(null);
            return;
        }
        const map = useMapStore.getState().mapInstance;
        if (!map || route.routeCoordinates.length < 2) return;
        controller = new FlyoverController();
        route.setFlyoverActive(true);
        controller.start(map, route.routeCoordinates, {
            profile: route.profile,
            onProgress: (d) => useRouteStore.getState().setHoverDistance(d),
            onEnd: () => {
                useRouteStore.getState().setFlyoverActive(false);
                useRouteStore.getState().setHoverDistance(null);
            },
        });
    }, []);

    return { isFlying, canFly, toggleFlyover };
}
