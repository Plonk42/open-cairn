import { compositeTileUrl, registerCompositeProtocol, setScanApiKey } from '@/lib/compositeProtocol';
import { ignLayerUrl } from '@/lib/ign';
import { buildMapStyle, directBaseUrl } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lazy, Suspense, useEffect, useRef } from 'react';

// Lazy-loaded so deck.gl + loaders.gl (~1.4 MB) only ship to clients who
// actually use the LiDAR HD point cloud overlay.
const LidarCloudOverlay = lazy(() =>
    import('./LidarCloudOverlay').then((m) => ({ default: m.LidarCloudOverlay })),
);

/**
 * Wrapper that only mounts the (lazy) deck.gl overlay once the user has
 * interacted with the LiDAR feature at least once, keeping the initial page
 * load lean.
 */
function LidarCloudOverlayGate() {
    const active = useMapStore(
        (s) => s.lidarCloud !== null || s.lidarMesh !== null || s.lidarShaded !== null || s.lidarCloudLoading || s.lidarCloudError !== null,
    );
    if (!active) return null;
    return (
        <Suspense fallback={null}>
            <LidarCloudOverlay />
        </Suspense>
    );
}

const ROUTE_LINE_SOURCE = 'open-cairn-route-line';
const ROUTE_POINTS_SOURCE = 'open-cairn-route-points';
const ROUTE_HOVER_SOURCE = 'open-cairn-route-hover';
const ROUTE_SELECTION_SOURCE = 'open-cairn-route-selection';
const ROUTE_SNAP_SOURCE = 'open-cairn-route-snap';
const ROUTE_POINT_LAYERS = ['open-cairn-route-point-fill', 'open-cairn-route-point-halo'];
const LIDAR_PREVIEW_SOURCE = 'open-cairn-lidar-preview';

registerCompositeProtocol();

/**
 * Create a square GeoJSON polygon centered at (lng, lat) with side = 2 * radiusMeters.
 * Uses approximate degree offsets (good enough for France latitudes).
 */
function lidarPreviewGeoJson(lng: number, lat: number, radiusMeters: number): GeoJSON.FeatureCollection {
    // Approximate conversion: 1 degree latitude ≈ 111 km, longitude depends on latitude
    const latOffset = radiusMeters / 111_000;
    const lngOffset = radiusMeters / (111_000 * Math.cos(lat * Math.PI / 180));
    const coordinates: GeoJSON.Position[] = [
        [lng - lngOffset, lat - latOffset],
        [lng + lngOffset, lat - latOffset],
        [lng + lngOffset, lat + latOffset],
        [lng - lngOffset, lat + latOffset],
        [lng - lngOffset, lat - latOffset],
    ];
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [coordinates] },
        }],
    };
}

function ensureLidarPreviewLayer(map: maplibregl.Map): void {
    if (!map.getSource(LIDAR_PREVIEW_SOURCE)) {
        map.addSource(LIDAR_PREVIEW_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getLayer('open-cairn-lidar-preview-fill')) {
        map.addLayer({
            id: 'open-cairn-lidar-preview-fill',
            type: 'fill',
            source: LIDAR_PREVIEW_SOURCE,
            paint: {
                'fill-color': '#ef4444',
                'fill-opacity': 0.15,
            },
        });
    }
    if (!map.getLayer('open-cairn-lidar-preview-line')) {
        map.addLayer({
            id: 'open-cairn-lidar-preview-line',
            type: 'line',
            source: LIDAR_PREVIEW_SOURCE,
            paint: {
                'line-color': '#ef4444',
                'line-width': 2,
                'line-dasharray': [4, 2],
            },
        });
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

export function MapContainer() {
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
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
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
                terrain: initial.terrainEnabled,
                terrainExaggeration: initial.terrainExaggeration,
                renderQuality: initial.renderQuality,
                contourLines: initial.contourLinesEnabled,
                contourLinesOpacity: initial.contourLinesOpacity,
                ignScanApiKey: initial.ignScanApiKey,
                ignDemApiKey: initial.ignDemApiKey,
            }),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            maxPitch: 85,
            canvasContextAttributes: {
                antialias: true,
                powerPreference: 'high-performance',
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
        const terrainControl = new maplibregl.TerrainControl({
            source: 'terrain',
            exaggeration: initial.terrainExaggeration,
        });
        map.addControl(terrainControl, 'bottom-left');
        terrainControl._terrainButton.addEventListener('click', () => {
            globalThis.setTimeout(() => syncTerrainControlState(map), 0);
        });
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

        map.on('moveend', () => {
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

        const refreshRouteLayers = () => syncRouteToMap(map);
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
            const route = useRouteStore.getState();
            if (!route.active) return;
            const waypointId = waypointAt(event.point);
            if (!waypointId) return;
            event.preventDefault();
            route.removeWaypoint(waypointId);
        });

        const startDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
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
                    terrain: current.terrainEnabled,
                    terrainExaggeration: current.terrainExaggeration,
                    renderQuality: current.renderQuality,
                    contourLines: current.contourLinesEnabled,
                    contourLinesOpacity: current.contourLinesOpacity,
                    ignScanApiKey: current.ignScanApiKey,
                    ignDemApiKey: current.ignDemApiKey,
                }),
                { diff: true },
            );
            map.once('idle', () => {
                syncCenterElevationToTerrain(map);
                syncRouteToMap(map);
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
    }, [baseLayer, renderQuality, contourLinesEnabled, contourLinesOpacity, ignScanApiKey, ignDemApiKey]);

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
                    terrain: current.terrainEnabled,
                    terrainExaggeration: current.terrainExaggeration,
                    renderQuality: current.renderQuality,
                    contourLines: current.contourLinesEnabled,
                    contourLinesOpacity: current.contourLinesOpacity,
                    ignScanApiKey: current.ignScanApiKey,
                    ignDemApiKey: current.ignDemApiKey,
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
    useEffect(() => {
        const map = mapRef.current;
        if (!map?.isStyleLoaded()) return;
        if (terrainEnabled) {
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

    // LiDAR preview zone — shows a square on the map indicating what area will be loaded.
    const lidarPreviewVisible = useMapStore((s) => s.lidarPreviewVisible);
    const lidarCloudRadius = useMapStore((s) => s.lidarCloudRadius);
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updatePreview = () => {
            if (!map.isStyleLoaded()) return;
            ensureLidarPreviewLayer(map);
            const source = map.getSource(LIDAR_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
            if (!source) return;
            if (!lidarPreviewVisible) {
                source.setData({ type: 'FeatureCollection', features: [] });
                return;
            }
            // Use screen center (not map.getCenter) so the preview stays centered
            // even when the camera is pitched.
            const canvas = map.getCanvas();
            const screenCenter = map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
            source.setData(lidarPreviewGeoJson(screenCenter.lng, screenCenter.lat, lidarCloudRadius));
        };

        // Initial update
        if (map.isStyleLoaded()) {
            updatePreview();
        } else {
            map.once('load', updatePreview);
        }

        // Update on map move when preview is visible
        if (lidarPreviewVisible) {
            map.on('move', updatePreview);
            return () => { map.off('move', updatePreview); };
        }
        return undefined;
    }, [lidarPreviewVisible, lidarCloudRadius]);

    return (
        <>
            <div ref={containerRef} className="absolute inset-0 h-full w-full" />
            <LidarCloudOverlayGate />
        </>
    );
}
