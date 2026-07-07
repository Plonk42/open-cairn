import { isLodDebugEnabled } from '@/lib/debugFlags';
import { labelForestPoints } from '@/lib/lidarBrowser/bdforet';
import { fetchOrthoMosaic } from '@/lib/lidarBrowser/orthoTexture';
import { detectTreetops } from '@/lib/lidarBrowser/treetops';
import { LAS_CLASS_COLORS } from '@/lib/lidarCloud';
import { sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LidarWebGLLayer } from './LidarWebGLLayer';

/**
 * Manages one `LidarWebGLLayer` instance for a single loaded cloud/mesh entry
 * (see `lidarClouds` in the store). Several instances can be mounted at once
 * — one per entry, keyed by `cloudId` — so multiple clouds render, cull and
 * LOD independently. Render *settings* (opacity, shader, veg/forest params,
 * sun, shadows…) stay global and are shared by every instance.
 *
 * Positions are METER_OFFSETS relative to the request center.
 */
export function LidarCloudOverlay({ cloudId }: Readonly<{ cloudId: string }>) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const cloudEntry = useMapStore((s) => s.lidarClouds.find((c) => c.id === cloudId));
    const lidarShaded = cloudEntry?.shaded ?? null;
    const lidarMesh = cloudEntry?.mesh ?? null;
    const cloudVisible = cloudEntry?.visible ?? true;
    // The foliage height-scale slider and `recomputeVegHeights` are global and
    // only ever act on the "primary" cloud (`lidarClouds[0]`, see lidarSlice).
    // One `LidarCloudOverlay` is mounted per loaded cloud, so without this
    // guard every non-primary instance would also fight over the shared
    // height-scale value with its own cloud's auto target, ping-ponging the
    // store forever ("Maximum update depth exceeded").
    const isPrimaryCloud = useMapStore((s) => s.lidarClouds[0]?.id === cloudId);
    const layerId = `lidar-cloud-${cloudId}`;
    const basePointSize = useMapStore((s) => s.lidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const photoOpacity = useMapStore((s) => s.lidarCloudPhotoOpacity);
    const photoOpacityNonGround = useMapStore((s) => s.lidarCloudPhotoOpacityNonGround);
    const lodEnabled = useMapStore((s) => s.lidarLodEnabled);
    const lodForceLevel = useMapStore((s) => s.lidarLodForceLevel);
    const meshWireframe = useMapStore((s) => s.lidarMeshWireframe);
    const setLodDebugInfo = useMapStore((s) => s.setLidarLodDebugInfo);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const shadows = useMapStore((s) => s.lidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const vegEnhance = useMapStore((s) => s.lidarVegEnhance);
    const vegColorMode = useMapStore((s) => s.lidarVegColorMode);
    const vegHeightScale = useMapStore((s) => s.lidarVegHeightScale);
    const vegHeightAuto = useMapStore((s) => s.lidarVegHeightAuto);
    const setVegHeightScale = useMapStore((s) => s.setLidarVegHeightScale);
    const vegIntensity = useMapStore((s) => s.lidarVegIntensity);
    const vegNormalShade = useMapStore((s) => s.lidarVegNormalShade);
    const vegSizeBoost = useMapStore((s) => s.lidarVegSizeBoost);
    const forestGrouping = useMapStore((s) => s.lidarForestGrouping);
    const forestMixCellSize = useMapStore((s) => s.lidarForestMixCellSize);
    const forestHiddenLegend = useMapStore((s) => s.lidarForestHiddenLegend);
    const forestSpeciesFilterOn = useMapStore((s) => s.lidarForestSpeciesFilterOn);
    const forestTreetopSensitivity = useMapStore((s) => s.lidarForestTreetopSensitivity);
    const forestEdgeBlend = useMapStore((s) => s.lidarForestEdgeBlend);
    const forestEdgeBandM = useMapStore((s) => s.lidarForestEdgeBandM);
    const groundGap = useMapStore((s) => s.lidarVegGroundGap);
    const groundRough = useMapStore((s) => s.lidarVegGroundRough);
    const vegColumnCell = useMapStore((s) => s.lidarVegColumnCell);
    const vegRoughLowFrac = useMapStore((s) => s.lidarVegRoughLowFrac);
    const vegOverhangReach = useMapStore((s) => s.lidarVegOverhangReach);
    const vegCliffDistMode = useMapStore((s) => s.lidarVegCliffDistMode);
    const vegColorSmooth = useMapStore((s) => s.lidarVegColorSmooth);
    const vegCliffSparseFallback = useMapStore((s) => s.lidarVegCliffSparseFallback);
    const vegCliffSlopeDeg = useMapStore((s) => s.lidarVegCliffSlopeDeg);
    const vegCliffSlopeSample = useMapStore((s) => s.lidarVegCliffSlopeSample);
    const vegCliffSlopeMin = useMapStore((s) => s.lidarVegCliffSlopeMin);
    const vegDiagMode = useMapStore((s) => s.lidarVegDiagMode);
    const recomputeVegHeights = useMapStore((s) => s.recomputeVegHeights);

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
            if (mapInstance.getLayer(layerId)) return;
            const layer = new LidarWebGLLayer(layerId);
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
            try { mapInstance.removeLayer(layerId); } catch { /* map may be gone */ }
            webglRef.current = null;
        };
    }, [mapInstance, layerId]);

    // ── Show/hide this cloud without discarding its GPU buffers ──────────────
    useEffect(() => {
        webglRef.current?.setVisible(cloudVisible);
    }, [cloudVisible, styleEpoch]);

    // ── Debug-only LOD readout (`?debug=true`/`?debug=lod`) ───────────────────
    // Polls the WebGL layer's current LOD levels so the "LOD distance (debug)"
    // control can show whether it's actually decimating (see LidarAppearanceControls).
    // Not persisted, and inert (no interval) outside the debug flag or without a
    // loaded cloud. Only writes to the store when a value actually changed, so
    // components that don't read it are never re-rendered by this poll.
    useEffect(() => {
        if (!isLodDebugEnabled() || (!lidarShaded && !lidarMesh)) { setLodDebugInfo(null); return undefined; }
        const id = globalThis.setInterval(() => {
            const next = webglRef.current?.getLodDebugInfo() ?? null;
            const prev = useMapStore.getState().lidarLodDebugInfo;
            const changed = !prev || !next
                ? prev !== next
                : prev.pointLevel !== next.pointLevel || prev.pointReady !== next.pointReady
                || prev.meshLevel !== next.meshLevel || prev.meshReady !== next.meshReady
                || Math.round(prev.zoom * 100) !== Math.round(next.zoom * 100);
            if (changed) setLodDebugInfo(next);
        }, 300);
        return () => globalThis.clearInterval(id);
    }, [setLodDebugInfo, lidarShaded, lidarMesh]);

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

    // ── Auto foliage height scale: follow the loaded cloud's tallest tree ─────
    // When "Hauteur auto" is on, snap the height-scale value to the cloud's
    // robust canopy top (cliff-edge artefacts already clamped in the pipeline),
    // so the colour ramp spans the real tree heights without a manual slider.
    useEffect(() => {
        if (!isPrimaryCloud || !vegHeightAuto) return;
        const auto = lidarShaded?.vegHeightAuto;
        if (auto && Math.round(auto) !== Math.round(vegHeightScale)) {
            setVegHeightScale(Math.round(auto));
        }
    }, [isPrimaryCloud, lidarShaded, vegHeightAuto, vegHeightScale, setVegHeightScale]);

    // ── Live recompute of vegetation heights when the height sliders move ─────
    // The gap and ground-relief knobs are baked at capture time, but
    // re-clustering the loaded columns (and re-blending the cached ground grid)
    // is cheap (~200 ms), so a slider change re-derives heights in place without
    // a re-capture. Debounced; the first mount is skipped so a freshly loaded
    // cloud keeps its already-correct heights.
    const gapMountRef = useRef(true);
    useEffect(() => {
        if (gapMountRef.current) { gapMountRef.current = false; return undefined; }
        if (!isPrimaryCloud) return undefined;
        const t = setTimeout(() => recomputeVegHeights(), 150);
        return () => clearTimeout(t);
    }, [
        isPrimaryCloud, groundGap, groundRough, vegColumnCell, vegRoughLowFrac,
        vegOverhangReach, vegCliffDistMode, vegColorSmooth, vegCliffSparseFallback, recomputeVegHeights,
        vegCliffSlopeDeg,
        vegCliffSlopeSample,
        vegCliffSlopeMin,
    ]);

    // ── Push shaded data + mesh + config to WebGL layer ─────────────────────
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return;
        if (lidarShaded && shadedColors && heights) {
            layer.setData({
                positions: lidarShaded.positions,
                normals: lidarShaded.normals,
                colors: shadedColors,
                classifications: lidarShaded.classifications,
                heights,
                originLng: lidarShaded.centerLng,
                originLat: lidarShaded.centerLat,
                forestTfv: lidarShaded.forestTfv,
                treeSeed: lidarShaded.treeSeed,
                vegDiag: lidarShaded.vegDiag,
            });
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
                lidarMesh.baseMask,
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
            lodEnabled,
            lodForceLevel,
            meshWireframe,
        });
    }, [basePointSize, sizeCompensation, edl, edlStrength, edlRadius, edlFarPlane, opacity, photoOpacity, photoOpacityNonGround, lodEnabled, lodForceLevel, meshWireframe, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            sunLightingEnabled: sunEnabled,
            shadowsEnabled: shadows,
            shadowStrength,
        });
    }, [sunEnabled, shadows, shadowStrength, styleEpoch]);

    useEffect(() => {
        let vegColorModeId = 0;
        if (vegColorMode === 'species') vegColorModeId = 2;
        else if (vegColorMode === 'height') vegColorModeId = 1;
        // « Analyse hauteur » overloads the same uniform with 3..6 to paint the
        // height-decision diagnostics; when active it overrides the normal mode.
        if (vegDiagMode === 'decision') vegColorModeId = 3;
        else if (vegDiagMode === 'clusters') vegColorModeId = 4;
        else if (vegDiagMode === 'roughness') vegColorModeId = 5;
        else if (vegDiagMode === 'flags') vegColorModeId = 6;
        webglRef.current?.setConfig({
            vegEnhance,
            vegSizeBoost,
            vegNormalShade,
            vegIntensity,
            vegHeightScale,
            vegColorMode: vegColorModeId,
            forestGrouping,
            forestMixCellSize,
            forestSpeciesFilterOn,
        });
    }, [vegEnhance, vegSizeBoost, vegNormalShade, vegIntensity, vegHeightScale, vegColorMode, vegDiagMode, forestGrouping, forestMixCellSize, forestSpeciesFilterOn, styleEpoch]);

    // ── Legend-as-filter: per-legend-id visibility mask (GPU-side) ────────────
    // The legend doubles as the filter: unchecking an essence/formation hides
    // its points without a re-fetch (the mask is a tiny GPU uniform). The number
    // of legend ids depends on the grouping; ids absent from `forestHiddenLegend`
    // stay visible.
    useEffect(() => {
        const mask = new Uint32Array(8).fill(0xffffffff);
        for (const id of forestHiddenLegend) {
            if (id >= 0 && id < 256) mask[id >>> 5] &= ~(1 << (id & 31));
        }
        webglRef.current?.setSpeciesMask(mask);
    }, [forestHiddenLegend, forestGrouping, styleEpoch]);

    // ── Treetop detection sensitivity → re-seed the species mix mosaic ────────
    // The per-tree seed drives which essence each treetop gets inside mixed
    // stands. Recompute it (debounced) when the sensitivity slider moves, and
    // re-upload just the seed buffer — no full cloud re-upload, no re-fetch.
    useEffect(() => {
        const shaded = lidarShaded;
        const hag = shaded?.heightAboveGround;
        if (!shaded || !hag) return undefined;
        const handle = globalThis.setTimeout(() => {
            const seed = detectTreetops(shaded.positions, hag, shaded.classifications, shaded.pointCount, {
                sensitivity: forestTreetopSensitivity,
            });
            if (seed) webglRef.current?.setTreeSeed(seed);
        }, 200);
        return () => globalThis.clearTimeout(handle);
    }, [forestTreetopSensitivity, lidarShaded, styleEpoch]);

    // ── Essence-boundary blend (sharp / feather / scatter) → re-label points ──
    // Stand membership is decided on the CPU (the GPU only knows each point's own
    // category), so changing the blend means re-labelling from the stored coarse
    // raster and re-uploading just the `a_tfv` attribute — no re-fetch, no full
    // cloud upload. Debounced so dragging the band-width slider stays smooth.
    useEffect(() => {
        const shaded = lidarShaded;
        const raster = shaded?.forestRaster;
        if (!shaded || !raster) return undefined;
        const handle = globalThis.setTimeout(() => {
            const tfv = labelForestPoints(
                shaded.positions, shaded.pointCount, shaded.classifications,
                shaded.centerLng, shaded.centerLat, raster,
                { blend: forestEdgeBlend, bandM: forestEdgeBandM },
            );
            webglRef.current?.setForestTfv(tfv);
        }, 150);
        return () => globalThis.clearTimeout(handle);
    }, [forestEdgeBlend, forestEdgeBandM, lidarShaded, styleEpoch]);

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
