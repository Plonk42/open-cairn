import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';

const LIDAR_PREVIEW_SOURCE = 'open-cairn-lidar-preview';

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

/**
 * Shows a square on the map indicating what area will be loaded by the next
 * LiDAR fetch. The square tracks the screen center (so it stays centered even
 * when the camera is pitched) and follows the camera while visible.
 */
export function useLidarPreviewOverlay(mapRef: RefObject<maplibregl.Map | null>): void {
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
    }, [mapRef, lidarPreviewVisible, lidarCloudRadius]);
}
