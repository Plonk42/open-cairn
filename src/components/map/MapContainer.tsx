import { compositeTileUrl, registerCompositeProtocol, setScanApiKey } from '@/lib/compositeProtocol';
import { setTerrainCameraCollision } from '@/lib/freeCamera';
import { ignLayerUrl } from '@/lib/ign';
import { buildMapStyle, directBaseUrl, type MapStyleOptions } from '@/lib/mapStyle';
import { useView } from '@/lib/useView';
import { useMapStore, type MapState } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { lidarCloudLayerId } from './lidarLayerId';
import { getActiveMapSlot, subscribeMapSlot } from './MapSlot';
import { useLidarPreviewOverlay } from './useLidarPreviewOverlay';

/**
 * Assembles the `buildMapStyle` options from a store snapshot. Shared by all
 * three call sites (init / structural rebuild / tile reload) so the mapping
 * stays in one place. In the LiDAR Studio (`studio`) terrain is forced on with
 * exaggeration 1 so the point cloud maps onto the mesh correctly.
 */
function mapStyleOptionsFrom(s: MapState, studio: boolean): MapStyleOptions {
    return {
        base: s.baseLayer,
        hillshade: s.hillshadeEnabled,
        hillshadeSource: s.hillshadeSource,
        hillshadeBlend: s.hillshadeBlend,
        hillshadeIntensity: s.hillshadeIntensity,
        terrain: studio || s.terrainEnabled,
        terrainExaggeration: studio ? 1 : s.terrainExaggeration,
        renderQuality: s.renderQuality,
        contourLines: s.contourLinesEnabled,
        contourLinesOpacity: s.contourLinesOpacity,
        ignScanApiKey: s.ignScanApiKey,
        ignDemApiKey: s.ignDemApiKey,
        terrainDemSource: s.terrainDemSource,
    };
}

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
 * is displayed. Dimming is scoped to the studio ONLY: the itinerary view has no
 * "Fond de carte" slider, so the basemap must always be forced to full opacity
 * there — otherwise a persisted value would leave it dimmed with no way back.
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
    useEffect(() => {
        const map = mapInstance;
        if (!map) return;
        const targetOpacity = studio ? basemapOpacity : 1;
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
    }, [mapInstance, basemapOpacity, studio]);
    return null;
}

/**
 * Wrapper that only mounts the (lazy) LiDAR overlay once the user has
 * interacted with the LiDAR feature at least once, keeping the initial page
 * load lean. Mounts one `LidarCloudOverlay` per loaded cloud/mesh entry (see
 * `lidarClouds`), each with its own WebGL layer instance so several clouds
 * render, cull and LOD independently.
 */
function LidarCloudOverlayGate() {
    const clouds = useMapStore((s) => s.lidarClouds);
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const error = useMapStore((s) => s.lidarCloudError);
    if (clouds.length === 0 && !loading && !error) return null;
    return (
        <Suspense fallback={null}>
            {clouds.map((c) => <LidarCloudOverlay key={c.id} cloudId={c.id} />)}
        </Suspense>
    );
}

const ROUTE_LINE_SOURCE = 'open-cairn-route-line';
const ROUTE_POINTS_SOURCE = 'open-cairn-route-points';
const ROUTE_HOVER_SOURCE = 'open-cairn-route-hover';
const ROUTE_SELECTION_SOURCE = 'open-cairn-route-selection';
const ROUTE_SNAP_SOURCE = 'open-cairn-route-snap';
const ROUTE_POINT_LAYERS = ['open-cairn-route-point-fill', 'open-cairn-route-point-halo'];

/** Classic map view: stay at MapLibre's traditional near-horizon ceiling. */
const MAP_MAX_PITCH = 85;
/**
 * LiDAR Studio: allow tilting past 90° so the camera can look upward when
 * inspecting a mesh from below (overhangs, cliff undersides). MapLibre still
 * pushes the pitch back down whenever the camera would end up inside the
 * terrain, so the reachable angle depends on how far the camera sits from the
 * ground.
 */
const STUDIO_MAX_PITCH = 150;

registerCompositeProtocol();

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
    // Keep the LiDAR cloud layers directly above the basemap but under the
    // route layers, so the itinerary stays visible on top. A style diff (e.g.
    // a per-view Photo/Plan switch) re-adds the `base` raster layer at the TOP
    // of the stack — ABOVE our custom LiDAR layers — which drops the 3D mesh
    // below the basemap. Runs on every `styledata`, so re-assert the order
    // here. We reposition exactly the layers we own (derived from the loaded
    // clouds via the shared `lidarCloudLayerId`), rather than string-matching
    // layer ids, so the naming stays single-sourced with LidarCloudOverlay.
    if (map.getLayer('open-cairn-route-line-casing')) {
        for (const cloud of useMapStore.getState().lidarClouds) {
            const id = lidarCloudLayerId(cloud.id);
            if (map.getLayer(id)) {
                try { map.moveLayer(id, 'open-cairn-route-line-casing'); } catch { /* ignore */ }
            }
        }
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
    // A single map instance is shared across every view. `studio` is derived
    // from the URL view rather than a prop so the persistent map reacts to
    // `?view=` switches (LiDAR Studio ↔ classic map) without being rebuilt.
    const { view: appView } = useView();
    const studio = appView === 'lidar';

    // The map's canvas lives in this imperative holder — NOT a React-rendered
    // node — so it can be freely reparented between view slots without React
    // trying to reconcile/remove it.
    const holderRef = useRef<HTMLDivElement | null>(null);
    if (holderRef.current === null && typeof document !== 'undefined') {
        const el = document.createElement('div');
        el.className = 'absolute inset-0 h-full w-full';
        holderRef.current = el;
    }
    const mapRef = useRef<maplibregl.Map | null>(null);
    // Read by the once-registered map event handlers so they honour the current
    // view without re-registering on every switch.
    const studioRef = useRef(studio);
    const terrainControlRef = useRef<maplibregl.TerrainControl | null>(null);
    const draggedWaypointIdRef = useRef<string | null>(null);
    const dragMovedRef = useRef(false);

    useEffect(() => { studioRef.current = studio; }, [studio]);

    const baseLayer = useMapStore((s) => s.baseLayer);
    const view = useMapStore((s) => s.view);
    const setView = useMapStore((s) => s.setView);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
    const terrainDemSource = useMapStore((s) => s.terrainDemSource);
    const renderQuality = useMapStore((s) => s.renderQuality);
    const contourLinesEnabled = useMapStore((s) => s.contourLinesEnabled);
    const contourLinesOpacity = useMapStore((s) => s.contourLinesOpacity);
    const ignScanApiKey = useMapStore((s) => s.ignScanApiKey);
    const ignDemApiKey = useMapStore((s) => s.ignDemApiKey);
    const freeCamera = useMapStore((s) => s.freeCamera);

    // Keep composite protocol in sync with the current SCAN API key.
    useEffect(() => { setScanApiKey(ignScanApiKey); }, [ignScanApiKey]);

    // Initial map creation (runs once)
    useEffect(() => {
        const holder = holderRef.current;
        if (!holder || mapRef.current) return;
        // Attach the holder to the currently active view slot before creating
        // the map so MapLibre measures a real size.
        const initialSlot = getActiveMapSlot();
        if (initialSlot && holder.parentElement !== initialSlot) initialSlot.appendChild(holder);
        const initial = useMapStore.getState();
        setScanApiKey(initial.ignScanApiKey);
        const map = new maplibregl.Map({
            container: holder,
            style: buildMapStyle(mapStyleOptionsFrom(initial, studio)),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            // MapLibre's below-terrain camera correction dereferences an
            // uninitialised transform when the map is *constructed* above the
            // horizon, throwing "Invalid LngLat (NaN, NaN)". Start below 90°
            // and let the user tilt further once the map is alive.
            pitch: Math.min(view.pitch, MAP_MAX_PITCH),
            bearing: view.bearing,
            maxPitch: studio ? STUDIO_MAX_PITCH : MAP_MAX_PITCH,
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
            // Disable MapLibre's default bearing-snap-to-north (7° threshold)
            // so the bearing isn't force-aligned to 0 when the user ends a
            // rotate gesture close to north.
            bearingSnap: 0,
        });
        mapRef.current = map;
        useMapStore.getState().setMapInstance(map);
        if (import.meta.env.DEV) {
            (globalThis as unknown as { __map: maplibregl.Map }).__map = map;
            (globalThis as unknown as { __store: typeof useMapStore }).__store = useMapStore;
        }

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
        // so the terrain control button is omitted there. The control is added
        // and removed reactively (see the studio-terrain effect below) since the
        // same persistent map is shared with the classic view.

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

        const refreshRouteLayers = () => { syncRouteToMap(map); };
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
            if (studioRef.current) return;
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
            if (studioRef.current) return;
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
            if (studioRef.current) return;
            const route = useRouteStore.getState();
            if (!route.active) return;
            const waypointId = waypointAt(event.point);
            if (!waypointId) return;
            event.preventDefault();
            route.removeWaypoint(waypointId);
        });

        const startDrag = (event: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            // Dragging waypoints only makes sense in route mode.
            if (studioRef.current) return;
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
            // The terrain control was owned by this now-destroyed map. Drop the
            // stale reference so a freshly recreated map (StrictMode / Fast
            // Refresh remount) re-adds its own control instead of skipping the
            // add and later trying to remove a detached control.
            terrainControlRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reparent the persistent map into whichever view slot is currently active.
    // This is what lets the map survive a `?view=` switch without a rebuild.
    useEffect(() => {
        const place = () => {
            const slot = getActiveMapSlot();
            const holder = holderRef.current;
            if (slot && holder && holder.parentElement !== slot) {
                slot.appendChild(holder);
                mapRef.current?.resize();
            }
        };
        place();
        return subscribeMapSlot(place);
    }, []);

    // Add the terrain toggle control only in the classic view. In the LiDAR
    // Studio 3D terrain is forced on and not user-toggleable, so the control is
    // removed. Runs whenever the view (studio) changes on the shared map.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (studio) {
            const control = terrainControlRef.current;
            // Guard against a stale reference: if the map was recreated (e.g. a
            // StrictMode / Fast Refresh remount runs the init-effect cleanup,
            // which destroys the previous map), the ref may point at a control
            // that is no longer attached. Removing it would make MapLibre's
            // onRemove dereference an undefined `_map` and throw, blanking the
            // whole studio. Only remove a control that is actually still added.
            if (control && map.hasControl(control)) {
                map.removeControl(control);
            }
            terrainControlRef.current = null;
        } else if (!terrainControlRef.current) {
            const control = new maplibregl.TerrainControl({
                source: 'terrain',
                exaggeration: useMapStore.getState().terrainExaggeration,
            });
            map.addControl(control, 'bottom-left');
            control._terrainButton.addEventListener('click', () => {
                globalThis.setTimeout(() => syncTerrainControlState(map), 0);
            });
            terrainControlRef.current = control;
        }
    }, [studio]);

    // Only the studio may look above the horizon; leaving it tilts back down.
    useEffect(() => {
        mapRef.current?.setMaxPitch(studio ? STUDIO_MAX_PITCH : MAP_MAX_PITCH);
    }, [studio]);

    // "Caméra libre": studio-only opt-out of MapLibre's terrain camera collision,
    // which otherwise rewrites pitch AND zoom every frame when the eye grazes the
    // ground — the jitter that makes close-range inspection unusable.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        setTerrainCameraCollision(map, !(studio && freeCamera));
    }, [studio, freeCamera]);

    // Rebuild style when structural settings change (base layer, hillshade on/off,
    // render quality, contour lines). Uses diff mode to preserve terrain mesh.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const handle = globalThis.setTimeout(() => {
            const current = useMapStore.getState();
            map.setStyle(
                buildMapStyle(mapStyleOptionsFrom(current, studioRef.current)),
                { diff: true },
            );
            map.once('idle', () => {
                syncCenterElevationToTerrain(map);
                syncRouteToMap(map);
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
    }, [baseLayer, renderQuality, contourLinesEnabled, contourLinesOpacity, ignScanApiKey, ignDemApiKey, terrainDemSource]);

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
                buildMapStyle(mapStyleOptionsFrom(current, studioRef.current)),
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
            map.setTerrain({ source: 'terrain', exaggeration: studio ? 1 : terrainExaggeration });
            map.once('idle', () => syncCenterElevationToTerrain(map));
        } else {
            map.setTerrain(null);
        }
    }, [terrainEnabled, terrainExaggeration, studio]);

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

    // LiDAR preview zone — shows the footprint on the map of what will be loaded.
    useLidarPreviewOverlay(mapRef);

    return (
        <>
            <LidarCloudOverlayGate />
            <BasemapDimmer studio={studio} />
        </>
    );
}
