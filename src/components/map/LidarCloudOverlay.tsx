import { fetchOrthoMosaic } from '@/lib/lidarBrowser/orthoTexture';
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
    const photoOpacity = useMapStore((s) => s.lidarCloudPhotoOpacity);
    const photoOpacityNonGround = useMapStore((s) => s.lidarCloudPhotoOpacityNonGround);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const shadows = useMapStore((s) => s.lidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const vegEnhance = useMapStore((s) => s.lidarVegEnhance);
    const vegColorMode = useMapStore((s) => s.lidarVegColorMode);
    const vegHeightScale = useMapStore((s) => s.lidarVegHeightScale);
    const vegIntensity = useMapStore((s) => s.lidarVegIntensity);
    const vegJitter = useMapStore((s) => s.lidarVegJitter);
    const vegNormalShade = useMapStore((s) => s.lidarVegNormalShade);
    const vegSizeBoost = useMapStore((s) => s.lidarVegSizeBoost);
    const vegRound = useMapStore((s) => s.lidarVegRound);

    const webglRef = useRef<LidarWebGLLayer | null>(null);
    // Geometry + style-epoch for which the orthophoto mosaic was last fetched, so
    // we don't re-download it when only the opacity slider moves.
    const orthoRef = useRef<{ source: unknown; epoch: number } | null>(null);
    // Incremented every time MapLibre rebuilds its style (base-layer switch,
    // hillshade toggle, …). setStyle({diff:true}) drops custom MapLibre layers,
    // so we re-add ours on 'style.load' and bump this counter to force the
    // data-push effects below to re-upload their buffers to the fresh layer.
    const [styleEpoch, setStyleEpoch] = useState(0);

    // ── WebGL layer for shaded cloud ──────────────────────────────────────────
    useEffect(() => {
        if (!mapInstance) return undefined;

        // (Re)add our custom layer and bump the epoch so dependent push-effects
        // re-upload their buffers to the fresh layer. Idempotent.
        const ensureLayer = () => {
            if (mapInstance.getLayer('lidar-shaded-cloud')) return;
            const layer = new LidarWebGLLayer('lidar-shaded-cloud');
            // Add BEFORE the route layers so the itinerary renders on top.
            const beforeId = mapInstance.getLayer('open-cairn-route-line-casing') ? 'open-cairn-route-line-casing' : undefined;
            mapInstance.addLayer(layer, beforeId);
            webglRef.current = layer;
            setStyleEpoch((e) => e + 1);
        };

        // The style may still be (re)building when this overlay mounts — e.g.
        // right after a base-layer/hillshade switch, or when re-displaying a
        // saved cloud during a style rebuild. addLayer() throws "Style is not
        // done loading" in that window, so defer to 'idle' when not ready.
        if (mapInstance.isStyleLoaded()) {
            ensureLayer();
        } else {
            mapInstance.once('idle', ensureLayer);
        }

        // MapLibre setStyle (called on base-layer / hillshade / quality changes)
        // wipes custom layers. Re-add ours on every style.load.
        mapInstance.on('style.load', ensureLayer);

        return () => {
            mapInstance.off('style.load', ensureLayer);
            mapInstance.off('idle', ensureLayer);
            try { mapInstance.removeLayer('lidar-shaded-cloud'); } catch { /* map may be gone */ }
            webglRef.current = null;
        };
    }, [mapInstance]);

    // ── Compute base colour buffer for the WebGL shaded cloud ─────────────────
    // Ground (class 2) uses the server slope palette; every other class uses its
    // classification colour. Vegetation foliage colouring (palette + intensity +
    // height scale) is applied on the GPU in the vertex shader, so this buffer is
    // independent of the foliage sliders and never rebuilt when they move.
    const shadedColors = useMemo(() => {
        if (!lidarShaded) return null;
        const { pointCount, colors, classifications } = lidarShaded;
        const out = new Uint8Array(pointCount * 4);
        for (let i = 0; i < pointCount; i++) {
            const cls = classifications[i] ?? 0;
            let r: number, g: number, b: number;
            if (cls === 2) {
                // Slope palette from the server
                r = colors[i * 4];
                g = colors[i * 4 + 1];
                b = colors[i * 4 + 2];
            } else {
                // Classification palette (also the base the GPU foliage ramp blends from)
                [r, g, b] = LAS_CLASS_COLORS[cls] ?? [200, 200, 200];
            }
            out[i * 4] = r;
            out[i * 4 + 1] = g;
            out[i * 4 + 2] = b;
            out[i * 4 + 3] = 255;
        }
        return out;
    }, [lidarShaded]);

    // ── Per-point height above local ground, for the GPU foliage ramp ─────────
    // Sanitised so the shader gets a finite value (non-finite → 15 m, the ramp's
    // authored top — matches the old CPU fallback). Independent of the sliders.
    const heights = useMemo(() => {
        if (!lidarShaded) return null;
        const { pointCount, heightAboveGround } = lidarShaded;
        const out = new Float32Array(pointCount);
        for (let i = 0; i < pointCount; i++) {
            const h = heightAboveGround ? heightAboveGround[i] : Number.NaN;
            out[i] = Number.isFinite(h) ? h : 15;
        }
        return out;
    }, [lidarShaded]);

    // ── Push shaded data + mesh + config to WebGL layer ─────────────────────
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        if (lidarShaded && shadedColors && heights) {
            layer.setData(
                lidarShaded.positions,
                lidarShaded.normals,
                shadedColors,
                lidarShaded.classifications,
                heights,
                lidarShaded.centerLng,
                lidarShaded.centerLat,
            );
        } else {
            layer.clear();
        }
    }, [lidarShaded, shadedColors, heights, styleEpoch]);

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

    // In Delaunay/Poisson modes the ground (classes 2 sol + 9 eau) is a
    // reconstructed mesh, not points, so the class mask above can't toggle it.
    // Mirror the "Sol" chip onto the mesh: it's shown iff sol or eau is selected.
    useEffect(() => {
        webglRef.current?.setMeshVisible(classes.includes(2) || classes.includes(9));
    }, [classes, lidarMesh, styleEpoch]);

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
            photoOpacityGround: photoOpacity,
            photoOpacityNonGround,
        });
    }, [basePointSize, sizeCompensation, edl, edlStrength, edlRadius, edlFarPlane, opacity, photoOpacity, photoOpacityNonGround, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            sunLightingEnabled: sunEnabled,
            shadowsEnabled: shadows,
            shadowStrength,
        });
    }, [sunEnabled, shadows, shadowStrength, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            vegEnhance,
            vegRound,
            vegJitter,
            vegSizeBoost,
            vegFlatShade: !vegNormalShade,
            vegIntensity,
            vegHeightScale,
            vegColorMode: vegColorMode === 'height' ? 1 : 0,
        });
    }, [vegEnhance, vegRound, vegJitter, vegSizeBoost, vegNormalShade, vegIntensity, vegHeightScale, vegColorMode, styleEpoch]);

    // ── Drapage orthophoto IGN sur le nuage / le mesh ─────────────────────────
    // Récupère une mosaïque orthophoto couvrant l'emprise de la géométrie chargée
    // et la fournit au calque WebGL. Le shader drape la photo aussi bien sur les
    // points (VS_POINTS/FS_POINTS) que sur le mesh, donc on prend le mesh quand
    // il existe (modes delaunay/poisson) sinon le nuage de points (mode shaded) ;
    // les deux partagent le même centre/rayon. Le téléchargement n'a lieu que
    // lorsqu'une géométrie est chargée et que le drapage est activé (opacité > 0) ;
    // bouger le slider ensuite ne re-télécharge rien (le shader mélange juste
    // palette ↔ photo).
    const orthoSource = lidarMesh ?? lidarShaded;
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return undefined;
        if (!orthoSource) {
            layer.clearOrthoTexture();
            orthoRef.current = null;
            return undefined;
        }
        if (photoOpacity <= 0 && photoOpacityNonGround <= 0) return undefined;
        const already = orthoRef.current;
        if (already?.source === orthoSource && already?.epoch === styleEpoch) return undefined;
        orthoRef.current = { source: orthoSource, epoch: styleEpoch };
        const controller = new AbortController();
        let cancelled = false;
        fetchOrthoMosaic(orthoSource.centerLng, orthoSource.centerLat, orthoSource.radius, controller.signal)
            .then((mosaic) => {
                if (cancelled || !mosaic) return;
                webglRef.current?.setOrthoTexture(mosaic.image, mosaic.lngLatRect);
            })
            .catch(() => { /* couverture orthophoto indisponible : on ignore */ });
        return () => { cancelled = true; controller.abort(); };
    }, [orthoSource, photoOpacity, photoOpacityNonGround, styleEpoch]);

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

    return null;
}
