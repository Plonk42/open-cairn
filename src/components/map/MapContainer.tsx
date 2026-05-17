import { registerCompositeProtocol } from '@/lib/compositeProtocol';
import { buildMapStyle } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

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

export function MapContainer() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

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
            maxZoom: 22,
            // Keep the camera altitude under our control. MapLibre's automatic
            // terrain recalculate pass can snap zoom/center after wheel gestures
            // with the IGN WMS-r DEM; we sync elevation explicitly instead.
            centerClampedToGround: false,
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
            map.once('idle', () => syncCenterElevationToTerrain(map));
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

    return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
