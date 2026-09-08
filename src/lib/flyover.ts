import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ElevationSample } from './elevation';
import { dedupeAdjacentCoordinates, distanceMeters, type LngLatTuple } from './geo';

export interface FlyoverOptions {
    /** Route elevation profile; the camera plane follows it instead of the DEM. */
    profile: ElevationSample[];
    /** Camera pitch in degrees (0 = top-down, 80 = near-horizon) */
    pitch?: number;
    /** Minimum total duration in ms (used for very short routes) */
    minDurationMs?: number;
    /** Maximum total duration in ms (so a 100km route doesn't take an hour) */
    maxDurationMs?: number;
    /** Cruise speed in m/s; the min/max duration clamp overrides it */
    speed?: number;
    /** Called each frame with distance traveled along the route (meters). */
    onProgress?: (distanceMeters: number) => void;
    /** Called when flyover ends (naturally or aborted) */
    onEnd?: () => void;
}

const DEFAULT_PITCH = 70;
const DEFAULT_SPEED = 25;          // m/s
const DEFAULT_MIN_DURATION = 15_000;
const DEFAULT_MAX_DURATION = 90_000;

// The duration clamp, not `speed`, sets the pace of any long route: an 85 km
// trail flown in 90 s cruises at 900 m/s, 36x the nominal speed. So every
// camera distance below is a NUMBER OF SECONDS OF FLIGHT, never a number of
// metres — a metre value tuned at one end of that range is absurd at the other.
const LOOK_AHEAD_SECONDS = 2;             // where the camera centers
const BEARING_LOOK_AHEAD_SECONDS = 5;     // heading reference point
// Smoothing the path over N seconds caps the turn rate at about 1/N rad/s
// whatever the speed, which is the whole point: shake is angular velocity.
const PATH_SMOOTH_SECONDS = 5;
const PATH_SMOOTH_PASSES = 2;
const VISIBLE_SECONDS = 14;               // ground kept in frame; this is what sets the zoom
const PATH_STEP_METERS = 20;              // spacing of the resampled camera path
const CAMERA_CLEARANCE_METERS = 200;      // the smoothed profile averages summits away
const EASE_EDGE = 0.12;                   // share of the flight spent ramping speed up, then down
const MIN_ZOOM = 11.5;
const MAX_ZOOM = 15;
const TILE_SIZE = 512;
const EQUATOR_METERS = 40_075_016.686;

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

/** Bracketing indices and interpolation factor for a distance along the route. */
function locate(idx: RouteIndex, distance: number): { lo: number; hi: number; t: number } {
    const d = Math.max(0, Math.min(distance, idx.total));
    let lo = 0;
    let hi = idx.cumDistances.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (idx.cumDistances[mid] <= d) lo = mid;
        else hi = mid;
    }
    const segLen = idx.cumDistances[hi] - idx.cumDistances[lo];
    return { lo, hi, t: segLen === 0 ? 0 : (d - idx.cumDistances[lo]) / segLen };
}

function pointAtDistance(idx: RouteIndex, distance: number): LngLatTuple {
    const { lo, hi, t } = locate(idx, distance);
    const a = idx.coords[lo];
    const b = idx.coords[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Read a per-sample series (altitudes) at an arbitrary distance along the path. */
function valueAtDistance(idx: RouteIndex, values: number[], distance: number): number {
    const { lo, hi, t } = locate(idx, distance);
    return values[lo] + (values[hi] - values[lo]) * t;
}

/** Re-sample the route at a constant arc-length step. */
function resampleByDistance(idx: RouteIndex, step: number): LngLatTuple[] {
    const count = Math.max(1, Math.ceil(idx.total / step));
    const out: LngLatTuple[] = [];
    for (let i = 0; i <= count; i++) out.push(pointAtDistance(idx, (i / count) * idx.total));
    return out;
}

/**
 * Moving average over evenly spaced samples. The window shrinks near the ends so
 * both extremities stay exactly on the route.
 */
function smoothSeries(values: number[], radius: number): number[] {
    const n = values.length;
    if (radius < 1 || n < 3) return values;
    const sum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + values[i];
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        const r = Math.min(radius, i, n - 1 - i);
        out.push((sum[i + r + 1] - sum[i - r]) / (2 * r + 1));
    }
    return out;
}

/**
 * The camera flies along a smoothed copy of the route, not along the GPX polyline:
 * a polyline is only C0, so its direction jumps at every vertex.
 */
function buildFlyoverPath(route: RouteIndex, radius: number): RouteIndex {
    const samples = resampleByDistance(route, PATH_STEP_METERS);
    let lng = samples.map((p) => p[0]);
    let lat = samples.map((p) => p[1]);
    for (let pass = 0; pass < PATH_SMOOTH_PASSES; pass++) {
        lng = smoothSeries(lng, radius);
        lat = smoothSeries(lat, radius);
    }
    return buildRouteIndex(lng.map((x, i): LngLatTuple => [x, lat[i]]));
}

/**
 * Altitude of the camera plane at each path sample. Read from the route's own
 * profile rather than from the DEM: it is available up front for the whole
 * route, so the series can be smoothed as a whole instead of being chased by a
 * per-frame filter.
 */
function buildAltitudeProfile(
    path: RouteIndex,
    routeTotal: number,
    profile: ElevationSample[],
    radius: number,
    fallback: number,
): number[] {
    if (profile.length < 2) return path.coords.map(() => fallback + CAMERA_CLEARANCE_METERS);
    let j = 0;
    const raw = path.cumDistances.map((d) => {
        const target = (d / path.total) * routeTotal;
        while (j < profile.length - 2 && profile[j + 1].distance < target) j++;
        const a = profile[j];
        const b = profile[j + 1];
        const span = b.distance - a.distance;
        const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (target - a.distance) / span));
        return a.elevation + (b.elevation - a.elevation) * t + CAMERA_CLEARANCE_METERS;
    });
    return smoothSeries(raw, radius);
}

/** Zoom that keeps roughly `VISIBLE_SECONDS` of flight in frame. */
function zoomForSpeed(map: MaplibreMap, speed: number, latitude: number): number {
    const widthPx = Math.max(1, map.getCanvas().clientWidth);
    const metersPerPixel = (speed * VISIBLE_SECONDS) / widthPx;
    const worldMeters = EQUATOR_METERS * Math.cos((latitude * Math.PI) / 180);
    const zoom = Math.log2(worldMeters / (TILE_SIZE * metersPerPixel));
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Distance fraction covered at time fraction `p`, for a speed profile that ramps
 * up over the first `edge` of the flight and back down over the last one.
 */
function easedDistanceFraction(p: number, edge: number): number {
    // Integral of smoothstep, so speed (not just position) is continuous at both ends.
    const rampIntegral = (t: number) => t ** 3 - (t ** 4) / 2;
    const cruise = 1 - edge;
    if (p < edge) return (edge * rampIntegral(p / edge)) / cruise;
    if (p > 1 - edge) return (cruise - edge * rampIntegral((1 - p) / edge)) / cruise;
    return (edge / 2 + (p - edge)) / cruise;
}

export class FlyoverController {
    private animationId: number | null = null;
    private aborted = false;

    start(map: MaplibreMap, coordinates: LngLatTuple[], options: FlyoverOptions): void {
        const {
            profile,
            pitch = DEFAULT_PITCH,
            speed = DEFAULT_SPEED,
            minDurationMs = DEFAULT_MIN_DURATION,
            maxDurationMs = DEFAULT_MAX_DURATION,
            onProgress,
            onEnd,
        } = options;

        this.aborted = false;
        const cleaned = dedupeAdjacentCoordinates(coordinates);
        if (cleaned.length < 2) { onEnd?.(); return; }

        const route = buildRouteIndex(cleaned);
        if (route.total === 0) { onEnd?.(); return; }

        // Duration first: on any long route the clamp is what really sets the pace,
        // and the whole camera geometry is then derived from the resulting speed.
        // Dividing by the cruise share keeps the ramps from speeding up the middle.
        const rawDuration = (route.total / speed) * 1000 / (1 - EASE_EDGE);
        const totalDurationMs = Math.max(minDurationMs, Math.min(maxDurationMs, rawDuration));
        const cruiseSpeed = route.total / ((totalDurationMs / 1000) * (1 - EASE_EDGE));

        const lookAhead = cruiseSpeed * LOOK_AHEAD_SECONDS;
        const headingAhead = cruiseSpeed * BEARING_LOOK_AHEAD_SECONDS;
        const radius = Math.round((cruiseSpeed * PATH_SMOOTH_SECONDS) / PATH_STEP_METERS);

        const idx = buildFlyoverPath(route, radius);
        const zoom = zoomForSpeed(map, cruiseSpeed, cleaned[0][1]);
        // With 3D terrain off the center plane is sea level, as MapLibre expects.
        const altitudes = map.getTerrain()
            ? buildAltitudeProfile(idx, route.total, profile, radius, map.queryTerrainElevation(idx.coords[0]) ?? 0)
            : idx.coords.map(() => 0);

        // Everything the camera reads is now a smooth function of arc length, and
        // arc length is a smooth function of elapsed time: no per-frame filter, so
        // nothing here depends on the framerate.
        const frame = (distance: number) => {
            // Freezing the heading reference near the finish keeps the two points
            // from collapsing onto each other, which would snap the bearing north.
            const from = Math.min(distance, Math.max(0, idx.total - headingAhead));
            const center = pointAtDistance(idx, distance + lookAhead);
            map.jumpTo({
                center,
                bearing: bearing(pointAtDistance(idx, from), pointAtDistance(idx, from + headingAhead)),
                pitch,
                zoom,
                // `elevation` travels in the same call: a bare jumpTo() resets it to
                // 0, which drops the camera under the mountain for the whole frame.
                elevation: valueAtDistance(idx, altitudes, distance + lookAhead),
            });
        };

        frame(0);

        let startTime: number | null = null;
        const animate = (timestamp: number) => {
            if (this.aborted) { onEnd?.(); return; }

            startTime ??= timestamp;
            const progress = Math.min((timestamp - startTime) / totalDurationMs, 1);
            const fraction = easedDistanceFraction(progress, EASE_EDGE);
            frame(fraction * idx.total);
            // Reported against the real route: the smoothed path cuts corners, so
            // its own distances would leave the marker short of the finish.
            onProgress?.(fraction * route.total);

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
