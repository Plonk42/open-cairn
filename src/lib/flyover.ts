import type { Map as MaplibreMap } from 'maplibre-gl';
import { distanceMeters, type LngLatTuple } from './geo';

export interface FlyoverOptions {
    /** Camera pitch in degrees (0 = top-down, 80 = near-horizon) */
    pitch?: number;
    /** Zoom level during flyover */
    zoom?: number;
    /** Minimum total duration in ms (used for very short routes) */
    minDurationMs?: number;
    /** Maximum total duration in ms (so a 100km route doesn't take 10 minutes) */
    maxDurationMs?: number;
    /** Target speed in m/s; clamped by min/max duration */
    speed?: number;
    /** Called each frame with distance traveled along the route (meters). */
    onProgress?: (distanceMeters: number) => void;
    /** Called when flyover ends (naturally or aborted) */
    onEnd?: () => void;
}

const DEFAULT_PITCH = 70;
const DEFAULT_ZOOM = 14.5;
const DEFAULT_SPEED = 80;          // m/s
const DEFAULT_MIN_DURATION = 8_000;
const DEFAULT_MAX_DURATION = 30_000;
const LOOK_AHEAD_METERS = 300;            // where the camera centers (close = see what's coming)
const BEARING_LOOK_AHEAD_METERS = 1200;   // distance used to compute heading (long = averages out wiggles)
const CAMERA_HEIGHT_ABOVE_TERRAIN = 250;
const POSITION_SMOOTH = 0.15;     // per-frame position responsiveness
const BEARING_SMOOTH = 0.05;      // per-frame turn responsiveness (lower = lazier)
const ELEVATION_SMOOTH = 0.08;    // per-frame elevation responsiveness

function bearing(a: LngLatTuple, b: LngLatTuple): number {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLng = (b[0] - a[0]) * toRad;
    const lat1 = a[1] * toRad;
    const lat2 = b[1] * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

function angleDiff(from: number, to: number): number {
    return ((to - from) % 360 + 540) % 360 - 180;
}

interface RouteIndex {
    coords: LngLatTuple[];
    cumDistances: number[];
    total: number;
}

function buildRouteIndex(coordinates: LngLatTuple[]): RouteIndex {
    const cum: number[] = [0];
    for (let i = 1; i < coordinates.length; i++) {
        cum.push(cum[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
    }
    return { coords: coordinates, cumDistances: cum, total: cum[cum.length - 1] };
}

/** Get point at a given distance along the route by linear interpolation. */
function pointAtDistance(idx: RouteIndex, distance: number): LngLatTuple {
    const d = Math.max(0, Math.min(distance, idx.total));
    let lo = 0;
    let hi = idx.cumDistances.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (idx.cumDistances[mid] <= d) lo = mid;
        else hi = mid;
    }
    const segLen = idx.cumDistances[hi] - idx.cumDistances[lo];
    const t = segLen === 0 ? 0 : (d - idx.cumDistances[lo]) / segLen;
    const a = idx.coords[lo];
    const b = idx.coords[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export class FlyoverController {
    private animationId: number | null = null;
    private aborted = false;

    start(map: MaplibreMap, coordinates: LngLatTuple[], options: FlyoverOptions = {}): void {
        const {
            pitch = DEFAULT_PITCH,
            zoom = DEFAULT_ZOOM,
            speed = DEFAULT_SPEED,
            minDurationMs = DEFAULT_MIN_DURATION,
            maxDurationMs = DEFAULT_MAX_DURATION,
            onProgress,
            onEnd,
        } = options;

        this.aborted = false;
        if (coordinates.length < 2) { onEnd?.(); return; }

        // Dedupe adjacent identical points
        const cleaned: LngLatTuple[] = [coordinates[0]];
        for (let i = 1; i < coordinates.length; i++) {
            const prev = cleaned[cleaned.length - 1];
            if (prev[0] !== coordinates[i][0] || prev[1] !== coordinates[i][1]) {
                cleaned.push(coordinates[i]);
            }
        }
        if (cleaned.length < 2) { onEnd?.(); return; }

        const idx = buildRouteIndex(cleaned);
        const totalDistance = idx.total;
        if (totalDistance === 0) { onEnd?.(); return; }

        // Speed-based duration, clamped to a comfortable range
        const rawDuration = (totalDistance / speed) * 1000;
        const totalDurationMs = Math.max(minDurationMs, Math.min(maxDurationMs, rawDuration));

        const terrainEnabled = !!map.getTerrain();

        // Robust elevation: ignore null/0/NaN (typically means tiles not yet loaded)
        let lastGoodElevation: number | null = null;
        const elevAt = (lngLat: LngLatTuple): number | null => {
            if (!terrainEnabled) return null;
            const e = map.queryTerrainElevation(lngLat);
            if (typeof e !== 'number' || !Number.isFinite(e) || e === 0) return null;
            return e;
        };
        const corridorElevation = (a: LngLatTuple, b: LngLatTuple): number => {
            const cands = [
                elevAt(a),
                elevAt(b),
                elevAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
            ].filter((x): x is number => x !== null);
            if (cands.length > 0) {
                const max = Math.max(...cands);
                lastGoodElevation = max;
                return max;
            }
            return lastGoodElevation ?? 0;
        };

        // Initial frame
        const initialPos = pointAtDistance(idx, 0);
        const initialLookAt = pointAtDistance(idx, LOOK_AHEAD_METERS);
        const initialBearingTarget = pointAtDistance(idx, BEARING_LOOK_AHEAD_METERS);
        const initialBearing = bearing(initialPos, initialBearingTarget);
        const initialElevation = terrainEnabled
            ? corridorElevation(initialPos, initialLookAt) + CAMERA_HEIGHT_ABOVE_TERRAIN
            : 0;

        map.jumpTo({ center: initialLookAt, zoom, pitch, bearing: initialBearing });
        if (terrainEnabled) map.setCenterElevation(initialElevation);

        let startTime: number | null = null;
        let smoothBearing = initialBearing;
        let smoothElevation = initialElevation;
        let smoothLng = initialLookAt[0];
        let smoothLat = initialLookAt[1];

        const animate = (timestamp: number) => {
            if (this.aborted) { onEnd?.(); return; }

            startTime ??= timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / totalDurationMs, 1);
            const distance = progress * totalDistance;

            // CONTINUOUS interpolation (no snapping)
            const currentPoint = pointAtDistance(idx, distance);
            const lookAtTarget = pointAtDistance(idx, distance + LOOK_AHEAD_METERS);
            // Bearing reference: a point further ahead so we don't whip on every wiggle
            const bearingTarget = pointAtDistance(idx, distance + BEARING_LOOK_AHEAD_METERS);

            const targetBearing = bearing(currentPoint, bearingTarget);
            smoothBearing += angleDiff(smoothBearing, targetBearing) * BEARING_SMOOTH;

            // Smooth the camera center position itself (avoids tracking every wiggle)
            smoothLng += (lookAtTarget[0] - smoothLng) * POSITION_SMOOTH;
            smoothLat += (lookAtTarget[1] - smoothLat) * POSITION_SMOOTH;

            map.jumpTo({
                center: [smoothLng, smoothLat],
                bearing: smoothBearing,
                pitch,
                zoom,
            });

            if (terrainEnabled) {
                const targetElevation = corridorElevation(currentPoint, lookAtTarget) + CAMERA_HEIGHT_ABOVE_TERRAIN;
                smoothElevation += (targetElevation - smoothElevation) * ELEVATION_SMOOTH;
                map.setCenterElevation(smoothElevation);
            }

            onProgress?.(distance);

            if (progress < 1) {
                this.animationId = requestAnimationFrame(animate);
            } else {
                this.animationId = null;
                onEnd?.();
            }
        };

        this.animationId = requestAnimationFrame(animate);
    }

    stop(): void {
        this.aborted = true;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}
