import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { parseShareFromUrl } from './lib/shareView';
import { useMapStore } from './stores/mapStore';
import { gateKeyedBaseLayer } from './stores/mapStyleView';
import { loadPersistedRoute, useRouteStore } from './stores/routeStore';
import './styles/index.css';

// Restore shared state BEFORE React renders so that stores are populated
// before MapContainer reads the initial view.
const shared = parseShareFromUrl();
if (shared) {
    const map = useMapStore.getState();
    map.setView(shared.view);
    // The API key is never part of a share link, so the recipient may not have one.
    map.setBaseLayer(gateKeyedBaseLayer(shared.baseLayer, map.ignApiKey));
    map.setHillshadeEnabled(shared.hillshadeEnabled);
    map.setHillshadeSource(shared.hillshadeSource);
    map.setHillshadeBlend(shared.hillshadeBlend);
    map.setHillshadeIntensity(shared.hillshadeIntensity);
    map.setTerrainEnabled(shared.terrainEnabled);
    map.setTerrainExaggeration(shared.terrainExaggeration);
    map.setTerrainDemSource(shared.terrainDemSource);
    map.setContourLinesEnabled(shared.contourLinesEnabled);
    map.setContourLinesOpacity(shared.contourLinesOpacity);
    // Sun/moon: the date comes first and through `applyLidarSunDate`, which also
    // recomputes the four lighting values the atmospheric sky is painted from —
    // setting the date alone would show the right tracks under the wrong sky.
    // It reads the map centre, hence after `setView`.
    map.applyLidarSunDate(shared.sunDate);
    map.setAtmosphericSky(shared.atmosphericSky);
    map.setSkySunPath(shared.skySunPath);
    map.setSkyMoonPath(shared.skyMoonPath);
    map.setSkyHiddenPath(shared.skyHiddenPath);
    if (shared.viewpoint) {
        // The first-person mode is session-only by design; a share link is the one
        // thing allowed to start in it, because there the standpoint IS the view.
        map.setViewpoint(shared.viewpoint.eye);
        // After `setViewpoint`, which clears the framing.
        map.setViewpointFraming(shared.viewpoint.framing);
    }
    const route = useRouteStore.getState();
    route.setActive(false); // Always start in read mode when opening a shared link
    route.setMode(shared.routeMode);
    route.setColorElevationBySlope(shared.colorElevationBySlope);
    if (shared.waypoints.length > 0) {
        route.restoreWaypoints(shared.waypoints);
    }
    route.setMarkers([]); // a shared link carries no marker: drop this browser's leftovers
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
        const route = useRouteStore.getState();
        // Replaying the stored geometry keeps an imported GPX track intact — recomputing
        // from the waypoints alone would replace it with routed or straight segments.
        if (savedRoute.segments) route.restoreRoute(savedRoute.waypoints, savedRoute.segments);
        else route.restoreWaypoints(savedRoute.waypoints);
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
