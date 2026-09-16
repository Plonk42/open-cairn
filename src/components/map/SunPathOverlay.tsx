/**
 * Mounts the {@link SunPathLayer} and keeps it fed.
 *
 * Two independent inputs:
 *   - the DAY's track, rebuilt only when the date or the site moves;
 *   - the disc, which follows the *effective* light (`lidarSunAzimuth` /
 *     `lidarSunElevation`), not the date. Same rule as the panel's read-out: if
 *     the user forces the lighting, seeing the disc leave the track is the
 *     useful signal, not a bug.
 */

import { SunPathLayer } from '@/components/map/SunPathLayer';
import { applyWhenStyleReady } from '@/components/map/styleReady';
import { parseSunDate, sunDirectionVector } from '@/lib/sun';
import { buildSunPathGeometry, sampleSunPath } from '@/lib/sunPath';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

const LAYER_ID = 'open-cairn-sun-path';
const DEG = Math.PI / 180;

export function SunPathOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const enabled = useMapStore((s) => s.lidarSunPath);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const azimuthDeg = useMapStore((s) => s.lidarSunAzimuth);
    const elevationDeg = useMapStore((s) => s.lidarSunElevation);
    // Same site the lighting is computed for (see `sunStateFor`): the cloud's
    // centre when one is loaded, the map centre otherwise.
    const lng = useMapStore((s) => s.lidarShaded?.centerLng ?? s.lidarMesh?.centerLng ?? s.view.longitude);
    const lat = useMapStore((s) => s.lidarShaded?.centerLat ?? s.lidarMesh?.centerLat ?? s.view.latitude);

    const layerRef = useRef<SunPathLayer | null>(null);
    // MapLibre drops custom layers on every style rebuild, so the layer is
    // re-added and the buffers re-pushed against this counter.
    const [layerEpoch, setLayerEpoch] = useState(0);

    useEffect(() => {
        const map = mapInstance;
        if (!map || !enabled) return undefined;

        const ensureLayer = () => {
            if (map.getLayer(LAYER_ID)) return;
            const layer = new SunPathLayer(LAYER_ID);
            // No `beforeId`: the track must be composited last, on top of the
            // terrain and of the LiDAR mesh whose depth it tests against.
            map.addLayer(layer);
            layerRef.current = layer;
            setLayerEpoch((e) => e + 1);
        };
        const cancel = applyWhenStyleReady(map, ensureLayer);

        return () => {
            cancel();
            try { map.removeLayer(LAYER_ID); } catch { /* map or style already gone */ }
            layerRef.current = null;
        };
    }, [mapInstance, enabled]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        const { datePart } = parseSunDate(sunDate);
        const { track, ticks } = buildSunPathGeometry(sampleSunPath(datePart, lat, lng));
        layer.setGeometry(track, ticks);
        mapInstance?.triggerRepaint();
    }, [mapInstance, sunDate, lat, lng, layerEpoch]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        layer.setSunDir(sunDirectionVector({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG }));
        mapInstance?.triggerRepaint();
    }, [mapInstance, azimuthDeg, elevationDeg, layerEpoch]);

    return null;
}
