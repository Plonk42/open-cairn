/**
 * Solar position from civil date/time + geographic coordinates.
 *
 * Uses a low-precision NOAA-style approximation (sufficient for hill-shading
 * — errors are on the order of a few arc-minutes for the next ~50 years).
 *
 * Conventions:
 *   - azimuth: radians, measured from NORTH clockwise (east positive).
 *   - elevation: radians above the horizon (negative = below = night).
 *   - direction vector: right-handed (x=east, y=north, z=up), unit length.
 *
 * `computeSunPosition` returns the GEOMETRIC (unrefracted) position; the
 * atmospheric lift is added by `sunSettingsAt` — see `atmosphericRefractionDeg`.
 */

export interface SunPosition {
    azimuth: number;
    elevation: number;
}

// ───────────────────────────────────────────────────────────────────────
// Naive sun-date string helpers
//
// The UI stores the sun date/time as a naive local wall-clock string
// ("YYYY-MM-DDTHH:mm") so it round-trips through <input type="date"> and
// localStorage without timezone drift. These helpers convert between that
// string and its numeric working unit — minutes-of-day — so callers do plain
// arithmetic instead of ad-hoc string surgery.
// ───────────────────────────────────────────────────────────────────────

/** Today's local date as "YYYY-MM-DD". */
export function todaySunDatePart(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a naive "YYYY-MM-DDTHH:mm" sun-date string into its date part and
 * minutes-of-day. Missing/invalid time defaults to noon (720).
 */
export function parseSunDate(value: string): { datePart: string; minutesOfDay: number } {
    const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? '';
    const timeMatch = /T(\d{2}):(\d{2})/.exec(value);
    const minutesOfDay = timeMatch
        ? Math.min(1439, Math.max(0, Number(timeMatch[1]) * 60 + Number(timeMatch[2])))
        : 12 * 60;
    return { datePart, minutesOfDay };
}

/**
 * Format a date part + minutes-of-day back into a naive "YYYY-MM-DDTHH:mm"
 * sun-date string. Falls back to today's local date when `datePart` is empty.
 */
export function formatSunDate(datePart: string, minutesOfDay: number): string {
    const base = datePart || todaySunDatePart();
    const h = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const m = String(minutesOfDay % 60).padStart(2, '0');
    return `${base}T${h}:${m}`;
}

export function computeSunPosition(date: Date, lat: number, lng: number): SunPosition {
    const rad = Math.PI / 180;
    // Julian day (UTC)
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545;

    const Ldeg = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
    const g = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * rad;
    const lambda = (Ldeg + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const epsilon = (23.439 - 0.0000004 * n) * rad;

    const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
    const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

    // Greenwich mean sidereal time → local sidereal time
    const gmstHours = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
    const lst = (gmstHours * 15 + lng) * rad;
    const H = lst - ra;

    const phi = lat * rad;
    const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));

    // Azimuth from north, clockwise (east positive)
    const azimuth = Math.atan2(
        -Math.cos(decl) * Math.sin(H),
        Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.sin(phi) * Math.cos(H),
    );

    return { azimuth, elevation };
}

/**
 * Below this true altitude the sun is out of sight and Saemundsson's fit breaks
 * down (its denominator turns over near −4.5° and the correction collapses to
 * zero), so the refraction is frozen at its −1° value — continuous, monotonic,
 * and visually irrelevant since nothing is lit down there anyway.
 */
const REFRACTION_FLOOR_DEG = -1;

/**
 * Atmospheric refraction in degrees, to ADD to a geometric altitude to get the
 * apparent (observed) one. Saemundsson's formula as given by Meeus, *Astronomical
 * Algorithms* 16.4 — the reciprocal of Bennett's, and the one that takes the
 * TRUE altitude, which is exactly what `computeSunPosition` produces:
 *
 *     R = 1.02 / tan(h + 10.3 / (h + 5.11))   [arc-minutes, h in degrees]
 *
 * Worth 0.48° (≈ 1.8 solar radii, ≈ 3 min of time) at the horizon, 0.09° at 10°,
 * 0.02° at 45°. Standard atmosphere (1010 hPa, 10 °C); no pressure/temperature
 * term, which would move the result by a few arc-seconds at most.
 */
export function atmosphericRefractionDeg(trueElevationDeg: number): number {
    const h = Math.max(trueElevationDeg, REFRACTION_FLOOR_DEG);
    const arcMinutes = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * (Math.PI / 180));
    // The fit undershoots to ≈ −0.05″ near the zenith; clamp so refraction never
    // pushes the sun DOWN.
    return Math.max(0, arcMinutes / 60);
}

/** Convert a SunPosition to a unit direction vector pointing TOWARDS the sun. */
export function sunDirectionVector(pos: SunPosition): [number, number, number] {
    const ce = Math.cos(pos.elevation);
    return [
        ce * Math.sin(pos.azimuth),
        ce * Math.cos(pos.azimuth),
        Math.sin(pos.elevation),
    ];
}

// ───────────────────────────────────────────────────────────────────────
// Sun settings — the four knobs the whole render is lit from
//
// A civil date/time + a location boil down to exactly four numbers. Storing
// THOSE (rather than the date) as the render's source of truth is what lets
// the user force a light that no real sun would ever produce: the date/time
// picker writes the four, and any of them can then be overridden by hand.
// ───────────────────────────────────────────────────────────────────────

export interface SunSettings {
    /** Degrees from north, clockwise (east positive). */
    azimuthDeg: number;
    /** APPARENT degrees above the horizon (refraction included); negative = below = night. */
    elevationDeg: number;
    /** Colour ramp position: 0 = deep orange grazing light, 1 = neutral white. */
    warmth: number;
    /** Direct-light strength: 0 = night (no directional light), 1 = full daylight. */
    intensity: number;
}

/** Direction + tint the shaders and the sky model actually consume. */
export interface SunLight {
    dir: [number, number, number];
    intensity: number;
    color: [number, number, number];
}

/** Neutral high sun — the light before any date/time has driven the settings. */
export const DEFAULT_SUN_SETTINGS: SunSettings = {
    azimuthDeg: 150,
    elevationDeg: 45,
    warmth: 1,
    intensity: 1,
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Daylight ramp: full sun from 6° up, fading out to nothing at −2°. */
export function sunIntensityAt(elevationDeg: number): number {
    if (elevationDeg >= 6) return 1;
    if (elevationDeg > -2) return (elevationDeg + 2) / 8; // smooth dawn fade
    return 0;
}

/**
 * Warm → neutral ramp keyed on elevation (clamped to 0..25°), smoothstep-
 * interpolated for a softer transition than pure linear.
 */
export function sunWarmthAt(elevationDeg: number): number {
    const t = clamp01(elevationDeg / 25);
    return t * t * (3 - 2 * t);
}

/** The real sun's settings for a civil date/time at a given location. */
export function sunSettingsAt(date: Date, lat: number, lng: number): SunSettings {
    const pos = computeSunPosition(date, lat, lng);
    const trueElevationDeg = pos.elevation * (180 / Math.PI);
    // Apparent, not geometric: the whole point is to show where the sun IS seen,
    // so that the drawn disc, the light and the readout agree with the sky.
    const elevationDeg = trueElevationDeg + atmosphericRefractionDeg(trueElevationDeg);
    return {
        azimuthDeg: ((pos.azimuth * (180 / Math.PI)) % 360 + 360) % 360,
        elevationDeg,
        warmth: sunWarmthAt(elevationDeg),
        intensity: sunIntensityAt(elevationDeg),
    };
}

/**
 * Turn sun settings into a direction vector and an RGB tint. The tint lerps
 * deep orange → neutral white along `warmth`:
 *   - warmth 1: neutral white (high sun)
 *   - warmth ~0.2: warm yellow (low sun)
 *   - warmth 0: deep orange (horizon)
 *
 * Adequate for stylised hill-shading without a full sky-model.
 */
export function sunLight(s: SunSettings): SunLight {
    const rad = Math.PI / 180;
    const w = clamp01(s.warmth);
    const warm = [1, 0.55, 0.3];
    const neutral = [1, 0.98, 0.95];
    return {
        dir: sunDirectionVector({ azimuth: s.azimuthDeg * rad, elevation: s.elevationDeg * rad }),
        intensity: clamp01(s.intensity),
        color: [
            warm[0] + (neutral[0] - warm[0]) * w,
            warm[1] + (neutral[1] - warm[1]) * w,
            warm[2] + (neutral[2] - warm[2]) * w,
        ],
    };
}
