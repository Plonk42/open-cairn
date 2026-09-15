/**
 * Draw-the-capture-zone interaction: while `lidarRectDrawActive` is set, a drag
 * on the map spans the LiDAR capture rectangle instead of panning.
 *
 * The mode stays armed for as long as the capture panel is open, so a second
 * drag simply replaces the rectangle the first one produced.
 *
 * The camera is flattened to pitch 0 for the duration — under pitch the ground
 * footprint of a screen-aligned drag is a trapezoid, so the corner under the
 * cursor would wander away from the preview — and restored when the mode ends.
 * The rectangle's axes follow the bearing the camera has at the start of each
 * drag, which is what makes a north-up drag give a north-up rectangle.
 */
import { rectFromDrag, type CaptureRect } from '@/lib/lidarCaptureRect';
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
        map.easeTo({ pitch: 0, duration: 200 });
        map.dragPan.disable();
        const canvas = map.getCanvas();
        canvas.style.cursor = 'crosshair';

        let anchor: { lng: number; lat: number } | null = null;
        let anchorPx: maplibregl.Point | null = null;
        let rectBeforeDrag: CaptureRect | null = null;
        let dragBearingDeg = 0;

        const apply = (event: MapPointerEvent) => {
            if (!anchor) return;
            useMapStore.getState().setLidarCaptureRect(
                rectFromDrag(anchor, event.lngLat, dragBearingDeg),
            );
        };

        /** Drops the drag in progress and puts the rectangle it replaced back. */
        const cancelDrag = () => {
            if (rectBeforeDrag) useMapStore.getState().setLidarCaptureRect(rectBeforeDrag);
            anchor = null;
            anchorPx = null;
            rectBeforeDrag = null;
        };

        const onStart = (event: MapPointerEvent) => {
            // Two fingers are a pinch, not a rectangle: bail out before
            // `preventDefault`, which would also disable zoom and rotate.
            if ('points' in event && event.points.length > 1) {
                cancelDrag();
                return;
            }
            event.preventDefault();
            anchor = { lng: event.lngLat.lng, lat: event.lngLat.lat };
            anchorPx = event.point;
            dragBearingDeg = map.getBearing();
            rectBeforeDrag = useMapStore.getState().lidarCaptureRect;
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
            rectBeforeDrag = null;
        };

        // Escape aborts the rectangle being dragged; leaving the mode is the
        // capture panel's job, not a key's.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && rectBeforeDrag) cancelDrag();
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
