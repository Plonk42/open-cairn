import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { parseShareFromUrl } from './lib/shareView';
import { useMapStore } from './stores/mapStore';
import { loadPersistedRoute, useRouteStore } from './stores/routeStore';
import './styles/index.css';

// Restore shared state BEFORE React renders so that stores are populated
// before MapContainer reads the initial view.
const shared = parseShareFromUrl();
if (shared) {
    const map = useMapStore.getState();
    map.setView(shared.view);
    map.setBaseLayer(shared.baseLayer);
    map.setHillshadeEnabled(shared.hillshadeEnabled);
    map.setHillshadeSource(shared.hillshadeSource);
    map.setHillshadeBlend(shared.hillshadeBlend);
    map.setHillshadeIntensity(shared.hillshadeIntensity);
    map.setTerrainEnabled(shared.terrainEnabled);
    map.setTerrainExaggeration(shared.terrainExaggeration);
    map.setContourLinesEnabled(shared.contourLinesEnabled);
    map.setContourLinesOpacity(shared.contourLinesOpacity);
    // Cliff slice (only restore when a slice was actually shared)
    if (shared.cliffSlicePoints.length > 0) {
        map.setCliffSlicePoints(shared.cliffSlicePoints);
        map.setCliffSliceCorridor(shared.cliffSliceCorridor);
        map.setCliffSliceClasses(shared.cliffSliceClasses);
        map.setCliffSliceColorClass(shared.cliffSliceColorClass);
        map.setCliffSliceColorDepth(shared.cliffSliceColorDepth);
        map.setCliffSliceRopeSafety(shared.cliffSliceRopeSafety);
        map.setCliffSliceStations(shared.cliffSliceStations);
    }
    const route = useRouteStore.getState();
    route.setActive(false); // Always start in read mode when opening a shared link
    route.setMode(shared.routeMode);
    route.setColorElevationBySlope(shared.colorElevationBySlope);
    if (shared.waypoints.length > 0) {
        route.restoreWaypoints(shared.waypoints);
    }
    if (shared.selectionRange) {
        // Store only the range; coordinates will be computed once route finishes
        useRouteStore.setState({ selectionRange: shared.selectionRange });
    }
    // Clear the hash so MapLibre's hash:true doesn't choke on it, but keep the
    // search params (e.g. ?view=lidar) so the view switch survives a share link.
    history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);
} else {
    // Restore route waypoints from localStorage (map state is restored via store defaults).
    const savedRoute = loadPersistedRoute();
    if (savedRoute.waypoints && savedRoute.waypoints.length > 0) {
        useRouteStore.getState().restoreWaypoints(savedRoute.waypoints);
        if (savedRoute.selectionRange) {
            useRouteStore.setState({ selectionRange: savedRoute.selectionRange });
        }
    }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);
