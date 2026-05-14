import { registerCompositeProtocol } from '@/lib/compositeProtocol';
import { buildMapStyle } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

registerCompositeProtocol();

export function MapContainer() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    const baseLayer = useMapStore((s) => s.baseLayer);
    const view = useMapStore((s) => s.view);
    const setView = useMapStore((s) => s.setView);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);

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
                hillshadeIntensity: initial.hillshadeIntensity,
            }),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            maxPitch: 85,
            // Keep the camera independent of terrain elevation so zooming/panning
            // never silently reduces pitch to avoid going through the ground.
            centerClampedToGround: true,
            hash: true,
        });
        mapRef.current = map;
        if (import.meta.env.DEV)
            (globalThis as unknown as { __map: maplibregl.Map }).__map = map;

        map.addControl(
            new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
            'top-right',
        );
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

        map.on('load', () => {
            if (useMapStore.getState().terrainEnabled) {
                map.setTerrain({
                    source: 'terrain',
                    exaggeration: useMapStore.getState().terrainExaggeration,
                });
            }
        });

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
            map.setStyle(
                buildMapStyle({
                    base: baseLayer,
                    hillshade: hillshadeEnabled,
                    hillshadeSource,
                    hillshadeIntensity,
                }),
                { diff: false },
            );
            map.once('styledata', () => {
                if (terrainEnabled) {
                    map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
                }
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseLayer, hillshadeEnabled, hillshadeSource, hillshadeIntensity]);

    // Terrain on/off + exaggeration (no style rebuild needed).
    useEffect(() => {
        const map = mapRef.current;
        if (!map?.isStyleLoaded()) return;
        if (terrainEnabled) {
            map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
        } else {
            map.setTerrain(null);
        }
    }, [terrainEnabled, terrainExaggeration]);

    return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
