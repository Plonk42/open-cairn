/**
 * Viewpoint mode — pin the eye to a spot on the ground and only rotate.
 *
 * Two effects, deliberately separate:
 *   - **picking**: one click on the map turns into an eye position, the DEM
 *     height under the click plus {@link VIEWPOINT_EYE_HEIGHT_M};
 *   - **the mode itself**: MapLibre's own gestures are switched off and replaced
 *     by a panorama drag that only moves `bearing` / `pitch`, plus a wheel (or a
 *     two-finger pinch) that changes the field of view instead of the zoom.
 *
 * The wheel does NOT zoom here, and that is not a shortcut: with the eye and the
 * field of view fixed, the projected image does not depend on the zoom (see
 * `viewpointCamera.ts`), so a zoom gesture would move nothing on screen. The
 * only meaningful magnification from a fixed standpoint is a longer lens — and
 * narrowing the lens is what raises the zoom, hence the tile detail, which
 * `panoramaDetail.ts` then has to keep MapLibre from giving back.
 *
 * The look direction lives in a ref, not in the store: it changes on every
 * pointer move and re-rendering the map subtree 60×/s is exactly what made the
 * orbit stutter.
 */

import { isTextEntry, setTerrainCameraCollision } from '@/lib/freeCamera';
import { applyPanoramaDetail, applyViewpointNearPlane } from '@/lib/panoramaDetail';
import {
    cameraForViewpoint,
    centerDistanceForZoom,
    easeInOutCubic,
    eyeHeightAfterStep,
    eyeLookingAt,
    flightDurationMs,
    fovAfterPinch,
    fovAfterWheel,
    highestGroundNearby,
    interpolatePose,
    lookAfterDrag,
    VIEWPOINT_EYE_HEIGHT_M,
    VIEWPOINT_INITIAL_PITCH,
    VIEWPOINT_MAX_PITCH,
    VIEWPOINT_MIN_EYE_HEIGHT_M,
    VIEWPOINT_TARGET_DISTANCE_M,
    type LookDirection,
    type Viewpoint,
    type ViewpointPose,
} from '@/lib/viewpointCamera';
import { useMapStore } from '@/stores/mapStore';
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

/** Marks the frames this mode drives, so `moveend` subscribers can skip them. */
export interface ViewpointEventData {
    viewpoint?: boolean;
}

/** Where the flight out lands when there is no camera to return to (a share link). */
const OVERVIEW_ZOOM = 13.5;
const OVERVIEW_PITCH = 45;

/** The camera the mode was entered from: the pose the flights start and end on, and its exact options. */
interface Home {
    pose: ViewpointPose;
    camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
}

function captureHome(map: MapLibreMap): Home {
    const transform = map.painter.transform;
    const at = transform.getCameraLngLat();
    const center = map.getCenter();
    const zoom = map.getZoom();
    const fovDeg = map.getVerticalFieldOfView();
    const look = { bearing: map.getBearing(), pitch: map.getPitch() };
    return {
        pose: {
            eye: { lng: at.lng, lat: at.lat, altitude: transform.getCameraAltitude() },
            look,
            fovDeg,
            distanceM: centerDistanceForZoom(zoom, center.lat, { heightPx: map.getCanvas().clientHeight, fovDeg }),
        },
        camera: { center: [center.lng, center.lat], zoom, ...look },
    };
}

/** A view from above and behind the standpoint, facing the way the eye did. */
function overviewHome(ground: Viewpoint, bearing: number, fovDeg: number, heightPx: number): Home {
    const look = { bearing, pitch: OVERVIEW_PITCH };
    const distanceM = centerDistanceForZoom(OVERVIEW_ZOOM, ground.lat, { heightPx, fovDeg });
    return {
        pose: { eye: eyeLookingAt(ground, look, distanceM), look, fovDeg, distanceM },
        camera: { center: [ground.lng, ground.lat], zoom: OVERVIEW_ZOOM, ...look },
    };
}

function prefersReducedMotion(): boolean {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function showPose(map: MapLibreMap, pose: ViewpointPose): void {
    if (map.getVerticalFieldOfView() !== pose.fovDeg) map.setVerticalFieldOfView(pose.fovDeg);
    const lens = { heightPx: map.getCanvas().clientHeight, fovDeg: pose.fovDeg };
    // `elevation` must travel in the SAME `jumpTo`: with terrain on, MapLibre
    // re-derives the centre elevation from the DEM first and only the explicit
    // option overrides it.
    map.jumpTo(cameraForViewpoint(pose.eye, pose.look, lens, pose.distanceM), { viewpoint: true } satisfies ViewpointEventData);
}

interface Flight {
    /** Jump to the end and land. */
    finish: () => void;
    /** Stop where it is, without landing. */
    cancel: () => void;
}

/**
 * Fly the eye from `from` to `to()` (re-read every frame, so the target may
 * move under it), never letting it sink under the drawn ground on the way.
 */
function fly(map: MapLibreMap, from: ViewpointPose, to: () => ViewpointPose, land: () => void, onFrame: (pose: ViewpointPose) => void): Flight {
    const durationMs = flightDurationMs(from.eye, to().eye);
    const start = performance.now();
    let frame = 0;
    let over = false;
    const stop = () => {
        over = true;
        cancelAnimationFrame(frame);
    };
    const finish = () => {
        if (over) return;
        stop();
        land();
    };
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const pose = interpolatePose(from, to(), easeInOutCubic(t));
        const ground = map.queryTerrainElevation([pose.eye.lng, pose.eye.lat]);
        if (typeof ground === 'number' && Number.isFinite(ground)) {
            pose.eye.altitude = Math.max(pose.eye.altitude, ground + VIEWPOINT_MIN_EYE_HEIGHT_M);
        }
        showPose(map, pose);
        onFrame(pose);
        if (t < 1) frame = requestAnimationFrame(step);
        else finish();
    };
    frame = requestAnimationFrame(step);
    return { finish, cancel: () => { if (!over) stop(); } };
}

/** Distance between the two first tracked pointers, 0 unless there are two. */
function pinchSpacing(pointers: Map<number, { x: number; y: number }>): number {
    if (pointers.size < 2) return 0;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
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
    const leftBehind = useMapStore((s) => s.viewpointLeftBehind);
    /** The flight back out, still running when the mode may be re-entered. */
    const exitFlightRef = useRef<Flight | null>(null);

    // ── The standpoint just left, to pick the next one relative to it. ───────
    useEffect(() => {
        if (!map || !leftBehind) return undefined;
        const marker = new Marker({ color: '#16a34a' })
            .setLngLat([leftBehind.lng, leftBehind.lat])
            .addTo(map);
        marker.getElement().title = 'Lieu précédent';
        return () => { marker.remove(); };
    }, [map, leftBehind]);

    // ── Picking: the next click on the map becomes the standpoint. ──────────
    useEffect(() => {
        if (!map || !picking) return undefined;
        const canvas = map.getCanvas();
        const previousCursor = canvas.style.cursor;
        canvas.style.cursor = 'crosshair';

        const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
            // A standpoint on a slope has the hillside right under the eye.
            const standpoint = highestGroundNearby(e.lngLat, (lng, lat) => map.queryTerrainElevation([lng, lat]));
            if (!standpoint) {
                // The clicked point is on screen, so its DEM tile is normally
                // loaded; bail out rather than plant the eye at sea level.
                console.warn('Viewpoint: no terrain elevation under the click');
                useMapStore.getState().setViewpointPicking(false);
                return;
            }
            useMapStore.getState().setViewpoint({
                lng: standpoint.lng,
                lat: standpoint.lat,
                altitude: standpoint.ground + VIEWPOINT_EYE_HEIGHT_M,
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
        // Land a flight out first: it holds the gestures and the lens this mode
        // is about to save and restore.
        exitFlightRef.current?.finish();
        const canvas = map.getCanvas();
        const initialFov = map.getVerticalFieldOfView();
        const wasClampedToGround = map.getCenterClampedToGround();
        // A share link opens straight onto its author's framing, with no camera
        // of the reader's own to fly from or back to.
        const framing = useMapStore.getState().viewpointFraming;
        const home = framing ? null : captureHome(map);

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
        // Only this mode looks at the far field through a long lens, and only
        // here is the ground texture worth trading for mesh resolution.
        const restoreDetail = applyPanoramaDetail(map);
        const restoreNearPlane = applyViewpointNearPlane(map);

        // A share link opens straight onto its author's framing; otherwise we
        // face whichever way the map already did, just below the horizon.
        const look: LookDirection = framing
            ? { bearing: framing.bearing, pitch: framing.pitch }
            : { bearing: map.getBearing(), pitch: VIEWPOINT_INITIAL_PITCH };
        let fovDeg = framing?.fovDeg ?? initialFov;
        // Local copy: the altitude is not user data, it is a reading of the DEM,
        // and the DEM answers differently depending on the zoom it is sampled at
        // (see `settleOnGround`). Refining it in the store would restart this
        // effect on every correction.
        const eye = { ...viewpoint };
        // Height the eye holds above the ground; the arrows move it, and
        // `settleOnGround` reads it on every `idle` to know what it settles to.
        let eyeHeightM = useMapStore.getState().viewpointHeightM;

        const standingPose = (): ViewpointPose => ({
            eye: { ...eye },
            look: { ...look },
            fovDeg,
            distanceM: VIEWPOINT_TARGET_DISTANCE_M,
        });
        /** What is on screen, which is where a flight out has to start from. */
        let shown = home?.pose ?? standingPose();
        /** The flight in, while it runs; any gesture lands it at once. */
        let entry: Flight | null = null;

        const apply = () => {
            shown = standingPose();
            showPose(map, shown);
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
         * The correction is made against where the camera LANDED, not against
         * what `eye.altitude` asked for. MapLibre rebuilds the eye from a centre
         * placed 4 km down the ray, in mercator, where `cameraForViewpoint` went
         * out in equirectangular: measured over five standpoints the eye arrived
         * 0.73 m to 2.08 m above the ground instead of 1.70 m, and comparing the
         * request to itself could never see it. `getCameraAltitude` follows the
         * asked-for altitude with slope 1, so one pass closes the gap.
         *
         * Re-reading on `idle` costs one extra frame: the altitude does not feed
         * back into the zoom, and the dead band stops a DEM that keeps wobbling
         * by centimetres from looping.
         */
        const settleOnGround = () => {
            if (entry) return;
            const at = map.painter.transform.getCameraLngLat();
            const ground = map.queryTerrainElevation([at.lng, at.lat]);
            if (typeof ground !== 'number' || !Number.isFinite(ground)) return;
            const error = ground + eyeHeightM - map.painter.transform.getCameraAltitude();
            if (Math.abs(error) < 0.2) return;
            eye.altitude += error;
            apply();
        };

        // Up/down arrows lift the standpoint, the one thing the mode otherwise
        // holds fixed — because a slope can keep rising past the snap radius
        // and fill the frame. MapLibre's own arrow panning is
        // already suspended here; the capture phase also keeps the page from
        // scrolling under the map.
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            if (e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            entry?.finish();
            const next = eyeHeightAfterStep(eyeHeightM, e.key === 'ArrowUp', e.shiftKey);
            if (next !== eyeHeightM) useMapStore.getState().setViewpointHeightM(next);
        };

        // The arrows above and the mode bar's buttons both go through the store.
        const unsubscribeHeight = useMapStore.subscribe((s) => {
            // `setViewpoint` resets the height too; that belongs to the next standpoint.
            if (s.viewpoint !== viewpoint || s.viewpointHeightM === eyeHeightM) return;
            eye.altitude += s.viewpointHeightM - eyeHeightM;
            eyeHeightM = s.viewpointHeightM;
            // A flight in re-reads `eye` every frame.
            if (!entry) apply();
        });

        // Tracked by id so a second finger is a pinch rather than a jump: with
        // MapLibre's own touch handlers suspended, nothing else would read it.
        const pointers = new Map<number, { x: number; y: number }>();
        let spacing = 0;

        const onPointerDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            entry?.finish();
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            spacing = pinchSpacing(pointers);
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
        };

        const onPointerMove = (e: PointerEvent) => {
            const previous = pointers.get(e.pointerId);
            if (!previous) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (pointers.size > 1) {
                const next = pinchSpacing(pointers);
                if (spacing > 0 && next > 0) fovDeg = fovAfterPinch(fovDeg, next / spacing);
                spacing = next;
                apply();
                return;
            }

            const next = lookAfterDrag(
                look,
                { dx: e.clientX - previous.x, dy: e.clientY - previous.y },
                { widthPx: canvas.clientWidth, heightPx: canvas.clientHeight },
                fovDeg,
            );
            look.bearing = next.bearing;
            look.pitch = next.pitch;
            apply();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!pointers.delete(e.pointerId)) return;
            // Lifting one finger of a pinch leaves the other one dragging from
            // its last known position, so the panorama does not jump.
            spacing = pinchSpacing(pointers);
            // `pointercancel` — the browser taking the gesture over, which a
            // touch stream does far more readily than a mouse — has already
            // dropped the capture, and releasing it twice throws.
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            if (pointers.size === 0) canvas.style.cursor = 'grab';
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            entry?.finish();
            fovDeg = fovAfterWheel(fovDeg, e.deltaY);
            apply();
        };

        // MapLibre drops `touch-action: none` from the canvas when its touch
        // handlers are disabled, which hands the gesture back to the browser:
        // the first finger movement would scroll the page and cancel our pointer
        // stream. Ours is the only touch consumer while the mode is on.
        const previousTouchAction = canvas.style.touchAction;
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        document.addEventListener('keydown', onKeyDown, true);
        map.on('idle', settleOnGround);
        if (home && !prefersReducedMotion()) {
            entry = fly(map, home.pose, standingPose, () => {
                entry = null;
                apply();
            }, (pose) => { shown = pose; });
        } else {
            apply();
        }

        return () => {
            entry?.cancel();
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            document.removeEventListener('keydown', onKeyDown, true);
            unsubscribeHeight();
            map.off('idle', settleOnGround);
            canvas.style.cursor = '';
            canvas.style.touchAction = previousTouchAction;

            const ground = { ...eye, altitude: eye.altitude - eyeHeightM };
            const back = home ?? overviewHome(ground, look.bearing, initialFov, canvas.clientHeight);
            // Gestures, lens and clamping stay the mode's until the eye is home.
            const land = () => {
                exitFlightRef.current = null;
                restoreDetail();
                restoreNearPlane();
                restoreGestures();
                map.setVerticalFieldOfView(initialFov);
                map.setCenterClampedToGround(wasClampedToGround);
                map.jumpTo(back.camera);
                // Every frame of the mode was tagged, so the store still holds
                // the view from before it; publish where the camera landed.
                const center = map.getCenter();
                useMapStore.getState().setView({
                    longitude: center.lng,
                    latitude: center.lat,
                    zoom: map.getZoom(),
                    pitch: map.getPitch(),
                    bearing: map.getBearing(),
                });
                useMapStore.getState().setViewpointFlying(false);
            };
            if (prefersReducedMotion()) land();
            else exitFlightRef.current = fly(map, shown, () => back.pose, land, () => undefined);
        };
    }, [map, viewpoint]);

    return null;
}
