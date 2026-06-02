import { LAS_CLASS_COLORS } from '@/lib/lidarCloud';
import { sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LidarWebGLLayer } from './LidarWebGLLayer';

/**
 * Manages the LidarWebGLLayer for shaded cloud rendering with depth-based
 * Eye-Dome Lighting. In mixed mode, the ground mesh is also rendered
 * in the same WebGL layer for proper depth ordering.
 *
 * Positions are METER_OFFSETS relative to the request center.
 */
export function LidarCloudOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const lidarShaded = useMapStore((s) => s.lidarShaded);
    const lidarMesh = useMapStore((s) => s.lidarMesh);
    const basePointSize = useMapStore((s) => s.lidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const hideBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const shadows = useMapStore((s) => s.lidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);

    const webglRef = useRef<LidarWebGLLayer | null>(null);
    // Incremented every time MapLibre rebuilds its style (base-layer switch,
    // hillshade toggle, …). setStyle({diff:true}) drops custom MapLibre layers,
    // so we re-add ours on 'style.load' and bump this counter to force the
    // data-push effects below to re-upload their buffers to the fresh layer.
    const [styleEpoch, setStyleEpoch] = useState(0);

    // ── WebGL layer for shaded cloud ──────────────────────────────────────────
    useEffect(() => {
        if (!mapInstance) return undefined;
        const layer = new LidarWebGLLayer('lidar-shaded-cloud');
        // Add BEFORE the route layers so the itinerary renders on top.
        const beforeId = mapInstance.getLayer('open-cairn-route-line-casing') ? 'open-cairn-route-line-casing' : undefined;
        mapInstance.addLayer(layer, beforeId);
        webglRef.current = layer;

        // MapLibre setStyle (called on base-layer / hillshade / quality changes)
        // wipes custom layers. Re-add ours on every style.load and bump the
        // epoch so dependent push-effects re-run with the fresh layer.
        const onStyleLoad = () => {
            if (mapInstance.getLayer('lidar-shaded-cloud')) return;
            const fresh = new LidarWebGLLayer('lidar-shaded-cloud');
            const bid = mapInstance.getLayer('open-cairn-route-line-casing') ? 'open-cairn-route-line-casing' : undefined;
            mapInstance.addLayer(fresh, bid);
            webglRef.current = fresh;
            setStyleEpoch((e) => e + 1);
        };
        mapInstance.on('style.load', onStyleLoad);

        return () => {
            mapInstance.off('style.load', onStyleLoad);
            try { mapInstance.removeLayer('lidar-shaded-cloud'); } catch { /* map may be gone */ }
            webglRef.current = null;
        };
    }, [mapInstance]);

    // ── Compute final colour buffer for the WebGL shaded cloud ────────────────
    // Always use 'mixed' coloring: ground (class 2) uses slope palette,
    // other classes use classification colors.
    const shadedColors = useMemo(() => {
        if (!lidarShaded) return null;
        const { pointCount, colors, classifications } = lidarShaded;
        const out = new Uint8Array(pointCount * 4);
        for (let i = 0; i < pointCount; i++) {
            const cls = classifications[i] ?? 0;
            let r: number, g: number, b: number;
            // Mixed mode: ground (class 2) uses slope colors, others use classification
            if (cls === 2) {
                // Slope palette from the server
                r = colors[i * 4];
                g = colors[i * 4 + 1];
                b = colors[i * 4 + 2];
            } else {
                // Classification palette
                [r, g, b] = LAS_CLASS_COLORS[cls] ?? [200, 200, 200];
            }
            out[i * 4] = r;
            out[i * 4 + 1] = g;
            out[i * 4 + 2] = b;
            out[i * 4 + 3] = 255;
        }
        return out;
    }, [lidarShaded]);

    // ── Push shaded data + mesh + config to WebGL layer ─────────────────────
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        if (lidarShaded && shadedColors) {
            layer.setData(
                lidarShaded.positions,
                lidarShaded.normals,
                shadedColors,
                lidarShaded.classifications,
                lidarShaded.pointCount,
                lidarShaded.centerLng,
                lidarShaded.centerLat,
            );
        } else {
            layer.clear();
        }
    }, [lidarShaded, shadedColors, styleEpoch]);

    // ── Push mesh data for mixed mode ─────────────────────────────────────────
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        if (lidarMesh) {
            layer.setMesh(
                lidarMesh.positions,
                lidarMesh.normals,
                lidarMesh.colors,
                lidarMesh.indices,
                lidarMesh.centerLng,
                lidarMesh.centerLat,
            );
        } else {
            layer.clearMesh();
        }
    }, [lidarMesh, styleEpoch]);

    // Live LAS-class filter: applied GPU-side via the WebGL layer's class mask,
    // so toggling classes does NOT require re-fetching the cloud.
    useEffect(() => {
        webglRef.current?.setClassMask(classes);
    }, [classes, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            pointSize: basePointSize,
            adaptiveSize: sizeCompensation,
            edlEnabled: edl,
            edlStrength,
            edlRadius,
            edlFarPlane,
            aoStrength: 0, // AO disabled
            aoRadius: 0,
            opacity,
        });
    }, [basePointSize, sizeCompensation, edl, edlStrength, edlRadius, edlFarPlane, opacity, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            shadowsEnabled: shadows,
            shadowStrength,
        });
    }, [shadows, shadowStrength, styleEpoch]);

    // ── Sun-driven Lambert lighting ───────────────────────────────────────────
    // Recompute the sun direction whenever the user picks a different date/time
    // or the loaded cloud changes (we use its center for the solar calc; fall
    // back to the current map center if no cloud is loaded yet).
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        const lng = lidarShaded?.centerLng ?? lidarMesh?.centerLng ?? mapInstance?.getCenter().lng;
        const lat = lidarShaded?.centerLat ?? lidarMesh?.centerLat ?? mapInstance?.getCenter().lat;
        if (lng == null || lat == null) return;
        const date = new Date(sunDate);
        if (Number.isNaN(date.getTime())) return;
        const { dir, intensity, color } = sunLighting(date, lat, lng);
        layer.setConfig({ sunDir: dir, sunIntensity: intensity, sunColor: color });
    }, [sunDate, lidarShaded, lidarMesh, mapInstance, styleEpoch]);

    // ── Basemap dimming ───────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapInstance;
        if (!map) return;
        const hasOverlay = lidarShaded !== null;
        const targetOpacity = hideBasemap && hasOverlay ? 0.15 : 1;
        const style = map.getStyle();
        if (!style?.layers) return;
        for (const layer of style.layers) {
            if (layer.type !== 'raster') continue;
            try {
                map.setPaintProperty(layer.id, 'raster-opacity', targetOpacity);
            } catch { /* layer might not accept the property */ }
        }
    }, [mapInstance, hideBasemap, lidarShaded]);

    return null;
}
