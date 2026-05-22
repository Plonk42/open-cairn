import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { parseShareFromUrl } from './lib/shareView';
import { useMapStore } from './stores/mapStore';
import { useRouteStore } from './stores/routeStore';
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
    map.setRenderQuality(shared.renderQuality);
    map.setUiTheme(shared.uiTheme);
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
    // Clear the hash so MapLibre's hash:true doesn't choke on it
    history.replaceState(null, '', globalThis.location.pathname);
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
