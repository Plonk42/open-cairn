import { rectPreviewGeoJson } from '@/lib/lidarCaptureRect';
import { useMapStore } from '@/stores/mapStore';
import type * as maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import { applyWhenStyleReady } from './styleReady';

const LIDAR_PREVIEW_SOURCE = 'open-cairn-lidar-preview';

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

/**
 * Shows the footprint of the next LiDAR fetch on the map. The rectangle is
 * anchored to the ground, so unlike the camera-fixed preview it replaces it
 * needs no per-frame update — only a redraw when the rectangle itself changes.
 */
export function useLidarPreviewOverlay(mapRef: RefObject<maplibregl.Map | null>): void {
    const lidarPreviewVisible = useMapStore((s) => s.lidarPreviewVisible);
    const lidarCaptureRect = useMapStore((s) => s.lidarCaptureRect);
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updatePreview = () => {
            ensureLidarPreviewLayer(map);
            const source = map.getSource(LIDAR_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
            if (!source) return;
            source.setData(lidarPreviewVisible
                ? rectPreviewGeoJson(lidarCaptureRect)
                : { type: 'FeatureCollection', features: [] });
        };

        // Reinstall on every `styledata`: a style rebuild (basemap switch, the
        // LiDAR layers being added) drops the source along with the old style.
        return applyWhenStyleReady(map, updatePreview);
    }, [mapRef, lidarPreviewVisible, lidarCaptureRect]);
}
