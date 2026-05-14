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
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
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
                hillshadeBlend: initial.hillshadeBlend,
                hillshadeIntensity: initial.hillshadeIntensity,
            }),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            maxPitch: 85,
            // Allow overzoom past the source maxzoom so users can keep
            // diving in past z19 (MapLibre will reuse parent tiles).
            maxZoom: 22,
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

        // High-pitch wheel-zoom would otherwise be cursor-anchored, which
        // unprojects to a far-away ground point and makes the gesture
        // collapse pitch -- anchor on the screen centre instead so zoom
        // stays monotonic and pitch is preserved.
        map.scrollZoom.disable();
        map.scrollZoom.enable({ around: 'center' });

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

        // Auto-suspend terrain at near-zero pitch. At pitch ~0 the camera
        // looks straight down so terrain elevation has no visible effect,
        // BUT MapLibre still enforces an "altitude floor" that prevents
        // the camera from descending below the local DEM elevation. That
        // floor manifests as the wheel-zoom blocking at a certain zoom
        // (e.g. z 12.7 over a hill) and then jumping by several levels
        // when a deeper DEM tile finally arrives. Disabling terrain
        // below ~3deg pitch removes the wall without any visual change.
        const PITCH_TERRAIN_THRESHOLD = 3;
        let terrainSuspended = false;
        const updateTerrainForPitch = () => {
            const wantTerrain = useMapStore.getState().terrainEnabled;
            if (!wantTerrain) return;
            const lowPitch = map.getPitch() < PITCH_TERRAIN_THRESHOLD;
            if (lowPitch && !terrainSuspended) {
                map.setTerrain(null);
                terrainSuspended = true;
            } else if (!lowPitch && terrainSuspended) {
                map.setTerrain({
                    source: 'terrain',
                    exaggeration: useMapStore.getState().terrainExaggeration,
                });
                terrainSuspended = false;
            }
        };
        map.on('pitch', updateTerrainForPitch);
        map.on('load', updateTerrainForPitch);

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
                    hillshadeBlend,
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
    }, [baseLayer, hillshadeEnabled, hillshadeSource, hillshadeBlend, hillshadeIntensity]);

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
