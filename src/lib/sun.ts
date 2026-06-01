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
 */

export interface SunPosition {
    azimuth: number;
    elevation: number;
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

/** Convert a SunPosition to a unit direction vector pointing TOWARDS the sun. */
export function sunDirectionVector(pos: SunPosition): [number, number, number] {
    const ce = Math.cos(pos.elevation);
    return [
        ce * Math.sin(pos.azimuth),
        ce * Math.cos(pos.azimuth),
        Math.sin(pos.elevation),
    ];
}

/**
 * Convenience: returns sun direction, a 0..1 intensity that fades in as the
 * sun rises above the horizon, and a warm/neutral RGB tint for the diffuse
 * light. The tint is roughly approximated from elevation:
 *   - high sun  (≥ 25°): neutral white
 *   - low sun   (~  5°): warm yellow
 *   - horizon   (~  0°): deep orange
 *
 * Adequate for stylised hill-shading without a full sky-model.
 */
export function sunLighting(
    date: Date,
    lat: number,
    lng: number,
): {
    dir: [number, number, number];
    intensity: number;
    color: [number, number, number];
    elevationDeg: number;
    azimuthDeg: number;
} {
    const pos = computeSunPosition(date, lat, lng);
    const elDeg = pos.elevation * (180 / Math.PI);
    let intensity = 0;
    if (elDeg >= 6) intensity = 1;
    else if (elDeg > -2) intensity = (elDeg + 2) / 8; // smooth dawn fade

    // Warm → neutral colour ramp keyed on elevation (clamped to 0..25°),
    // smoothstep-interpolated for a softer transition than pure linear.
    const t = Math.max(0, Math.min(1, elDeg / 25));
    const s = t * t * (3 - 2 * t);
    const warmR = 1, warmG = 0.55, warmB = 0.3;
    const neutR = 1, neutG = 0.98, neutB = 0.95;
    const color: [number, number, number] = [
        warmR + (neutR - warmR) * s,
        warmG + (neutG - warmG) * s,
        warmB + (neutB - warmB) * s,
    ];

    return {
        dir: sunDirectionVector(pos),
        intensity,
        color,
        elevationDeg: elDeg,
        azimuthDeg: ((pos.azimuth * (180 / Math.PI)) % 360 + 360) % 360,
    };
}
