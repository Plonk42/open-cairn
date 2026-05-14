import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '@/stores/mapStore';
import { buildMapStyle } from '@/lib/mapStyle';
import { MultiplyBlendLayer } from '@/layers/MultiplyBlendLayer';

export function MapContainer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const blendLayerRef = useRef<MultiplyBlendLayer | null>(null);

  const baseLayer = useMapStore((s) => s.baseLayer);
  const view = useMapStore((s) => s.view);
  const setView = useMapStore((s) => s.setView);
  const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
  const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
  const terrainEnabled = useMapStore((s) => s.terrainEnabled);
  const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);

  // Initial map creation (runs once)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(baseLayer),
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
      maxPitch: 85,
      hash: true,
    });
    mapRef.current = map;

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
      // Attach the multiply-blended LiDAR shadow custom layer.
      const blend = new MultiplyBlendLayer('lidar-blend', 'lidar-shadow');
      blend.setIntensity(useMapStore.getState().hillshadeIntensity);
      blendLayerRef.current = blend;
      if (useMapStore.getState().hillshadeEnabled) {
        map.addLayer(blend as unknown as maplibregl.LayerSpecification);
      }

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
      blendLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to baseLayer change → swap style and re-attach overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildMapStyle(baseLayer), { diff: false });
    map.once('styledata', () => {
      if (hillshadeEnabled && blendLayerRef.current) {
        // The custom layer instance is detached when style changes; re-add it.
        if (!map.getLayer(blendLayerRef.current.id)) {
          map.addLayer(
            blendLayerRef.current as unknown as maplibregl.LayerSpecification,
          );
        }
      }
      if (terrainEnabled) {
        map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayer]);

  // Toggle hillshade on/off
  useEffect(() => {
    const map = mapRef.current;
    const blend = blendLayerRef.current;
    if (!map || !blend || !map.isStyleLoaded()) return;
    const present = !!map.getLayer(blend.id);
    if (hillshadeEnabled && !present)
      map.addLayer(blend as unknown as maplibregl.LayerSpecification);
    if (!hillshadeEnabled && present) map.removeLayer(blend.id);
  }, [hillshadeEnabled]);

  // Hillshade intensity
  useEffect(() => {
    blendLayerRef.current?.setIntensity(hillshadeIntensity);
    mapRef.current?.triggerRepaint();
  }, [hillshadeIntensity]);

  // Terrain on/off + exaggeration
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (terrainEnabled) {
      map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
    } else {
      map.setTerrain(null);
    }
  }, [terrainEnabled, terrainExaggeration]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
