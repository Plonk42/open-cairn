import {
    rectPreviewGeoJson, screenCenterLngLat, screenUpAzimuthDeg,
} from '@/lib/lidarCaptureRect';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';

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
 * Shows the footprint of the next LiDAR fetch on the map: the centred capture
 * rectangle sized by `lidarCaptureRect`. Its orientation is north when
 * `lidarRectNorthFixed` is set, otherwise the live camera bearing (kept
 * camera-fixed — constant on screen, its ground footprint rotating with the
 * map — by re-deriving the centre and bearing from the live projection on
 * every move).
 */
export function useLidarPreviewOverlay(mapRef: RefObject<maplibregl.Map | null>): void {
    const lidarPreviewVisible = useMapStore((s) => s.lidarPreviewVisible);
    const lidarCaptureRect = useMapStore((s) => s.lidarCaptureRect);
    const lidarRectNorthFixed = useMapStore((s) => s.lidarRectNorthFixed);
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
            // Screen center (not map.getCenter) so the preview stays centered
            // even when the camera is pitched.
            const center = screenCenterLngLat(map);
            const azimuth = lidarRectNorthFixed ? 0 : screenUpAzimuthDeg(map);
            source.setData(rectPreviewGeoJson(
                center.lng, center.lat, azimuth,
                lidarCaptureRect.widthM, lidarCaptureRect.lengthM,
            ));
        };

        // Initial update — use 'idle' rather than 'load' so we recover from
        // any later style transition (LiDAR layers being added, basemap
        // switches…), not just the first style load.
        if (map.isStyleLoaded()) {
            updatePreview();
        } else {
            map.once('idle', updatePreview);
        }

        // Update on map move when preview is visible
        if (lidarPreviewVisible) {
            map.on('move', updatePreview);
            return () => { map.off('move', updatePreview); };
        }
        return undefined;
    }, [mapRef, lidarPreviewVisible, lidarCaptureRect, lidarRectNorthFixed]);
}
