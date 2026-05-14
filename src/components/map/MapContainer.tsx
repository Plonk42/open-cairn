import { registerCompositeProtocol } from '@/lib/compositeProtocol';
import { buildMapStyle } from '@/lib/mapStyle';
import { useMapStore } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

registerCompositeProtocol();

export function MapContainer() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    const baseLayer = useMapStore((s) => s.baseLayer);
    const view = useMapStore((s) => s.view);
    const setView = useMapStore((s) => s.setView);
    const hillshadeEnabled = useMapStore((s) => s.hillshadeEnabled);
    const hillshadeSource = useMapStore((s) => s.hillshadeSource);
    const hillshadeBlend = useMapStore((s) => s.hillshadeBlend);
    const hillshadeIntensity = useMapStore((s) => s.hillshadeIntensity);
    const terrainEnabled = useMapStore((s) => s.terrainEnabled);
    const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);

    // Initial map creation (runs once)
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const initial = useMapStore.getState();
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: buildMapStyle({
                base: initial.baseLayer,
                hillshade: initial.hillshadeEnabled,
                hillshadeSource: initial.hillshadeSource,
                hillshadeBlend: initial.hillshadeBlend,
                hillshadeIntensity: initial.hillshadeIntensity,
            }),
            center: [view.longitude, view.latitude],
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            maxPitch: 85,
            // Allow overzoom past the source maxzoom so users can keep
            // diving in past z19 (MapLibre will reuse parent tiles).
            maxZoom: 22,
            // false: prevent the post-animation recalculateZoomAndCenter
            // (terrain) pass that fires at the end of every camera move
            // (right-click drag, NavigationControl click, easeTo). With
            // `true` that pass re-derives zoom from camera altitude over
            // a possibly-stale DEM tile and snaps zoom backwards after
            // every gesture. We keep zoom authoritative; this only
            // affects how MapLibre would clamp camera-vs-ground, which
            // we don't need for our use case.
            centerClampedToGround: false,
            hash: true,
            // Disable MapLibre's built-in scroll-zoom gesture handler.
            // Its terrain interaction is broken: at any pitch the
            // setLocationAtPoint() call it issues to keep the cursor
            // anchored over the same ground point with terrain on
            // produces violent pitch collapses or zoom freezes that
            // can't be worked around through public configuration.
            // We replace it with a plain easeTo() based handler below.
            scrollZoom: false,
        });
        mapRef.current = map;
        if (import.meta.env.DEV)
            (globalThis as unknown as { __map: maplibregl.Map }).__map = map;

        map.addControl(
            new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
            'top-right',
        );
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

        // Custom wheel-zoom built on jumpTo() + requestAnimationFrame.
        //
        // Why we don't use MapLibre's built-in scrollZoom or easeTo:
        //   - The built-in handler issues a setLocationAtPoint() to anchor
        //     the cursor over a ground point each tick; with terrain on
        //     this collapses pitch and freezes zoom at any pitch.
        //   - easeTo() runs an animation that ends with `_finalizeElevation`
        //     -> `recalculateZoomAndCenter(terrain)` (when
        //     centerClampedToGround=true), and rapid easeTo() calls fight
        //     each other through that recalculation, producing pitch
        //     decay and zoom freezes.
        //   - jumpTo() does NOT trigger `_finalizeElevation` and leaves
        //     pitch/center untouched. Verified to be smooth and stable
        //     when called repeatedly at high pitch with terrain.
        //
        // We integrate wheel events into a target zoom and lerp the
        // current zoom toward it on every animation frame using jumpTo.
        const ZOOM_PER_NOTCH = 1 / 450; // ~0.27 zoom per 120 deltaY notch
        const SMOOTHING = 0.18; // per-frame lerp factor (higher = snappier)
        let targetZoom = map.getZoom();
        let rafId = 0;
        const tick = () => {
            const cur = map.getZoom();
            const diff = targetZoom - cur;
            if (Math.abs(diff) < 0.001) {
                map.jumpTo({ zoom: targetZoom });
                rafId = 0;
                return;
            }
            map.jumpTo({ zoom: cur + diff * SMOOTHING });
            rafId = requestAnimationFrame(tick);
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            // Re-sync target on idle so user pan/keyboard zoom is respected.
            if (!rafId) targetZoom = map.getZoom();
            const dz = -e.deltaY * ZOOM_PER_NOTCH;
            targetZoom = Math.max(
                map.getMinZoom(),
                Math.min(map.getMaxZoom(), targetZoom + dz),
            );
            if (!rafId) rafId = requestAnimationFrame(tick);
        };
        map.getCanvas().addEventListener('wheel', onWheel, { passive: false });

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
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Rebuild style when base layer or hillshade settings change.
    // Intensity changes are debounced so dragging the slider doesn't thrash.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const handle = globalThis.setTimeout(() => {
            map.setStyle(
                buildMapStyle({
                    base: baseLayer,
                    hillshade: hillshadeEnabled,
                    hillshadeSource,
                    hillshadeBlend,
                    hillshadeIntensity,
                }),
                { diff: false },
            );
            map.once('styledata', () => {
                if (terrainEnabled) {
                    map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
                }
            });
        }, 120);
        return () => globalThis.clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseLayer, hillshadeEnabled, hillshadeSource, hillshadeBlend, hillshadeIntensity]);

    // Terrain on/off + exaggeration (no style rebuild needed).
    useEffect(() => {
        const map = mapRef.current;
        if (!map?.isStyleLoaded()) return;
        if (terrainEnabled) {
            map.setTerrain({ source: 'terrain', exaggeration: terrainExaggeration });
        } else {
            map.setTerrain(null);
        }
    }, [terrainEnabled, terrainExaggeration]);

    return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
