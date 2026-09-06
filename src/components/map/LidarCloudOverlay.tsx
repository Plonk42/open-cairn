import { isLodDebugEnabled } from '@/lib/debugFlags';
import { labelForestPoints } from '@/lib/lidarBrowser/bdforet';
import { fetchDrapeMosaic } from '@/lib/lidarBrowser/orthoTexture';
import { detectTreetops } from '@/lib/lidarBrowser/treetops';
import { LAS_CLASS_COLORS } from '@/lib/lidarCloud';
import { sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { lidarCloudLayerId } from './lidarLayerId';
import { LidarWebGLLayer } from './LidarWebGLLayer';

/**
 * Extinction per metre reached when the "brume" slider is at 1. At 5.9e-4 the
 * aerial perspective has washed a surface out to half the haze colour after
 * ~1.2 km — a strong, hazy-summer-afternoon look. The default (0.3) lands
 * around 1/5600 m, which only starts to read past a kilometre.
 */
const HAZE_MAX_DENSITY = 5.9e-4;

/**
 * Exponent applied to the AO factor when the "occlusion" slider is at 1.
 * The composite does `exp(-ao * strength)`, so 2.4 takes a fully occluded
 * fragment down to ~9 % — deep enough for the back of a couloir, short of the
 * black-hole look a higher value gives on the mesh's own micro-relief.
 */
const AO_MAX_STRENGTH = 2.4;

/**
 * AO search radius, in the "2 pixels at unit normalized depth" unit edl.frag
 * uses (it divides by depth/farPlane, so the lobe stays roughly constant in
 * world units). 6 spans a few metres of terrain at usual capture distances:
 * wide enough to catch a gully, narrow enough not to bleed across a ridge.
 */
const AO_RADIUS = 6;

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
    const layerId = lidarCloudLayerId(cloudId);
    const basePointSize = useMapStore((s) => s.lidarCloudPointSize);
    const sizeCompensation = useMapStore((s) => s.lidarCloudSizeCompensation);
    const edl = useMapStore((s) => s.lidarCloudEdl);
    const edlStrength = useMapStore((s) => s.lidarCloudEdlStrength);
    const edlRadius = useMapStore((s) => s.lidarCloudEdlRadius);
    const edlFarPlane = useMapStore((s) => s.lidarCloudEdlFarPlane);
    const opacity = useMapStore((s) => s.lidarCloudOpacity);
    const photoOpacity = useMapStore((s) => s.lidarCloudPhotoOpacity);
    const photoOpacityNonGround = useMapStore((s) => s.lidarCloudPhotoOpacityNonGround);
    const photoSource = useMapStore((s) => s.lidarCloudPhotoSource);
    const scanApiKey = useMapStore((s) => s.ignScanApiKey);
    const lodEnabled = useMapStore((s) => s.lidarLodEnabled);
    const lodForceLevel = useMapStore((s) => s.lidarLodForceLevel);
    const pointSizeMultiplier = useMapStore((s) => s.lidarPointSizeMultiplier);
    const meshWireframe = useMapStore((s) => s.lidarMeshWireframe);
    const setLodDebugInfo = useMapStore((s) => s.setLidarLodDebugInfo);
    const classes = useMapStore((s) => s.lidarCloudClasses);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const sunEnabled = useMapStore((s) => s.lidarSunEnabled);
    const shadows = useMapStore((s) => s.lidarShadows);
    const shadowStrength = useMapStore((s) => s.lidarShadowStrength);
    const shadowMapSize = useMapStore((s) => s.lidarShadowMapSize);
    const photoreal = useMapStore((s) => s.lidarPhotoreal);
    const exposure = useMapStore((s) => s.lidarExposure);
    const ambient = useMapStore((s) => s.lidarAmbient);
    const sunStrength = useMapStore((s) => s.lidarSunStrength);
    const haze = useMapStore((s) => s.lidarHaze);
    const rockFacet = useMapStore((s) => s.lidarRockFacet);
    const rockMicro = useMapStore((s) => s.lidarRockMicro);
    const rockBreak = useMapStore((s) => s.lidarRockBreak);
    const shaderPreset = useMapStore((s) => s.lidarShader);
    const specular = useMapStore((s) => s.lidarRockSpecular);
    const ao = useMapStore((s) => s.lidarAo);
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
    // Geometry + style-epoch for which the basemap mosaic was last fetched, so
    // we don't re-download it when only the opacity slider moves.
    const orthoRef = useRef<{ source: unknown; epoch: number; basemap: string; key: string } | null>(null);
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
            // The AO lobe now only ever lands on the reconstructed mesh: edl.frag
            // skips EDL there (its silhouettes cracked the surface) and this fills
            // the gap with the cue that actually belongs on a continuous surface.
            // The slider is a 0..1 "amount"; AO_MAX_STRENGTH is the exponent that
            // takes a fully occluded pixel to roughly a tenth of its open value.
            // Gated on the photoreal toggle: off restores the historical shading,
            // which had no occlusion term at all.
            aoStrength: photoreal ? ao * AO_MAX_STRENGTH : 0,
            aoRadius: AO_RADIUS,
            opacity,
            photoOpacityGround: photoOpacity,
            photoOpacityNonGround,
            lodEnabled,
            lodForceLevel,
            pointSizeMultiplier,
            meshWireframe,
        });
    }, [basePointSize, sizeCompensation, edl, edlStrength, edlRadius, edlFarPlane, opacity, photoOpacity, photoOpacityNonGround, lodEnabled, lodForceLevel, pointSizeMultiplier, meshWireframe, ao, photoreal, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            sunLightingEnabled: sunEnabled,
            shadowsEnabled: shadows,
            shadowStrength,
            shadowMapSize,
        });
    }, [sunEnabled, shadows, shadowStrength, shadowMapSize, styleEpoch]);

    useEffect(() => {
        webglRef.current?.setConfig({
            pbr: photoreal ? 1 : 0,
            exposure,
            ambient,
            sunStrength,
            // The slider is a 0..1 "amount"; HAZE_MAX_DENSITY is the extinction
            // at 1, chosen so a ridge ~1.7 km away is half-way to the sky colour
            // (a strong but still plausible summer-afternoon haze).
            hazeDensity: haze * HAZE_MAX_DENSITY,
            facet: rockFacet,
            microRelief: rockMicro,
            rockBreak,
            // Seules les palettes qui peignent de la neige autorisent le
            // fragment à lire un taux de neige dans la luminance de l'albédo.
            snowPalette: shaderPreset === 'winter' || shaderPreset === 'montagne' ? 1 : 0,
            specular,
        });
    }, [photoreal, exposure, ambient, sunStrength, haze, rockFacet, rockMicro, rockBreak, shaderPreset, specular, styleEpoch]);

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

    // ── Drapage d'un fond de carte IGN/OSM sur le nuage / le mesh ────────────
    // Récupère une mosaïque (orthophoto, SCAN 25, Plan IGN ou OSM selon
    // `lidarCloudPhotoSource`) couvrant l'emprise de la géométrie chargée et la
    // fournit au calque WebGL. Le shader drape la texture aussi bien sur les
    // points (VS_POINTS/FS_POINTS) que sur le mesh, donc on prend le mesh quand
    // il existe (modes delaunay/poisson) sinon le nuage de points (mode shaded) ;
    // les deux partagent le même centre/rayon. Le téléchargement n'a lieu que
    // lorsqu'une géométrie est chargée et que le drapage est activé ; bouger un
    // slider ensuite ne re-télécharge rien (le shader mélange juste palette ↔
    // texture), d'où le booléen `drapeEnabled` en dépendance plutôt que les deux
    // opacités : sinon chaque cran du slider annulait le téléchargement en cours.
    const orthoSource = lidarMesh ?? lidarShaded;
    const drapeEnabled = photoOpacity > 0 || photoOpacityNonGround > 0;
    // Only SCAN 25 is key-gated, so an unrelated key edit (typed character by
    // character in the settings panel) must not invalidate every mosaic.
    const drapeKey = photoSource === 'scan25' ? scanApiKey : '';
    useEffect(() => {
        const layer = webglRef.current;
        if (!layer) return undefined;
        if (!orthoSource) {
            layer.clearOrthoTexture();
            orthoRef.current = null;
            return undefined;
        }
        if (!drapeEnabled) return undefined;
        const already = orthoRef.current;
        if (already?.source === orthoSource && already.epoch === styleEpoch
            && already.basemap === photoSource && already.key === drapeKey) {
            return undefined;
        }
        const attempt = { source: orthoSource, epoch: styleEpoch, basemap: photoSource, key: drapeKey };
        orthoRef.current = attempt;
        const controller = new AbortController();
        let settled = false;
        let cancelled = false;
        fetchDrapeMosaic({
            source: photoSource,
            lng: orthoSource.centerLng,
            lat: orthoSource.centerLat,
            radiusMeters: orthoSource.radius,
            scanApiKey: drapeKey,
            signal: controller.signal,
        })
            .then((mosaic) => {
                settled = true;
                if (cancelled || !mosaic) return;
                webglRef.current?.setOrthoTexture(mosaic.image, mosaic.lngLatRect);
            })
            .catch(() => { settled = true; /* couverture indisponible : on ignore */ });
        return () => {
            cancelled = true;
            controller.abort();
            // Le téléchargement n'a jamais abouti : oublier la tentative, sinon le
            // garde-fou ci-dessus la considérerait comme déjà satisfaite et ce
            // nuage resterait définitivement sans texture (c'est ce qui laissait
            // les nuages ajoutés en dernier sans drapage).
            if (!settled && orthoRef.current === attempt) orthoRef.current = null;
        };
    }, [orthoSource, drapeEnabled, photoSource, drapeKey, styleEpoch]);

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
