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

        // Auto-suspend terrain during a wheel-zoom gesture, and also
        // permanently at near-zero pitch.
        //
        // MapLibre enforces a "camera-above-terrain" altitude floor: as
        // you zoom in, the camera descends, and once it reaches the local
        // DEM elevation the gesture is corrupted -- either by freezing
        // and then jumping zoom levels (when the next DEM tile loads),
        // or by collapsing pitch (the floor pushes the camera back). At
        // pitch 0 terrain has no visible effect anyway, and during a
        // wheel-zoom the user wants smoothness over geometric accuracy.
        // On wheel-end we restore terrain so the 3D relief comes back.
        const PITCH_TERRAIN_THRESHOLD = 3;
        const WHEEL_RESTORE_DELAY_MS = 250;
        let terrainSuspended = false;
        let wheelTimeout: ReturnType<typeof setTimeout> | null = null;
        const enableTerrain = () => {
            map.setTerrain({
                source: 'terrain',
                exaggeration: useMapStore.getState().terrainExaggeration,
            });
            terrainSuspended = false;
        };
        const disableTerrain = () => {
            map.setTerrain(null);
            terrainSuspended = true;
        };
        const updateTerrainForPitch = () => {
            const wantTerrain = useMapStore.getState().terrainEnabled;
            if (!wantTerrain) return;
            const lowPitch = map.getPitch() < PITCH_TERRAIN_THRESHOLD;
            if (lowPitch && !terrainSuspended) disableTerrain();
            else if (!lowPitch && terrainSuspended && wheelTimeout === null) enableTerrain();
        };
        map.on('pitch', updateTerrainForPitch);
        map.on('load', updateTerrainForPitch);

        // Wheel listener: kick terrain off for the duration of the gesture.
        // Registered on the canvas in capture phase so it fires before
        // MapLibre's own scroll handler reads the elevation.
        const onWheel = () => {
            if (!useMapStore.getState().terrainEnabled) return;
            if (!terrainSuspended) disableTerrain();
            if (wheelTimeout !== null) clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(() => {
                wheelTimeout = null;
                if (
                    useMapStore.getState().terrainEnabled &&
                    map.getPitch() >= PITCH_TERRAIN_THRESHOLD
                ) {
                    enableTerrain();
                }
            }, WHEEL_RESTORE_DELAY_MS);
        };
        map.getCanvas().addEventListener('wheel', onWheel, { capture: true, passive: true });

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
