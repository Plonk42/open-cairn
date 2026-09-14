/**
 * Draw-the-capture-zone interaction: while `lidarRectDrawActive` is set, a drag
 * on the map spans the LiDAR capture rectangle instead of panning.
 *
 * The camera is flattened to pitch 0 for the duration — under pitch the ground
 * footprint of a screen-aligned drag is a trapezoid, so the corner under the
 * cursor would wander away from the preview — and restored when the draw ends.
 * The rectangle's axes follow the bearing the camera had when the draw started,
 * which is what makes a north-up drag give a north-up rectangle.
 */
import { rectFromDrag } from '@/lib/lidarCaptureRect';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';

/** Below this drag distance (px) the gesture is a click, not a rectangle. */
const MIN_DRAG_PX = 8;

type MapPointerEvent = maplibregl.MapMouseEvent | maplibregl.MapTouchEvent;

export function useRectDrawInteraction(mapRef: RefObject<maplibregl.Map | null>): void {
    const active = useMapStore((s) => s.lidarRectDrawActive);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !active) return;

        const restorePitch = map.getPitch();
        const bearingDeg = map.getBearing();
        map.easeTo({ pitch: 0, duration: 200 });
        map.dragPan.disable();
        const canvas = map.getCanvas();
        canvas.style.cursor = 'crosshair';

        let anchor: { lng: number; lat: number } | null = null;
        let anchorPx: maplibregl.Point | null = null;

        const apply = (event: MapPointerEvent) => {
            if (!anchor) return;
            useMapStore.getState().setLidarCaptureRect(
                rectFromDrag(anchor, event.lngLat, bearingDeg),
            );
        };

        const onStart = (event: MapPointerEvent) => {
            event.preventDefault();
            anchor = { lng: event.lngLat.lng, lat: event.lngLat.lat };
            anchorPx = event.point;
        };

        const onMove = (event: MapPointerEvent) => {
            if (!anchorPx || event.point.dist(anchorPx) < MIN_DRAG_PX) return;
            apply(event);
        };

        const onEnd = (event: MapPointerEvent) => {
            // A click without a real drag leaves the previous rectangle alone
            // rather than collapsing it to the minimum side.
            if (anchorPx && event.point.dist(anchorPx) >= MIN_DRAG_PX) apply(event);
            anchor = null;
            anchorPx = null;
            useMapStore.getState().setLidarRectDrawActive(false);
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') useMapStore.getState().setLidarRectDrawActive(false);
        };

        map.on('mousedown', onStart);
        map.on('touchstart', onStart);
        map.on('mousemove', onMove);
        map.on('touchmove', onMove);
        map.on('mouseup', onEnd);
        map.on('touchend', onEnd);
        window.addEventListener('keydown', onKeyDown);

        return () => {
            map.off('mousedown', onStart);
            map.off('touchstart', onStart);
            map.off('mousemove', onMove);
            map.off('touchmove', onMove);
            map.off('mouseup', onEnd);
            map.off('touchend', onEnd);
            window.removeEventListener('keydown', onKeyDown);
            map.dragPan.enable();
            canvas.style.cursor = '';
            map.easeTo({ pitch: restorePitch, duration: 200 });
        };
    }, [mapRef, active]);
}
