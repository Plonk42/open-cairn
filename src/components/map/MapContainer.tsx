import { compositeTileUrl, registerCompositeProtocol, setScanApiKey } from '@/lib/compositeProtocol';
import { ignLayerUrl } from '@/lib/ign';
import { buildMapStyle, directBaseUrl } from '@/lib/mapStyle';
import { sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useLidarPreviewOverlay } from './useLidarPreviewOverlay';

// Custom WebGL2 layer that renders the shaded LiDAR HD cloud. Lazy-loaded so
// the WebGL plumbing only ships to clients who actually open the LiDAR overlay.
const LidarCloudOverlay = lazy(() =>
    import('./LidarCloudOverlay').then((m) => ({ default: m.LidarCloudOverlay })),
);

// The map is shared with the LiDAR Studio. In that view map clicks must NOT
// edit the itinerary; the owner passes `studio` down explicitly.

/**
 * Applies the studio "Fond de carte" slider to the basemap raster layers.
 *
 * Mounted UNCONDITIONALLY (unlike `LidarCloudOverlay`, which only mounts once a
 * cloud is loaded) so the slider gives live feedback even before any cloud/mesh
 * is displayed. Dimming is scoped to the studio OR to when a cloud is present,
 * so the classic map view is never dimmed by a persisted opacity value.
 *
 * A base-layer switch (Photo/Plan) rebuilds the style via `setStyle({diff:true})`
 * and, because the new style spec carries no `raster-opacity` on the `base`
 * layer, the diff RESETS it to the default 1 — silently dropping the fade. So we
 * re-apply on every `styledata` (fires after any rebuild). The transition is
 * forced to 0 ms so the change is instant, not a 300 ms fade.
 */
function BasemapDimmer({ studio }: { studio: boolean }) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const basemapOpacity = useMapStore((s) => s.lidarCloudBasemapOpacity);
    const lidarShaded = useMapStore((s) => s.lidarShaded);
    const lidarMesh = useMapStore((s) => s.lidarMesh);
    useEffect(() => {
        const map = mapInstance;
        if (!map) return;
        const hasOverlay = lidarShaded !== null || lidarMesh !== null;
        const shouldDim = hasOverlay || studio;
        const targetOpacity = shouldDim ? basemapOpacity : 1;
        const apply = () => {
            const style = map.getStyle();
            if (!style?.layers) return;
            for (const layer of style.layers) {
                if (layer.type !== 'raster') continue;
                try {
                    map.setPaintProperty(layer.id, 'raster-opacity-transition', { duration: 0 });
                    map.setPaintProperty(layer.id, 'raster-opacity', targetOpacity);
                } catch { /* layer might not accept the property */ }
            }
        };
        if (map.isStyleLoaded()) apply();
        else map.once('idle', apply);
        map.on('styledata', apply);
        return () => { map.off('styledata', apply); };
    }, [mapInstance, basemapOpacity, lidarShaded, lidarMesh, studio]);
    return null;
}

// Lazy-loaded so deck.gl (~150 KB gz: core + layers + mapbox) only ships when
// the user actually draws a cliff slice over a loaded LiDAR cloud.
const CliffSlicePathOverlay = lazy(() =>
    import('./CliffSlicePathOverlay').then((m) => ({ default: m.CliffSlicePathOverlay })),
);

/**
 * Wrapper that only mounts the (lazy) LiDAR overlay once the user has
 * interacted with the LiDAR feature at least once, keeping the initial page
 * load lean.
 */
function LidarCloudOverlayGate() {
    const active = useMapStore(
        (s) => s.lidarShaded !== null || s.lidarMesh !== null || s.lidarCloudLoading || s.lidarCloudError !== null,
    );
    if (!active) return null;
    return (
        <Suspense fallback={null}>
            <LidarCloudOverlay />
        </Suspense>
    );
}

/**
 * Mount the cliff-slice 3D path overlay only when there is both LiDAR data
 * loaded and a polyline of ≥2 vertices to draw — otherwise nothing for it
 * to render on/over.
 */
function CliffSlicePathOverlayGate() {
    const active = useMapStore(
        (s) => (s.lidarShaded !== null || s.lidarMesh !== null) && s.cliffSlicePoints.length >= 2,
    );
    if (!active) return null;
    return (
        <Suspense fallback={null}>
            <CliffSlicePathOverlay />
        </Suspense>
    );
}

const ROUTE_LINE_SOURCE = 'open-cairn-route-line';
const ROUTE_POINTS_SOURCE = 'open-cairn-route-points';
const ROUTE_HOVER_SOURCE = 'open-cairn-route-hover';
const ROUTE_SELECTION_SOURCE = 'open-cairn-route-selection';
const ROUTE_SNAP_SOURCE = 'open-cairn-route-snap';
const ROUTE_POINT_LAYERS = ['open-cairn-route-point-fill', 'open-cairn-route-point-halo'];
const CLIFF_SLICE_LINE_SOURCE = 'open-cairn-cliff-slice-line';
const CLIFF_SLICE_CORRIDOR_SOURCE = 'open-cairn-cliff-slice-corridor';
const CLIFF_SLICE_POINTS_SOURCE = 'open-cairn-cliff-slice-points';

registerCompositeProtocol();

/* ──────────────────────── Cliff slice map overlay ──────────────────────── */

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEGREE_LAT = 111_319.491;

/** Compute the four corners of a corridor of half-width `halfM` around segment [start, end]. */
function corridorPolygon(start: [number, number], end: [number, number], halfM: number): GeoJSON.Position[] {
    const refLat = (start[1] + end[1]) / 2;
    const cosLat = Math.cos(refLat * DEG_TO_RAD);
    const dxE = (end[0] - start[0]) * METERS_PER_DEGREE_LAT * cosLat;
    const dyN = (end[1] - start[1]) * METERS_PER_DEGREE_LAT;
    const len = Math.hypot(dxE, dyN) || 1;
    // Perpendicular unit (east, north) → convert offsets back to deg.
    const pE = -dyN / len;
    const pN = dxE / len;
    const dLng = (pE * halfM) / (METERS_PER_DEGREE_LAT * cosLat);
    const dLat = (pN * halfM) / METERS_PER_DEGREE_LAT;
    return [
        [start[0] + dLng, start[1] + dLat],
        [end[0] + dLng, end[1] + dLat],
        [end[0] - dLng, end[1] - dLat],
        [start[0] - dLng, start[1] - dLat],
        [start[0] + dLng, start[1] + dLat],
    ];
}

function cliffSliceLineGeoJson(points: ReadonlyArray<[number, number]>): GeoJSON.FeatureCollection {
    if (points.length === 0) return { type: 'FeatureCollection', features: [] };
    if (points.length === 1) {
        return {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: points[0] } }],
        };
    }
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [...points] },
        }],
    };
}

function cliffSliceCorridorGeoJson(points: ReadonlyArray<[number, number]>, halfM: number): GeoJSON.FeatureCollection {
    if (points.length < 2) return { type: 'FeatureCollection', features: [] };
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [corridorPolygon(points[i], points[i + 1], halfM)] },
        });
    }
    return { type: 'FeatureCollection', features };
}

function cliffSliceEndpointsGeoJson(points: ReadonlyArray<[number, number]>): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < points.length; i += 1) {
        features.push({
            type: 'Feature',
            properties: { role: String.fromCodePoint(65 + i) },
            geometry: { type: 'Point', coordinates: points[i] },
        });
    }
    return { type: 'FeatureCollection', features };
}

function ensureCliffSliceLayers(map: maplibregl.Map): void {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource(CLIFF_SLICE_CORRIDOR_SOURCE)) {
        map.addSource(CLIFF_SLICE_CORRIDOR_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource(CLIFF_SLICE_LINE_SOURCE)) {
        map.addSource(CLIFF_SLICE_LINE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource(CLIFF_SLICE_POINTS_SOURCE)) {
        map.addSource(CLIFF_SLICE_POINTS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('open-cairn-cliff-slice-corridor-fill')) {
        map.addLayer({
            id: 'open-cairn-cliff-slice-corridor-fill',
            type: 'fill',
            source: CLIFF_SLICE_CORRIDOR_SOURCE,
            paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.18 },
        });
    }
    if (!map.getLayer('open-cairn-cliff-slice-corridor-line')) {
        map.addLayer({
            id: 'open-cairn-cliff-slice-corridor-line',
            type: 'line',
            source: CLIFF_SLICE_CORRIDOR_SOURCE,
            paint: { 'line-color': '#0ea5e9', 'line-opacity': 0.6, 'line-width': 1, 'line-dasharray': [2, 3] },
        });
    }
    if (!map.getLayer('open-cairn-cliff-slice-line')) {
        map.addLayer({
            id: 'open-cairn-cliff-slice-line',
            type: 'line',
            source: CLIFF_SLICE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#0284c7', 'line-width': 3 },
        });
    }
    if (!map.getLayer('open-cairn-cliff-slice-endpoint-halo')) {
        map.addLayer({
            id: 'open-cairn-cliff-slice-endpoint-halo',
            type: 'circle',
            source: CLIFF_SLICE_POINTS_SOURCE,
            paint: {
                'circle-radius': 9,
                'circle-color': '#f8fafc',
                'circle-stroke-color': '#0284c7',
                'circle-stroke-width': 2,
            },
        });
    }
    if (!map.getLayer('open-cairn-cliff-slice-endpoint-label')) {
        map.addLayer({
            id: 'open-cairn-cliff-slice-endpoint-label',
            type: 'symbol',
            source: CLIFF_SLICE_POINTS_SOURCE,
            layout: {
                'text-field': ['get', 'role'],
                'text-size': 13,
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': true,
            },
            paint: { 'text-color': '#0284c7' },
        });
    }
}

function syncCliffSliceToMap(map: maplibregl.Map): void {
    ensureCliffSliceLayers(map);
    const s = useMapStore.getState();
    const pts = s.cliffSlicePoints;
    const corridorGj = cliffSliceCorridorGeoJson(pts, s.cliffSliceCorridor);
    const lineGj = cliffSliceLineGeoJson(pts);
    const ptsGj = cliffSliceEndpointsGeoJson(pts);
    updateGeoJsonSource(map, CLIFF_SLICE_CORRIDOR_SOURCE, corridorGj);
    updateGeoJsonSource(map, CLIFF_SLICE_LINE_SOURCE, lineGj);
    updateGeoJsonSource(map, CLIFF_SLICE_POINTS_SOURCE, ptsGj);
    // Hide the terrain-draped 2D line, corridor and A/B markers when LiDAR is
    // loaded — the deck.gl overlay redraws them all on the cloud surface
    // instead, so they end up at the right elevation against the cliff.
    const hasLidar = s.lidarShaded !== null || s.lidarMesh !== null;
    const draped = hasLidar && pts.length >= 2 ? 'none' : 'visible';
    for (const layerId of [
        'open-cairn-cliff-slice-line',
        'open-cairn-cliff-slice-corridor-fill',
        'open-cairn-cliff-slice-corridor-line',
        'open-cairn-cliff-slice-endpoint-halo',
        'open-cairn-cliff-slice-endpoint-label',
    ]) {
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', draped);
        }
    }
}

function syncCenterElevationToTerrain(map: maplibregl.Map): void {
    if (!map.getTerrain()) return;
    const elevation = map.queryTerrainElevation(map.getCenter());
    if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return;
    if (Math.abs(map.getCenterElevation() - elevation) < 0.5) return;

    // Preserve camera state to prevent zoom/pitch changes when setting elevation
    const center = map.getCenter();
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const bearing = map.getBearing();

    map.setCenterElevation(elevation);

    // Restore camera state immediately to prevent visible jump
    map.jumpTo({ center, zoom, pitch, bearing });
}

function pixelRatioForQuality(quality: 'balanced' | 'sharp'): number {
    const dpr = globalThis.devicePixelRatio || 1;
    if (quality === 'sharp') return Math.min(dpr, 3);
    return Math.min(dpr, 2);
}

function syncTerrainControlState(map: maplibregl.Map): void {
    const terrainEnabledNow = Boolean(map.getTerrain());
    useMapStore.getState().setTerrainEnabled(terrainEnabledNow);
    if (terrainEnabledNow) map.once('idle', () => syncCenterElevationToTerrain(map));
}

function ensureSnapOverlay(map: maplibregl.Map): void {
    if (!map.getSource(ROUTE_SNAP_SOURCE)) {
        map.addSource(ROUTE_SNAP_SOURCE, {
            type: 'geojson',
            maxzoom: 22,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getLayer('open-cairn-route-snap-casing')) {
        map.addLayer({
            id: 'open-cairn-route-snap-casing',
            type: 'line',
            source: ROUTE_SNAP_SOURCE,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-color': '#f8fafc',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 5.5, 20, 7],
            },
        });
    }
    if (!map.getLayer('open-cairn-route-snap-line')) {
        map.addLayer({
            id: 'open-cairn-route-snap-line',
            type: 'line',
            source: ROUTE_SNAP_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#1379d3',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4, 20, 5],
                'line-dasharray': [1, 2],
            },
        });
    }
}

function ensureRouteLayers(map: maplibregl.Map): void {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource(ROUTE_LINE_SOURCE)) {
        map.addSource(ROUTE_LINE_SOURCE, {
            type: 'geojson',
            maxzoom: 22,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_POINTS_SOURCE)) {
        map.addSource(ROUTE_POINTS_SOURCE, {
            type: 'geojson',
            maxzoom: 22,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_HOVER_SOURCE)) {
        map.addSource(ROUTE_HOVER_SOURCE, {
            type: 'geojson',
            maxzoom: 22,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_SELECTION_SOURCE)) {
        map.addSource(ROUTE_SELECTION_SOURCE, {
            type: 'geojson',
            maxzoom: 22,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getLayer('open-cairn-route-line-casing')) {
        map.addLayer({
            id: 'open-cairn-route-line-casing',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#f8fafc',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 5.5, 20, 7],
            },
        });
    }
    if (!map.getLayer('open-cairn-route-line')) {
        map.addLayer({
            id: 'open-cairn-route-line',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#1379d3',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4, 20, 5],
            },
            filter: ['!=', ['get', 'mode'], 'free'],
        });
    }
    if (!map.getLayer('open-cairn-route-line-free')) {
        map.addLayer({
            id: 'open-cairn-route-line-free',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#f97316',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4, 20, 5],
                'line-dasharray': [1, 2],
            },
            filter: ['==', ['get', 'mode'], 'free'],
        });
    }
    if (!map.getLayer('open-cairn-route-hover-halo')) {
        map.addLayer({
            id: 'open-cairn-route-hover-halo',
            type: 'circle',
            source: ROUTE_HOVER_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 18, 11],
                'circle-color': '#fff7ed',
                'circle-opacity': 1,
            },
        });
    }
    if (!map.getLayer('open-cairn-route-hover')) {
        map.addLayer({
            id: 'open-cairn-route-hover',
            type: 'circle',
            source: ROUTE_HOVER_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 8],
                'circle-color': '#f97316',
                'circle-opacity': 1,
            },
        });
    }
    if (!map.getLayer('open-cairn-route-selection-line')) {
        map.addLayer({
            id: 'open-cairn-route-selection-line',
            type: 'line',
            source: ROUTE_SELECTION_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#fbbf24',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4, 20, 5],
            },
        });
    }
    ensureSnapOverlay(map);
    if (!map.getLayer('open-cairn-route-point-halo')) {
        map.addLayer({
            id: 'open-cairn-route-point-halo',
            type: 'circle',
            source: ROUTE_POINTS_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 18, 11],
                'circle-color': '#f8fafc',
                'circle-opacity': 0.95,
                'circle-stroke-color': '#0f172a',
                'circle-stroke-width': 1,
            },
        });
    }
    if (!map.getLayer('open-cairn-route-point-fill')) {
        map.addLayer({
            id: 'open-cairn-route-point-fill',
            type: 'circle',
            source: ROUTE_POINTS_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 8],
                'circle-color': ['case', ['boolean', ['get', 'deleteMode'], false], '#f43f5e', ['==', ['get', 'role'], 'start'], '#10b981', ['==', ['get', 'role'], 'end'], '#f97316', '#0ea5e9'],
            },
        });
    }
    if (!map.getLayer('open-cairn-route-point-label')) {
        map.addLayer({
            id: 'open-cairn-route-point-label',
            type: 'symbol',
            source: ROUTE_POINTS_SOURCE,
            layout: {
                'text-field': ['get', 'label'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 18, 14],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-anchor': 'center',
                'text-allow-overlap': true,
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#0f172a',
                'text-halo-width': 1.5,
            },
        });
    }
    // Move LiDAR layer under route layers so the itinerary is visible on top.
    if (map.getLayer('lidar-shaded-cloud') && map.getLayer('open-cairn-route-line-casing')) {
        try { map.moveLayer('lidar-shaded-cloud', 'open-cairn-route-line-casing'); } catch { /* ignore */ }
    }
}

function routeLineGeoJson(segments: ReturnType<typeof useRouteStore.getState>['routeSegments']): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: segments.filter((segment) => segment.coordinates.length >= 2).map((segment) => {
            // Exclude snap portions from the rendered route line
            const start = segment.hasSnapStart ? 1 : 0;
            const end = segment.coordinates.length - (segment.hasSnapEnd ? 1 : 0);
            const coords = segment.coordinates.slice(start, end);
            return {
                type: 'Feature' as const,
                properties: { mode: segment.mode },
                geometry: { type: 'LineString' as const, coordinates: coords.length >= 2 ? coords : segment.coordinates },
            };
        }),
    };
}

function waypointRole(index: number, count: number): string {
    if (index === 0) return 'start';
    if (index === count - 1) return 'end';
    return 'middle';
}

function routePointsGeoJson(waypoints: ReturnType<typeof useRouteStore.getState>['waypoints'], deleteMode: boolean): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: waypoints.map((waypoint, index) => ({
            type: 'Feature',
            properties: {
                id: waypoint.id,
                role: waypointRole(index, waypoints.length),
                label: `${index + 1}`,
                deleteMode,
            },
            geometry: { type: 'Point', coordinates: waypoint.coordinate },
        })),
    };
}

function hoverGeoJson(coordinate: [number, number] | null): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: coordinate ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } }] : [],
    };
}

function snapLinesGeoJson(segments: ReturnType<typeof useRouteStore.getState>['routeSegments']): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (const seg of segments) {
        if (seg.mode !== 'auto') continue;
        const coords = seg.coordinates;
        if (coords.length < 2) continue;
        if (seg.hasSnapStart) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coords[0], coords[1]] } });
        }
        if (seg.hasSnapEnd) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coords.at(-2)!, coords.at(-1)!] } });
        }
    }
    return { type: 'FeatureCollection', features };
}

function selectionGeoJson(coordinates: [number, number][]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: coordinates.length >= 2
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
            : [],
    };
}

function updateGeoJsonSource(map: maplibregl.Map, sourceId: string, data: GeoJSON.FeatureCollection): void {
    const source = map.getSource(sourceId);
    if (source?.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(data);
}

function syncRouteToMap(map: maplibregl.Map): void {
    ensureRouteLayers(map);
    const route = useRouteStore.getState();
    updateGeoJsonSource(map, ROUTE_LINE_SOURCE, routeLineGeoJson(route.routeSegments));
    updateGeoJsonSource(map, ROUTE_POINTS_SOURCE, routePointsGeoJson(route.waypoints, route.deleteMode));
    updateGeoJsonSource(map, ROUTE_HOVER_SOURCE, hoverGeoJson(route.hoverCoordinate));
    updateGeoJsonSource(map, ROUTE_SELECTION_SOURCE, selectionGeoJson(route.selectionCoordinates));
    updateGeoJsonSource(map, ROUTE_SNAP_SOURCE, snapLinesGeoJson(route.routeSegments));
}

function routeCursor(route: ReturnType<typeof useRouteStore.getState>): string {
    if (route.deleteMode) return 'cell';
    if (route.active) return 'crosshair';
    return '';
}

/**
 * Push the current sun direction into the dynamic `sun-hillshade` layer's
 * paint properties. Azimuth → illumination-direction, elevation → altitude
 * (0 = grazing/sunset, 90 = zenith), warm sun tint → highlight color. No-op
 * when the layer isn't present (e.g. sun hillshade disabled).
 */
function applySunHillshade(map: maplibregl.Map, sunDate: string): void {
    if (!map.getLayer('sun-hillshade')) return;
    const c = map.getCenter();
    const date = new Date(sunDate);
    if (Number.isNaN(date.getTime())) return;
    const { azimuthDeg, elevationDeg, color } = sunLighting(date, c.lat, c.lng);
    const altitude = Math.max(0, Math.min(90, elevationDeg));
    const [r, g, b] = color.map((v) => Math.round(v * 255));
    map.setPaintProperty('sun-hillshade', 'hillshade-illumination-direction', azimuthDeg);
    map.setPaintProperty('sun-hillshade', 'hillshade-illumination-altitude', altitude);
    map.setPaintProperty('sun-hillshade', 'hillshade-highlight-color', `rgb(${r}, ${g}, ${b})`);
}

export function MapContainer({ studio = false }: Readonly<{ studio?: boolean }>) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const draggedWaypointIdRef = useRef<string | null>(null);
    const dragMovedRef = useRef(false);

    const baseLayer = useMapStore((s) => s.baseLayer);
    const view = useMapStore((s) => s.view);
    const setView = useMapStore((s) => s.setView);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const sunHillshadeEnabled = useMapStore((s) => s.sunHillshadeEnabled);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
    const terrainDemSource = useMapStore((s) => s.terrainDemSource);
    const renderQuality = useMapStore((s) => s.renderQuality);
    const contourLinesEnabled = useMapStore((s) => s.contourLinesEnabled);
    const contourLinesOpacity = useMapStore((s) => s.contourLinesOpacity);
    const ignScanApiKey = useMapStore((s) => s.ignScanApiKey);
    const ignDemApiKey = useMapStore((s) => s.ignDemApiKey);

    // Keep composite protocol in sync with the current SCAN API key.
    useEffect(() => { setScanApiKey(ignScanApiKey); }, [ignScanApiKey]);

    // Initial map creation (runs once)
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const initial = useMapStore.getState();
        setScanApiKey(initial.ignScanApiKey);
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: buildMapStyle({
                base: initial.baseLayer,
                hillshade: initial.hillshadeEnabled,
                hillshadeSource: initial.hillshadeSource,
                hillshadeBlend: initial.hillshadeBlend,
                hillshadeIntensity: initial.hillshadeIntensity,
                sunHillshade: initial.sunHillshadeEnabled,
                terrain: studio || initial.terrainEnabled,
                terrainExaggeration: initial.terrainExaggeration,
                renderQuality: initial.renderQuality,
                contourLines: initial.contourLinesEnabled,
                contourLinesOpacity: initial.contourLinesOpacity,
                ignScanApiKey: initial.ignScanApiKey,
                ignDemApiKey: initial.ignDemApiKey,
                terrainDemSource: initial.terrainDemSource,
            }),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            maxPitch: 85,
            canvasContextAttributes: {
                antialias: true,
                powerPreference: 'high-performance',
                // Keep the rendered frame readable so the LiDAR Studio can grab
                // showcase thumbnails / clean captures from the canvas.
                preserveDrawingBuffer: true,
            },
            anisotropicFilterPitch: 0,
            pixelRatio: pixelRatioForQuality(initial.renderQuality),
            // Allow overzoom past the source maxzoom so users can keep
            // diving in past z19 (MapLibre will reuse parent tiles).
            maxZoom: 21,
            // Keep camera center clamped to terrain surface so rotation/panning
            // pivots naturally around the visible terrain center.
            centerClampedToGround: true,
            attributionControl: false,
            hash: true,
        });
        mapRef.current = map;
        useMapStore.getState().setMapInstance(map);
        if (import.meta.env.DEV)
            (globalThis as unknown as { __map: maplibregl.Map }).__map = map;

        // MapLibre prepends controls in the bottom-* corners (last-added shows at top),
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

        map.addControl(
            new maplibregl.NavigationControl({
                visualizePitch: true,
                showZoom: true,
                showCompass: true,
            }),
            'bottom-left',
        );
        map.addControl(
            new maplibregl.GeolocateControl({
                positionOptions: { enableHighAccuracy: true },
                trackUserLocation: false,
                showUserLocation: true,
            }),
            'bottom-left',
        );
        // In the LiDAR Studio, 3D terrain is forced on and not user-toggleable,
        // so the terrain control button is omitted there.
        if (!studio) {
            const terrainControl = new maplibregl.TerrainControl({
                source: 'terrain',
                exaggeration: initial.terrainExaggeration,
            });
            map.addControl(terrainControl, 'bottom-left');
            terrainControl._terrainButton.addEventListener('click', () => {
                globalThis.setTimeout(() => syncTerrainControlState(map), 0);
            });
        }

        map.on('moveend', (e) => {
            // The orbit loop drives `jumpTo` every frame; persisting the view
            // (and thus re-rendering MapContainer, a `view` subscriber) 60×/s
            // makes the orbit stutter. Orbit frames are tagged via eventData so
            // we skip them — the final untagged restore frame still persists.
            if ((e as { orbit?: boolean }).orbit) return;
            const c = map.getCenter();
            setView({
                longitude: c.lng,
                latitude: c.lat,
                zoom: map.getZoom(),
                pitch: map.getPitch(),
                bearing: map.getBearing(),
            });
        });

        map.once('idle', () => syncCenterElevationToTerrain(map));

        const refreshRouteLayers = () => { syncRouteToMap(map); syncCliffSliceToMap(map); };
        map.once('load', refreshRouteLayers);
        map.on('styledata', refreshRouteLayers);

        const waypointAt = (point: maplibregl.PointLike): string | null => {
            if (!map.getLayer('open-cairn-route-point-fill')) return null;
            const clickPoint = point as maplibregl.Point;
            const features = map.queryRenderedFeatures([
                [clickPoint.x - 12, clickPoint.y - 12],
                [clickPoint.x + 12, clickPoint.y + 12],
            ], { layers: ROUTE_POINT_LAYERS });
            const id = features[0]?.properties?.id;
            if (typeof id === 'string') return id;

            const nearest = useRouteStore.getState().waypoints
                .map((waypoint) => {
                    const projected = map.project(waypoint.coordinate);
                    const distance = Math.hypot(projected.x - clickPoint.x, projected.y - clickPoint.y);
                    return { id: waypoint.id, distance };
                })
                .sort((a, b) => a.distance - b.distance)[0];
            return nearest && nearest.distance <= 28 ? nearest.id : null;
        };

        map.on('click', (event) => {
            // The LiDAR Studio shares this map but must never edit the itinerary.
            if (studio) return;
            const slice = useMapStore.getState();
            // Cliff mode owns the click — never fall through to route, even when
            // the slice tracé sub-mode is off (read-only chart viewing).
            if (slice.bottomMode === 'cliff') {
                if (slice.cliffSliceActive) {
                    const coord: [number, number] = [event.lngLat.lng, event.lngLat.lat];
                    slice.addCliffSlicePoint(coord);
                    event.preventDefault?.();
                }
                return;
            }
            const route = useRouteStore.getState();
            if (!route.active) return;
            const waypointId = waypointAt(event.point);
            if (route.deleteMode) {
                if (waypointId) route.removeWaypoint(waypointId);
                return;
            }
            if (waypointId) return;
            route.addWaypoint([event.lngLat.lng, event.lngLat.lat]);
        });

        map.on('dblclick', (event) => {
            if (studio) return;
            if (useMapStore.getState().bottomMode === 'cliff') return;
            const route = useRouteStore.getState();
            if (!route.active) return;
            const waypointId = waypointAt(event.point);
            if (!waypointId) return;
            event.preventDefault();
            // If double-clicking on the start point with 2+ waypoints, close the loop
            if (route.waypoints.length >= 2 && waypointId === route.waypoints[0].id) {
                route.addWaypoint(route.waypoints[0].coordinate);
                return;
            }
            route.removeWaypoint(waypointId);
        });

        map.on('contextmenu', (event) => {
            if (studio) return;
            if (useMapStore.getState().bottomMode === 'cliff') return;
            const route = useRouteStore.getState();
            if (!route.active) return;
            const waypointId = waypointAt(event.point);
            if (!waypointId) return;
            event.preventDefault();
            route.removeWaypoint(waypointId);
        });

        const startDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            // Dragging waypoints only makes sense in route mode.
            if (studio) return;
            if (useMapStore.getState().bottomMode === 'cliff') return;
            const route = useRouteStore.getState();
            if (!route.active || route.deleteMode) return;
            const waypointId = waypointAt(event.point);
            if (!waypointId) return;
            event.preventDefault();
            draggedWaypointIdRef.current = waypointId;
            dragMovedRef.current = false;
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
        };
        const moveDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            const waypointId = draggedWaypointIdRef.current;
            if (!waypointId) return;
            dragMovedRef.current = true;
            useRouteStore.getState().moveWaypoint(waypointId, [event.lngLat.lng, event.lngLat.lat], false);
        };
        const endDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            const waypointId = draggedWaypointIdRef.current;
            if (!waypointId) return;
            draggedWaypointIdRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = '';
            if (dragMovedRef.current) {
                useRouteStore.getState().moveWaypoint(waypointId, [event.lngLat.lng, event.lngLat.lat], true);
            }
        };

        map.on('mousedown', startDrag);
        map.on('touchstart', startDrag);
        map.on('mousemove', moveDrag);
        map.on('touchmove', moveDrag);
        map.on('mouseup', endDrag);
        map.on('touchend', endDrag);

        return () => {
            map.remove();
            mapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Rebuild style when structural settings change (base layer, hillshade on/off,
    // render quality, contour lines). Uses diff mode to preserve terrain mesh.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const handle = globalThis.setTimeout(() => {
            const current = useMapStore.getState();
            map.setStyle(
                buildMapStyle({
                    base: baseLayer,
                    hillshade: hillshadeEnabled,
                    hillshadeSource,
                    hillshadeBlend,
                    hillshadeIntensity,
                    sunHillshade: sunHillshadeEnabled,
                    terrain: studio || current.terrainEnabled,
                    terrainExaggeration: current.terrainExaggeration,
                    renderQuality: current.renderQuality,
                    contourLines: current.contourLinesEnabled,
                    contourLinesOpacity: current.contourLinesOpacity,
                    ignScanApiKey: current.ignScanApiKey,
                    ignDemApiKey: current.ignDemApiKey,
                    terrainDemSource: current.terrainDemSource,
                }),
                { diff: true },
            );
            map.once('idle', () => {
                syncCenterElevationToTerrain(map);
                syncRouteToMap(map);
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
    }, [baseLayer, renderQuality, contourLinesEnabled, contourLinesOpacity, ignScanApiKey, ignDemApiKey, sunHillshadeEnabled, terrainDemSource]);

    // When only hillshade compositing params change (source, blend, intensity),
    // swap the tile URL on the existing source to avoid any style diff overhead.
    // This preserves the terrain mesh and avoids white flashes.
    const hillshadeParamsInitial = useRef(true);
    useEffect(() => {
        // Skip the first run — the initial style already has the correct URL.
        if (hillshadeParamsInitial.current) {
            hillshadeParamsInitial.current = false;
            return;
        }
        const map = mapRef.current;
        if (!map) return;
        const handle = globalThis.setTimeout(() => {
            const current = useMapStore.getState();
            const baseSource = map.getSource('base') as maplibregl.RasterTileSource | undefined;
            if (!baseSource) return;

            if (baseLayer === 'lidar') {
                // In LiDAR mode the base is a direct shadow layer URL
                const shadowKeyMap = { mns: 'lidarMnsShadow', mnt: 'lidarMntShadow', mnh: 'lidarMnhShadow' } as const;
                const newUrl = ignLayerUrl(shadowKeyMap[hillshadeSource]);
                baseSource.setTiles([newUrl]);
            } else if (hillshadeEnabled) {
                // Composite mode: rebuild the composite URL
                const detailScale = current.renderQuality === 'sharp' ? 2 : 1;
                const keyMap: Record<string, 'scan25Tour' | 'planIgn' | 'ortho' | 'osm'> = { scan25: 'scan25Tour', plan: 'planIgn', ortho: 'ortho', osm: 'osm' };
                const compositeBase = keyMap[baseLayer];
                if (!compositeBase) return;
                const newUrl = compositeTileUrl(
                    compositeBase,
                    hillshadeSource,
                    hillshadeBlend,
                    hillshadeIntensity,
                    detailScale,
                );
                baseSource.setTiles([newUrl]);
            } else {
                // Hillshade disabled: restore the direct tile URL
                const keyMap: Record<string, 'scan25Tour' | 'planIgn' | 'ortho' | 'osm'> = { scan25: 'scan25Tour', plan: 'planIgn', ortho: 'ortho', osm: 'osm' };
                const compositeBase = keyMap[baseLayer];
                if (!compositeBase) return;
                baseSource.setTiles([directBaseUrl(compositeBase, current.ignScanApiKey)]);
            }
        }, 120);
        return () => globalThis.clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hillshadeSource, hillshadeBlend, hillshadeIntensity, hillshadeEnabled]);

    // Drive the dynamic sun-hillshade layer's illumination from the selected
    // sun date. Re-applied on style rebuilds (the layer is recreated with
    // default paint) via a one-shot 'idle' retry when it isn't ready yet.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !sunHillshadeEnabled) return;
        if (map.getLayer('sun-hillshade')) {
            applySunHillshade(map, sunDate);
            return;
        }
        const onIdle = () => applySunHillshade(map, sunDate);
        map.once('idle', onIdle);
        return () => { map.off('idle', onIdle); };
    }, [sunHillshadeEnabled, sunDate]);

    // Re-fetch all tiles when tile cache is cleared.
    useEffect(() => {
        const handler = () => {
            const map = mapRef.current;
            if (!map) return;
            // Force MapLibre to drop all cached tiles and re-request them
            // by triggering a full style reload with diff mode.
            const current = useMapStore.getState();
            map.setStyle(
                buildMapStyle({
                    base: current.baseLayer,
                    hillshade: current.hillshadeEnabled,
                    hillshadeSource: current.hillshadeSource,
                    hillshadeBlend: current.hillshadeBlend,
                    hillshadeIntensity: current.hillshadeIntensity,
                    sunHillshade: current.sunHillshadeEnabled,
                    terrain: studio || current.terrainEnabled,
                    terrainExaggeration: current.terrainExaggeration,
                    renderQuality: current.renderQuality,
                    contourLines: current.contourLinesEnabled,
                    contourLinesOpacity: current.contourLinesOpacity,
                    ignScanApiKey: current.ignScanApiKey,
                    ignDemApiKey: current.ignDemApiKey,
                    terrainDemSource: current.terrainDemSource,
                }),
                { diff: false },
            );
        };
        globalThis.addEventListener('composite-tile-reload', handler);
        return () => globalThis.removeEventListener('composite-tile-reload', handler);
    }, []);

    useEffect(() => {
        mapRef.current?.setPixelRatio(pixelRatioForQuality(renderQuality));
    }, [renderQuality]);

    // Terrain on/off + exaggeration (no style rebuild needed).
    // In the LiDAR Studio 3D terrain is forced on (no user toggle).
    useEffect(() => {
        const map = mapRef.current;
        if (!map?.isStyleLoaded()) return;
        if (terrainEnabled || studio) {
            map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
            map.once('idle', () => syncCenterElevationToTerrain(map));
        } else {
            map.setTerrain(null);
        }
    }, [terrainEnabled, terrainExaggeration]);

    useEffect(() => {
        const map = mapRef.current;
        if (map?.isStyleLoaded()) syncRouteToMap(map);
        return useRouteStore.subscribe((route) => {
            const m = mapRef.current;
            if (!m?.getStyle()?.layers) return;
            ensureRouteLayers(m);
            updateGeoJsonSource(m, ROUTE_LINE_SOURCE, routeLineGeoJson(route.routeSegments));
            updateGeoJsonSource(m, ROUTE_POINTS_SOURCE, routePointsGeoJson(route.waypoints, route.deleteMode));
            updateGeoJsonSource(m, ROUTE_HOVER_SOURCE, hoverGeoJson(route.hoverCoordinate));
            updateGeoJsonSource(m, ROUTE_SELECTION_SOURCE, selectionGeoJson(route.selectionCoordinates));
            updateGeoJsonSource(m, ROUTE_SNAP_SOURCE, snapLinesGeoJson(route.routeSegments));
            m.getCanvas().style.cursor = routeCursor(route);
        });
    }, []);

    // Cliff slice line + corridor sync.
    useEffect(() => {
        const map = mapRef.current;
        if (map?.isStyleLoaded()) syncCliffSliceToMap(map);
        return useMapStore.subscribe((state, prev) => {
            const m = mapRef.current;
            if (!m?.getStyle()?.layers) return;
            const cursorChanged = state.cliffSliceActive !== prev.cliffSliceActive;
            const lineChanged = state.cliffSlicePoints !== prev.cliffSlicePoints
                || state.cliffSliceCorridor !== prev.cliffSliceCorridor;
            const lidarPresenceChanged = (state.lidarShaded !== null || state.lidarMesh !== null)
                !== (prev.lidarShaded !== null || prev.lidarMesh !== null);
            // Only re-sync the 2D cliff layers when (a) the polyline / corridor
            // itself changed, or (b) LiDAR appeared/disappeared and we already
            // have a polyline to show — the visibility toggle inside
            // syncCliffSliceToMap is the only thing that needs to react to
            // LiDAR presence. With no polyline there is nothing to update,
            // and calling syncCliffSliceToMap pointlessly mutates the style
            // (ensureCliffSliceLayers adds layers) right when the preview
            // effect is trying to clear itself.
            if (lineChanged
                || (lidarPresenceChanged && state.cliffSlicePoints.length >= 2)) {
                syncCliffSliceToMap(m);
            }
            if (cursorChanged) {
                if (state.cliffSliceActive) m.getCanvas().style.cursor = 'crosshair';
                else if (!useRouteStore.getState().active) m.getCanvas().style.cursor = '';
            }
        });
    }, []);

    // LiDAR preview zone — shows a square on the map indicating what area will be loaded.
    useLidarPreviewOverlay(mapRef);

    return (
        <>
            <div ref={containerRef} className="absolute inset-0 h-full w-full" />
            <LidarCloudOverlayGate />
            <BasemapDimmer studio={studio} />
            <CliffSlicePathOverlayGate />
        </>
    );
}
