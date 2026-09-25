// ─────────────────────────────────────────────────────────────────────────────
// Where the relief cuts the sky, seen from one spot — and when a body crosses it.
//
// The sun-path layer already answers "is this direction hidden?" on the GPU, by
// depth-testing the track against the terrain. That answer stays on the GPU: a
// label needs the crossing as a *number* (a time) and as a *place* (a point on
// the ridge to anchor to), so it has to be solved again on the CPU.
//
// The tool for that is a ray march: walk outwards along one azimuth, and keep
// the relief point with the largest apparent elevation angle. That point IS the
// skyline in that direction. A body is then above the horizon exactly while its
// own elevation exceeds the skyline's, and rise/set are the times when the two
// swap order — the real horizon, the one with mountains in it, not the
// theoretical one.
//
// Cost note: the sampler this takes is meant to be
// `Terrain.getElevationForLngLatZoom`, ~2 µs a call. `Map.queryTerrainElevation`
// returns the same numbers but costs ~141 µs (measured), which would turn a
// single ray into 50 ms and make the whole thing unusable.
// ─────────────────────────────────────────────────────────────────────────────

/** The eye a skyline is computed for. */
export interface SkylineObserver {
    lng: number;
    lat: number;
    /** Metres above sea level. */
    altitudeM: number;
}

/** Ground height in metres at a location; non-finite or 0 where the DEM is blind. */
export type GroundSampler = (lng: number, lat: number) => number;

/** The highest relief in one azimuth, and where it is. */
export interface SkylinePoint {
    /** Its apparent elevation angle above the observer, in degrees. */
    elevationDeg: number;
    distanceM: number;
    lng: number;
    lat: number;
    groundM: number;
}

/** Azimuth + elevation of a celestial body, degrees, same convention as `sun.ts`. */
export interface SkyBodyPosition {
    azimuthDeg: number;
    elevationDeg: number;
}

export interface SkyCrossing {
    kind: 'rise' | 'set';
    /** Minutes since local midnight, fractional. */
    minutesOfDay: number;
    /** The ridge point the body disappears behind — anchors the label. */
    point: SkylinePoint;
}

const DEG = Math.PI / 180;
const METRES_PER_DEG_LAT = 111320;
const EARTH_RADIUS_M = 6371008.8;

/**
 * Standard terrestrial refraction: near the ground a ray bends downwards by
 * about 13 % of the Earth's curvature, which lifts a distant ridge slightly.
 * Worth 5 m of apparent height at 20 km — a tenth of a degree of horizon.
 */
const REFRACTION_K = 0.13;

/**
 * First and last distance probed along a ray, and the ratio between probes.
 * The far end has to reach the true horizon or the march returns the last
 * sample instead of the skyline: from a 3 000 m summit that horizon is 210 km
 * away, and stopping at 80 km would report it 0.8° too low — four minutes of
 * sunset. Past the DEM's coverage the sampler returns sea level, which is the
 * right assumption for an open horizon anyway.
 */
const NEAR_M = 80;
const FAR_M = 200_000;
const STEP_RATIO = 1.02;

/**
 * Below this the body is under any horizon a real viewpoint can have — even from
 * a 4 800 m summit the sea-level horizon only dips 2.2° — so the skyline need
 * not be computed at all. This guard is what keeps a full day's scan under
 * ~100 rays instead of 145.
 */
const HORIZON_FLOOR_DEG = -6;

/** Apparent angle of a ground point, Earth curvature and refraction included. */
export function apparentAngleDeg(observerAltM: number, groundM: number, distanceM: number): number {
    const drop = (distanceM * distanceM * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M);
    return Math.atan2(groundM - observerAltM - drop, distanceM) / DEG;
}

/**
 * Degrees of longitude and latitude per metre walked along one azimuth.
 *
 * The flat local approximation, shared by every consumer on purpose: a sighting
 * that placed a summit with a different projection than the march would land in
 * a neighbouring gully and be declared hidden by relief that is not in its way.
 */
export function rayStep(observer: SkylineObserver, azimuthDeg: number): { perMetreLng: number; perMetreLat: number } {
    const az = azimuthDeg * DEG;
    const cosLat = Math.max(1e-6, Math.cos(observer.lat * DEG));
    return {
        perMetreLat: Math.cos(az) / METRES_PER_DEG_LAT,
        perMetreLng: Math.sin(az) / (METRES_PER_DEG_LAT * cosLat),
    };
}

/** Azimuth (0 = north, 90 = east) and distance of a spot, in the same frame. */
export function sightingFrom(
    observer: SkylineObserver,
    lng: number,
    lat: number,
): { azimuthDeg: number; distanceM: number } {
    const cosLat = Math.max(1e-6, Math.cos(observer.lat * DEG));
    const northM = (lat - observer.lat) * METRES_PER_DEG_LAT;
    const eastM = (lng - observer.lng) * METRES_PER_DEG_LAT * cosLat;
    return {
        azimuthDeg: Math.atan2(eastM, northM) / DEG,
        distanceM: Math.hypot(eastM, northM),
    };
}

/**
 * March outwards along one azimuth and return the relief that stands highest in
 * the sky. Steps grow geometrically: the near ground needs metres of resolution,
 * a ridge 40 km away is drawn from a DEM tile far coarser than the 800 m step
 * it gets there.
 */
export function skylineAt(
    observer: SkylineObserver,
    azimuthDeg: number,
    sample: GroundSampler,
): SkylinePoint {
    const { perMetreLng, perMetreLat } = rayStep(observer, azimuthDeg);

    // Nothing found yet reads as "open sky": a body at any elevation clears it.
    let best: SkylinePoint = {
        elevationDeg: -90,
        distanceM: 0,
        lng: observer.lng,
        lat: observer.lat,
        groundM: observer.altitudeM,
    };
    for (let d = NEAR_M; d <= FAR_M; d *= STEP_RATIO) {
        const lng = observer.lng + perMetreLng * d;
        const lat = observer.lat + perMetreLat * d;
        const groundM = sample(lng, lat);
        if (!Number.isFinite(groundM)) continue;
        const elevationDeg = apparentAngleDeg(observer.altitudeM, groundM, d);
        if (elevationDeg > best.elevationDeg) best = { elevationDeg, distanceM: d, lng, lat, groundM };
    }
    return best;
}

/** How far the body stands above the skyline, in degrees. Negative = hidden. */
function clearanceAt(
    minutesOfDay: number,
    positionAt: (minutesOfDay: number) => SkyBodyPosition,
    skyline: (azimuthDeg: number) => SkylinePoint,
): { clearance: number; point: SkylinePoint | null } {
    const body = positionAt(minutesOfDay);
    if (!Number.isFinite(body.elevationDeg)) return { clearance: Number.NaN, point: null };
    if (body.elevationDeg < HORIZON_FLOOR_DEG) return { clearance: -1, point: null };
    const point = skyline(body.azimuthDeg);
    return { clearance: body.elevationDeg - point.elevationDeg, point };
}

/**
 * Narrow a bracketed sign change down to a fraction of a minute. `hidden` is the
 * end of the bracket where the body is behind the relief, so the loop always
 * knows which half to keep without re-reading a sign.
 */
function bisect(
    visible: number,
    hidden: number,
    positionAt: (minutesOfDay: number) => SkyBodyPosition,
    skyline: (azimuthDeg: number) => SkylinePoint,
): { minutesOfDay: number; point: SkylinePoint } | null {
    let seen = visible;
    let blocked = hidden;
    for (let i = 0; i < 12; i++) {
        const t = (seen + blocked) / 2;
        const { clearance } = clearanceAt(t, positionAt, skyline);
        if (!Number.isFinite(clearance)) return null;
        if (clearance >= 0) seen = t; else blocked = t;
    }
    // Sample the ridge just inside the hidden side: that is the relief the body
    // actually goes behind, and the label has to sit on it.
    const point = clearanceAt(blocked, positionAt, skyline).point;
    return point ? { minutesOfDay: (seen + blocked) / 2, point } : null;
}

/** Consecutive coarse samples that straddle the skyline, i.e. bracket a crossing. */
interface CrossingBracket {
    /** The end of the bracket where the body is out. */
    visible: number;
    /** The end where it is behind the relief. */
    hidden: number;
    /** True when the body is coming out, i.e. the bracket is a rise. */
    up: boolean;
}

function scanBrackets(
    positionAt: (minutesOfDay: number) => SkyBodyPosition,
    skyline: (azimuthDeg: number) => SkylinePoint,
    step: number,
): CrossingBracket[] {
    const out: CrossingBracket[] = [];
    let prevT = 0;
    let prevClear = clearanceAt(0, positionAt, skyline).clearance;
    for (let t = step; t <= 1440; t += step) {
        const { clearance } = clearanceAt(t, positionAt, skyline);
        const usable = Number.isFinite(prevClear) && Number.isFinite(clearance);
        if (usable && (prevClear >= 0) !== (clearance >= 0)) {
            const up = clearance >= 0;
            out.push({ visible: up ? t : prevT, hidden: up ? prevT : t, up });
        }
        prevT = t;
        prevClear = clearance;
    }
    return out;
}

/**
 * Scan a local day and return when the body clears the relief and when it goes
 * back behind it. A jagged ridge can be crossed many times; only the **first**
 * rise and the **last** set are kept, which is what a photographer reads as
 * "the sun is out from X to Y here".
 */
export function findSkyCrossings(
    positionAt: (minutesOfDay: number) => SkyBodyPosition,
    skyline: (azimuthDeg: number) => SkylinePoint,
    coarseStepMinutes = 10,
): { rise: SkyCrossing | null; set: SkyCrossing | null } {
    let rise: SkyCrossing | null = null;
    let set: SkyCrossing | null = null;
    for (const bracket of scanBrackets(positionAt, skyline, Math.max(1, coarseStepMinutes))) {
        const found = bisect(bracket.visible, bracket.hidden, positionAt, skyline);
        if (!found) continue;
        if (bracket.up) rise ??= { kind: 'rise', ...found };
        else set = { kind: 'set', ...found };
    }
    return { rise, set };
}

/** "HH:MM" from minutes since local midnight. */
export function formatCrossingTime(minutesOfDay: number): string {
    const total = Math.round(minutesOfDay) % 1440;
    const h = String(Math.floor(total / 60)).padStart(2, '0');
    const m = String(total % 60).padStart(2, '0');
    return `${h}:${m}`;
}
