/**
 * Viewpoint mode — pin the eye to a spot on the ground and only rotate.
 *
 * Two effects, deliberately separate:
 *   - **picking**: one click on the map turns into an eye position, the DEM
 *     height under the click plus {@link VIEWPOINT_EYE_HEIGHT_M};
 *   - **the mode itself**: MapLibre's own gestures are switched off and replaced
 *     by a panorama drag that only moves `bearing` / `pitch`, plus a wheel that
 *     changes the field of view instead of the zoom.
 *
 * The wheel does NOT zoom here, and that is not a shortcut: with the eye and the
 * field of view fixed, the rendered image does not depend on the zoom at all
 * (see `viewpointCamera.ts`), so a zoom gesture would be a no-op on screen. The
 * only meaningful magnification from a fixed standpoint is a longer lens.
 *
 * The look direction lives in a ref, not in the store: it changes on every
 * pointer move and re-rendering the map subtree 60×/s is exactly what made the
 * orbit stutter.
 */

import { setTerrainCameraCollision } from '@/lib/freeCamera';
import {
    cameraForViewpoint,
    fovAfterWheel,
    lookAfterDrag,
    VIEWPOINT_EYE_HEIGHT_M,
    VIEWPOINT_INITIAL_PITCH,
    VIEWPOINT_MAX_PITCH,
    type LookDirection,
} from '@/lib/viewpointCamera';
import { useMapStore } from '@/stores/mapStore';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect } from 'react';

/** Marks the frames this mode drives, so `moveend` subscribers can skip them. */
export interface ViewpointEventData {
    viewpoint?: boolean;
}

/** Disables every MapLibre gesture that would move the eye, and restores them. */
function suspendMapGestures(map: MapLibreMap): () => void {
    const handlers = [
        map.dragPan, map.dragRotate, map.scrollZoom,
        map.doubleClickZoom, map.keyboard, map.touchZoomRotate,
    ];
    const wasEnabled = handlers.map((h) => h.isEnabled());
    for (const handler of handlers) handler.disable();
    return () => {
        handlers.forEach((handler, i) => { if (wasEnabled[i]) handler.enable(); });
    };
}

export function ViewpointController(): null {
    const map = useMapStore((s) => s.mapInstance);
    const viewpoint = useMapStore((s) => s.viewpoint);
    const picking = useMapStore((s) => s.viewpointPicking);

    // ── Picking: the next click on the map becomes the standpoint. ──────────
    useEffect(() => {
        if (!map || !picking) return undefined;
        const canvas = map.getCanvas();
        const previousCursor = canvas.style.cursor;
        canvas.style.cursor = 'crosshair';

        const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
            const ground = map.queryTerrainElevation(e.lngLat);
            if (typeof ground !== 'number' || !Number.isFinite(ground)) {
                // The clicked point is on screen, so its DEM tile is normally
                // loaded; bail out rather than plant the eye at sea level.
                console.warn('Viewpoint: no terrain elevation under the click');
                useMapStore.getState().setViewpointPicking(false);
                return;
            }
            useMapStore.getState().setViewpoint({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
                altitude: ground + VIEWPOINT_EYE_HEIGHT_M,
            });
        };

        map.once('click', onClick);
        return () => {
            canvas.style.cursor = previousCursor;
            map.off('click', onClick);
        };
    }, [map, picking]);

    // ── The mode itself. ───────────────────────────────────────────────────
    useEffect(() => {
        if (!map || !viewpoint) return undefined;
        const canvas = map.getCanvas();
        const initialFov = map.getVerticalFieldOfView();
        const wasClampedToGround = map.getCenterClampedToGround();

        // The centre is parked kilometres away at an altitude that has nothing to
        // do with the relief, so it must stop being re-derived from the DEM every
        // frame. MapContainer owns the terrain-collision toggle in steady state,
        // but child effects run before parent ones, so the first frame would be
        // clamped if we did not turn it off here too.
        map.setCenterClampedToGround(false);
        setTerrainCameraCollision(map, false);
        // Same reason for the pitch ceiling: MapContainer raises it for this mode,
        // but its effect runs after ours and nothing would re-apply the camera —
        // a restored look above the horizon would stay clamped at 85°.
        map.setMaxPitch(VIEWPOINT_MAX_PITCH);
        const restoreGestures = suspendMapGestures(map);

        // A share link opens straight onto its author's framing; otherwise we
        // face whichever way the map already did, just below the horizon.
        const framing = useMapStore.getState().viewpointFraming;
        const look: LookDirection = framing
            ? { bearing: framing.bearing, pitch: framing.pitch }
            : { bearing: map.getBearing(), pitch: VIEWPOINT_INITIAL_PITCH };
        let fovDeg = framing?.fovDeg ?? initialFov;
        // Local copy: the altitude is not user data, it is a reading of the DEM,
        // and the DEM answers differently depending on the zoom it is sampled at
        // (see `settleOnGround`). Refining it in the store would restart this
        // effect on every correction.
        const eye = { ...viewpoint };

        const apply = () => {
            if (map.getVerticalFieldOfView() !== fovDeg) map.setVerticalFieldOfView(fovDeg);
            const camera = cameraForViewpoint(eye, look, {
                heightPx: canvas.clientHeight,
                fovDeg,
            });
            // `elevation` must travel in the SAME `jumpTo`: with terrain on,
            // MapLibre re-derives the centre elevation from the DEM first and
            // only the explicit option overrides it.
            map.jumpTo(camera, { viewpoint: true } satisfies ViewpointEventData);
        };

        /**
         * Put the eye back on the surface that is actually being drawn.
         *
         * `queryTerrainElevation` samples the DEM tile of the CURRENT zoom, and
         * entering the mode changes that zoom — so the height read at pick time
         * belongs to a coarser mesh than the one the camera then flies through.
         * Measured above Argentière: 1025.5 m at z13 against 1031.2 m at z14.5,
         * a 5.7 m gap on a slope. That is more than the eye height, so the
         * camera ended up inside the mountain and the screen went black.
         *
         * Re-reading on `idle` costs one extra frame and converges immediately:
         * the altitude does not feed back into the zoom, and the dead band stops
         * a DEM that keeps wobbling by centimetres from looping.
         */
        const settleOnGround = () => {
            const ground = map.queryTerrainElevation([eye.lng, eye.lat]);
            if (typeof ground !== 'number' || !Number.isFinite(ground)) return;
            const wanted = ground + VIEWPOINT_EYE_HEIGHT_M;
            if (Math.abs(wanted - eye.altitude) < 0.2) return;
            eye.altitude = wanted;
            apply();
        };

        let pointerId: number | null = null;
        let lastX = 0;
        let lastY = 0;

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            pointerId = e.pointerId;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
        };

        const onPointerMove = (e: PointerEvent) => {
            if (pointerId !== e.pointerId) return;
            const next = lookAfterDrag(
                look,
                { dx: e.clientX - lastX, dy: e.clientY - lastY },
                { widthPx: canvas.clientWidth, heightPx: canvas.clientHeight },
                fovDeg,
            );
            look.bearing = next.bearing;
            look.pitch = next.pitch;
            lastX = e.clientX;
            lastY = e.clientY;
            apply();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (pointerId !== e.pointerId) return;
            pointerId = null;
            canvas.releasePointerCapture(e.pointerId);
            canvas.style.cursor = 'grab';
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            fovDeg = fovAfterWheel(fovDeg, e.deltaY);
            apply();
        };

        // MapLibre builds a `MapMouseEvent` for every `mousemove` reaching the
        // canvas container, and that constructor unprojects the pointer eagerly.
        // With 3D terrain an unproject renders the coords framebuffer and blocks
        // on `gl.readPixels`: measured ~7 ms, paid on every drag frame on top of
        // the camera update, for a ground coordinate that means nothing while the
        // panorama turns. The listener sits on the canvas, one level below the
        // container MapLibre listens on, and only swallows during a drag — so the
        // coordinate readout still follows a plain hover.
        const onMouseMove = (e: MouseEvent) => {
            if (pointerId !== null) e.stopPropagation();
        };

        canvas.style.cursor = 'grab';
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        map.on('idle', settleOnGround);
        apply();

        return () => {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('wheel', onWheel);
            map.off('idle', settleOnGround);
            canvas.style.cursor = '';
            restoreGestures();
            map.setVerticalFieldOfView(initialFov);
            map.setCenterClampedToGround(wasClampedToGround);
            // Every frame of the mode was tagged, so the store still holds the
            // view from before it; publish where the camera actually ended up.
            const center = map.getCenter();
            useMapStore.getState().setView({
                longitude: center.lng,
                latitude: center.lat,
                zoom: map.getZoom(),
                pitch: map.getPitch(),
                bearing: map.getBearing(),
            });
        };
    }, [map, viewpoint]);

    return null;
}
