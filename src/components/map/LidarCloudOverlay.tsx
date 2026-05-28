import { colorForClass, LAS_CLASS_COLORS, type LidarCloudData, type LidarMeshData } from '@/lib/lidarCloud';
import { useMapStore } from '@/stores/mapStore';
import {
    AmbientLight,
    COORDINATE_SYSTEM,
    DirectionalLight,
    LightingEffect,
    type Layer,
} from '@deck.gl/core';
import { PointCloudLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { useEffect, useMemo, useRef } from 'react';
import { LidarWebGLLayer } from './LidarWebGLLayer';

/**
 * Manages two rendering back-ends:
 *   - deck.gl MapboxOverlay  → raw point cloud + mesh modes
 *   - LidarWebGLLayer        → shaded cloud with depth-based Eye-Dome Lighting
 *
 * Positions for all modes are METER_OFFSETS relative to the request center,
 * matching the binary contract of `services/lidar-cloud/server.mjs`.
 */
export function LidarCloudOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const lidarCloud = useMapStore((s) => s.lidarCloud);
    const lidarMesh = useMapStore((s) => s.lidarMesh);
    const lidarShaded = useMapStore((s) => s.lidarShaded);
    const basePointSize = useMapStore((s) => s.lidarCloudPointSize);
    const stride = useMapStore((s) => s.lidarCloudStride);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const coloring = useMapStore((s) => s.lidarCloudColoring);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const aoStrength = useMapStore((s) => s.lidarCloudAoStrength);
    const aoRadius = useMapStore((s) => s.lidarCloudAoRadius);
    const hideBasemap = useMapStore((s) => s.lidarCloudHideBasemap);
    const classes = useMapStore((s) => s.lidarCloudClasses);

    // Effective point size with optional stride compensation (applies to
    // deck.gl raw cloud + mesh modes only — the shaded WebGL layer handles
    // zoom-adaptive sizing on its own via `adaptiveSize`).
    const pointSize = sizeCompensation ? basePointSize * Math.sqrt(stride) : basePointSize;

    const overlayRef = useRef<MapboxOverlay | null>(null);
    const webglRef = useRef<LidarWebGLLayer | null>(null);

    // ── Lighting for deck.gl mesh mode ────────────────────────────────────────
    const lightingEffect = useMemo(() => {
        const ambient = new AmbientLight({ color: [255, 250, 245], intensity: 0.7 });
        const sun = new DirectionalLight({
            color: [255, 250, 240],
            intensity: 1.8,
            direction: [-0.5, -0.6, -0.8],
            _shadow: false,
        });
        return new LightingEffect({ ambient, sun });
    }, []);

    // ── deck.gl overlay (mesh + raw cloud + mixed-mode vegetation) ───────────
    useEffect(() => {
        if (!mapInstance) return undefined;
        // Non-interleaved: deck.gl renders AFTER all MapLibre layers using its
        // own depth buffer. This keeps the LiDAR mesh visible regardless of
        // the MapLibre terrain DEM (which often disagrees with the LiDAR
        // ground by several meters). In mixed mode, vegetation is pushed as a
        // second deck.gl layer so it depth-tests against the mesh correctly.
        const overlay = new MapboxOverlay({
            interleaved: false,
            layers: [],
            effects: [lightingEffect],
        });
        mapInstance.addControl(overlay);
        overlayRef.current = overlay;
        return () => {
            try { mapInstance.removeControl(overlay); } catch { /* map may be gone */ }
            overlayRef.current = null;
        };
    }, [mapInstance, lightingEffect]);

    // ── WebGL layer for shaded cloud ──────────────────────────────────────────
    useEffect(() => {
        if (!mapInstance) return undefined;
        const layer = new LidarWebGLLayer('lidar-shaded-cloud');
        mapInstance.addLayer(layer);
        webglRef.current = layer;
        return () => {
            try { mapInstance.removeLayer('lidar-shaded-cloud'); } catch { /* map may be gone */ }
            webglRef.current = null;
        };
    }, [mapInstance]);

    // ── Compute final colour buffer for the WebGL shaded cloud ────────────────
    const shadedColors = useMemo(() => {
        if (!lidarShaded) return null;
        const { pointCount, colors, classifications } = lidarShaded;
        const out = new Uint8Array(pointCount * 4);
        for (let i = 0; i < pointCount; i++) {
            const cls = classifications[i] ?? 0;
            let r: number, g: number, b: number;
            if (coloring === 'slope' || (coloring === 'mixed' && cls === 2)) {
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
    }, [lidarShaded, coloring]);

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
    }, [lidarShaded, shadedColors]);

    // Mixed mode: push the ground mesh into the SAME WebGL layer so it shares
    // the FBO + depth buffer with the points. The EDL composite then blits
    // the whole thing on top of MapLibre in one go — perfect depth ordering,
    // no render-pass coordination needed.
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        // Only inject when shaded points are also present (= mixed mode). If
        // mesh is shown standalone ("Mesh sol"), deck.gl still renders it.
        if (lidarMesh && lidarShaded) {
            layer.setMesh(lidarMesh.positions, lidarMesh.normals, lidarMesh.colors, lidarMesh.indices);
        } else {
            layer.clearMesh();
        }
    }, [lidarMesh, lidarShaded]);

    // Live LAS-class filter: applied GPU-side via the WebGL layer's class mask,
    // so toggling classes does NOT require re-fetching the cloud.
    useEffect(() => {
        webglRef.current?.setClassMask(classes);
    }, [classes]);

    useEffect(() => {
        webglRef.current?.setConfig({
            pointSize: basePointSize,
            adaptiveSize: sizeCompensation,
            edlEnabled: edl,
            edlStrength,
            edlRadius,
            edlFarPlane,
            aoStrength,
            aoRadius,
        });
    }, [basePointSize, sizeCompensation, edl, edlStrength, edlRadius, edlFarPlane, aoStrength, aoRadius]);

    // ── Update deck.gl layers (mesh + raw cloud) ──────────────────────────────
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const layers: Layer[] = [];
        // In mixed mode the mesh is rendered by the WebGL layer (alongside the
        // shaded points, sharing depth via the same FBO), so deck.gl skips it.
        const meshHandledByWebGL = lidarMesh && lidarShaded;
        if (lidarMesh && !meshHandledByWebGL) layers.push(buildMeshLayer(lidarMesh));
        if (lidarCloud) layers.push(buildPointCloudLayer(lidarCloud, pointSize));
        overlay.setProps({ layers });
    }, [lidarCloud, lidarMesh, lidarShaded, pointSize]);

    // ── Basemap dimming ───────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapInstance;
        if (!map) return;
        const hasOverlay = lidarCloud !== null || lidarMesh !== null || lidarShaded !== null;
        const targetOpacity = hideBasemap && hasOverlay ? 0.15 : 1;
        const style = map.getStyle();
        if (!style?.layers) return;
        for (const layer of style.layers) {
            if (layer.type !== 'raster') continue;
            try {
                map.setPaintProperty(layer.id, 'raster-opacity', targetOpacity);
            } catch { /* layer might not accept the property */ }
        }
    }, [mapInstance, hideBasemap, lidarCloud, lidarMesh, lidarShaded]);

    return null;
}

function buildPointCloudLayer(cloud: LidarCloudData, pointSize: number) {
    return new PointCloudLayer<unknown>({
        id: 'lidar-hd-point-cloud',
        data: {
            length: cloud.pointCount,
            attributes: {
                getPosition: { value: cloud.positions, size: 3 },
            },
        },
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [cloud.centerLng, cloud.centerLat, 0],
        getColor: (_object: unknown, info: { index: number }) => {
            const cls = cloud.classifications[info.index] ?? 0;
            const [r, g, b] = colorForClass(cls);
            return [r, g, b, 255];
        },
        updateTriggers: { getColor: cloud.classifications },
        pointSize,
        sizeUnits: 'pixels',
        opacity: 1,
        material: false,
        pickable: false,
    });
}

/**
 * Render the triangulated mesh as a SimpleMeshLayer with a single instance
 * located at the request center (METER_OFFSETS origin). Per-vertex colors
 * encode the slope-based palette computed on the server.
 */
function buildMeshLayer(mesh: LidarMeshData) {
    return new SimpleMeshLayer<{ position: [number, number, number] }>({
        id: 'lidar-hd-mesh',
        data: [{ position: [0, 0, 0] }],
        mesh: {
            attributes: {
                positions: { value: mesh.positions, size: 3 },
                normals: { value: mesh.normals, size: 3 },
                colors: { value: mesh.colors, size: 4, normalized: true },
            },
            indices: { value: mesh.indices, size: 1 },
        },
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [mesh.centerLng, mesh.centerLat, 0],
        getPosition: (d) => d.position,
        getColor: [255, 255, 255, 255],
        material: {
            ambient: 0.35,
            diffuse: 0.7,
            shininess: 8,
            specularColor: [40, 40, 40],
        },
        pickable: false,
        opacity: 1,
    });
}


