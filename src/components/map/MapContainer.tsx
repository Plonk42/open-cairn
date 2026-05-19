import { registerCompositeProtocol } from '@/lib/compositeProtocol';
import { distanceMeters } from '@/lib/geo';
import { buildMapStyle } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

const ROUTE_LINE_SOURCE = 'open-crete-route-line';
const ROUTE_POINTS_SOURCE = 'open-crete-route-points';
const ROUTE_HOVER_SOURCE = 'open-crete-route-hover';
const ROUTE_SELECTION_SOURCE = 'open-crete-route-selection';
const ROUTE_SNAP_SOURCE = 'open-crete-route-snap';
const ROUTE_POINT_LAYERS = ['open-crete-route-point-fill', 'open-crete-route-point-halo'];

registerCompositeProtocol();

function syncCenterElevationToTerrain(map: maplibregl.Map): void {
    if (!map.getTerrain()) return;
    const elevation = map.queryTerrainElevation(map.getCenter());
    if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return;
    if (Math.abs(map.getCenterElevation() - elevation) < 0.5) return;
    map.setCenterElevation(elevation);
}

function pixelRatioForQuality(quality: 'balanced' | 'sharp'): number {
    if (quality === 'sharp') return 2;
    return Math.min(globalThis.devicePixelRatio || 1, 1.5);
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
            maxzoom: 21,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getLayer('open-crete-route-snap-line')) {
        map.addLayer({
            id: 'open-crete-route-snap-line',
            type: 'line',
            source: ROUTE_SNAP_SOURCE,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-color': '#f8fafc',
                'line-opacity': 0.65,
                'line-width': 1.5,
                'line-dasharray': [3, 3],
            },
        });
    }
}

function ensureRouteLayers(map: maplibregl.Map): void {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource(ROUTE_LINE_SOURCE)) {
        map.addSource(ROUTE_LINE_SOURCE, {
            type: 'geojson',
            maxzoom: 21,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_POINTS_SOURCE)) {
        map.addSource(ROUTE_POINTS_SOURCE, {
            type: 'geojson',
            maxzoom: 21,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_HOVER_SOURCE)) {
        map.addSource(ROUTE_HOVER_SOURCE, {
            type: 'geojson',
            maxzoom: 21,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getSource(ROUTE_SELECTION_SOURCE)) {
        map.addSource(ROUTE_SELECTION_SOURCE, {
            type: 'geojson',
            maxzoom: 21,
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    if (!map.getLayer('open-crete-route-line-casing')) {
        map.addLayer({
            id: 'open-crete-route-line-casing',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#f8fafc',
                'line-opacity': 0.95,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 7, 20, 9],
            },
        });
    }
    if (!map.getLayer('open-crete-route-line')) {
        map.addLayer({
            id: 'open-crete-route-line',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#0ea5e9',
                'line-opacity': 0.95,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 5, 20, 7],
            },
            filter: ['!=', ['get', 'mode'], 'free'],
        });
    }
    if (!map.getLayer('open-crete-route-line-free')) {
        map.addLayer({
            id: 'open-crete-route-line-free',
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#f97316',
                'line-opacity': 0.95,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 5, 20, 7],
                'line-dasharray': [0.8, 1.2],
            },
            filter: ['==', ['get', 'mode'], 'free'],
        });
    }
    if (!map.getLayer('open-crete-route-hover-halo')) {
        map.addLayer({
            id: 'open-crete-route-hover-halo',
            type: 'circle',
            source: ROUTE_HOVER_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 18, 11],
                'circle-color': '#fff7ed',
                'circle-opacity': 0.9,
            },
        });
    }
    if (!map.getLayer('open-crete-route-hover')) {
        map.addLayer({
            id: 'open-crete-route-hover',
            type: 'circle',
            source: ROUTE_HOVER_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 8],
                'circle-color': '#f97316',
                'circle-opacity': 1,
            },
        });
    }
    if (!map.getLayer('open-crete-route-selection-line')) {
        map.addLayer({
            id: 'open-crete-route-selection-line',
            type: 'line',
            source: ROUTE_SELECTION_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#fbbf24',
                'line-opacity': 1,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 8, 20, 12],
            },
        });
    }
    ensureSnapOverlay(map);
    if (!map.getLayer('open-crete-route-point-halo')) {
        map.addLayer({
            id: 'open-crete-route-point-halo',
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
    if (!map.getLayer('open-crete-route-point-fill')) {
        map.addLayer({
            id: 'open-crete-route-point-fill',
            type: 'circle',
            source: ROUTE_POINTS_SOURCE,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 8],
                'circle-color': ['case', ['boolean', ['get', 'deleteMode'], false], '#f43f5e', ['==', ['get', 'role'], 'start'], '#10b981', ['==', ['get', 'role'], 'end'], '#f97316', '#0ea5e9'],
            },
        });
    }
    if (!map.getLayer('open-crete-route-point-label')) {
        map.addLayer({
            id: 'open-crete-route-point-label',
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
}

function routeLineGeoJson(segments: ReturnType<typeof useRouteStore.getState>['routeSegments']): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: segments.filter((segment) => segment.coordinates.length >= 2).map((segment) => ({
            type: 'Feature',
            properties: { mode: segment.mode },
            geometry: { type: 'LineString', coordinates: segment.coordinates },
        })),
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

function snapLinesGeoJson(
    waypoints: ReturnType<typeof useRouteStore.getState>['waypoints'],
    segments: ReturnType<typeof useRouteStore.getState>['routeSegments'],
): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.mode !== 'auto') continue;
        const coords = seg.coordinates;
        if (coords.length < 2) continue;
        const wpStart = waypoints[i]?.coordinate;
        const wpEnd = waypoints[i + 1]?.coordinate;
        const segStart = coords[0];
        const segEnd = coords.at(-1);
        if (wpStart && distanceMeters(wpStart, segStart) > 1) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [wpStart, segStart] } });
        }
        if (wpEnd && segEnd && distanceMeters(wpEnd, segEnd) > 1) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [wpEnd, segEnd] } });
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

function routeCursor(route: ReturnType<typeof useRouteStore.getState>): string {
    if (route.deleteMode) return 'cell';
    if (route.active) return 'crosshair';
    return '';
}

export function MapContainer() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const draggedWaypointIdRef = useRef<string | null>(null);

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

    // Initial map creation (runs once)
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const initial = useMapStore.getState();
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
            // Keep the camera altitude under our control. MapLibre's automatic
            // terrain recalculate pass can snap zoom/center after wheel gestures
            // with the IGN WMS-r DEM; we sync elevation explicitly instead.
            centerClampedToGround: false,
            attributionControl: false,
            hash: true,
        });
        mapRef.current = map;
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
        map.once('load', () => ensureRouteLayers(map));

        const refreshRouteLayers = () => {
            ensureRouteLayers(map);
            const route = useRouteStore.getState();
            updateGeoJsonSource(map, ROUTE_LINE_SOURCE, routeLineGeoJson(route.routeSegments));
            updateGeoJsonSource(map, ROUTE_POINTS_SOURCE, routePointsGeoJson(route.waypoints, route.deleteMode));
            updateGeoJsonSource(map, ROUTE_HOVER_SOURCE, hoverGeoJson(route.hoverCoordinate));
            updateGeoJsonSource(map, ROUTE_SELECTION_SOURCE, selectionGeoJson(route.selectionCoordinates));
            updateGeoJsonSource(map, ROUTE_SNAP_SOURCE, snapLinesGeoJson(route.waypoints, route.routeSegments));
        };
        map.on('styledata', refreshRouteLayers);

        const waypointAt = (point: maplibregl.PointLike): string | null => {
            if (!map.getLayer('open-crete-route-point-fill')) return null;
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
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
        };
        const moveDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            const waypointId = draggedWaypointIdRef.current;
            if (!waypointId) return;
            useRouteStore.getState().moveWaypoint(waypointId, [event.lngLat.lng, event.lngLat.lat], false);
        };
        const endDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            const waypointId = draggedWaypointIdRef.current;
            if (!waypointId) return;
            draggedWaypointIdRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = '';
            useRouteStore.getState().moveWaypoint(waypointId, [event.lngLat.lng, event.lngLat.lat], true);
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

    // Rebuild style when base layer or hillshade settings change.
    // Intensity changes are debounced so dragging the slider doesn't thrash.
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
                }),
                { diff: false },
            );
            map.once('idle', () => {
                syncCenterElevationToTerrain(map);
                ensureRouteLayers(map);
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
    }, [baseLayer, hillshadeEnabled, hillshadeSource, hillshadeBlend, hillshadeIntensity, renderQuality]);

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

    useEffect(() => useRouteStore.subscribe((route) => {
        const map = mapRef.current;
        if (!map?.getStyle()?.layers) return;
        ensureRouteLayers(map);
        if (route.hoverCoordinate) console.log('[HOVER 3] map update hover source', route.hoverCoordinate);
        updateGeoJsonSource(map, ROUTE_LINE_SOURCE, routeLineGeoJson(route.routeSegments));
        updateGeoJsonSource(map, ROUTE_POINTS_SOURCE, routePointsGeoJson(route.waypoints, route.deleteMode));
        updateGeoJsonSource(map, ROUTE_HOVER_SOURCE, hoverGeoJson(route.hoverCoordinate));
        updateGeoJsonSource(map, ROUTE_SELECTION_SOURCE, selectionGeoJson(route.selectionCoordinates));
        updateGeoJsonSource(map, ROUTE_SNAP_SOURCE, snapLinesGeoJson(route.waypoints, route.routeSegments));
        map.getCanvas().style.cursor = routeCursor(route);
    }), []);

    return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
