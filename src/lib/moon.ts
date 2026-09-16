/**
 * Lunar position and phase.
 *
 * The moon cannot be done the way the sun is. A five-term series puts the sun
 * within an arc-minute for fifty years; the moon's orbit is perturbed enough by
 * the sun that the same effort would be off by several degrees — more than ten
 * lunar diameters, which is visible as a track drawn through the wrong pass.
 * So this is Meeus, *Astronomical Algorithms* chapter 47, truncated to the
 * terms worth more than about 0.002°: 33 for the longitude, 20 for the
 * latitude. That holds the geocentric position to a few arc-minutes, which is
 * under a third of the lunar disc.
 *
 * Two corrections matter here that do not for the sun:
 *
 *   - **parallax**. The moon is only 60 Earth radii away, so an observer on the
 *     surface sees it up to 0.95° lower than a geocentric ephemeris says —
 *     nearly two lunar diameters, some 2 minutes of time on a moonrise. It is
 *     applied; without it the disc would visibly miss the ridge it is drawn
 *     against.
 *   - **phase**. A full white disc for a three-day crescent would be a lie, and
 *     the crescent's orientation is what tells you where the sun is.
 *
 * `date.getTime()` is UTC, while the series wants Dynamical Time. The
 * difference (ΔT ≈ 70 s) moves the moon by about 35″ — a tenth of its radius,
 * so it is ignored.
 */

import {
    atmosphericRefractionDeg,
    daysSinceJ2000,
    horizontalFromEquatorial,
    meanObliquity,
    sunEquatorial,
    type EquatorialPosition,
    type SunPosition,
} from '@/lib/sun';

const DEG = Math.PI / 180;

/** Equatorial radius of the Earth, km — the baseline of the parallax. */
const EARTH_RADIUS_KM = 6378.14;
/** Mean radius of the moon, km. */
const MOON_RADIUS_KM = 1737.4;

/**
 * Periodic terms for the moon's longitude and distance (Meeus table 47.A):
 * `[D, M, M', F, Σl (1e-6 °), Σr (1e-3 km)]`.
 */
const LONGITUDE_TERMS: readonly (readonly number[])[] = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751],
    [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950],
    [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0],
    [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0],
    [3, 0, -1, 0, -892, 3258],
    [0, 0, 2, -2, -381, -4421],
    [2, 0, -1, -2, 0, 8752],
];

/** Periodic terms for the moon's latitude (Meeus table 47.B): `[D, M, M', F, Σb]`. */
const LATITUDE_TERMS: readonly (readonly number[])[] = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
    [4, 0, 0, -1, 1021],
    [4, 0, -1, 1, 833],
];

interface LunarArguments {
    /** Moon's mean longitude, degrees. */
    Lp: number;
    /** Mean elongation, radians. */
    D: number;
    /** Sun's mean anomaly, radians. */
    M: number;
    /** Moon's mean anomaly, radians. */
    Mp: number;
    /** Argument of latitude, radians. */
    F: number;
    A1: number;
    A2: number;
    A3: number;
    /** Eccentricity factor, applied once per power of the sun's anomaly. */
    E: number;
}

function lunarArguments(T: number): LunarArguments {
    const poly = (...c: number[]) => c.reduce((acc, coef, i) => acc + coef * T ** i, 0);
    return {
        Lp: poly(218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000),
        D: poly(297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000) * DEG,
        M: poly(357.5291092, 35999.0502909, -0.0001536, 1 / 24490000) * DEG,
        Mp: poly(134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000) * DEG,
        F: poly(93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000) * DEG,
        A1: (119.75 + 131.849 * T) * DEG,
        A2: (53.09 + 479264.29 * T) * DEG,
        A3: (313.45 + 481266.484 * T) * DEG,
        E: 1 - 0.002516 * T - 0.0000074 * T * T,
    };
}

export interface MoonEcliptic {
    /** Apparent geocentric ecliptic longitude, degrees. */
    longitudeDeg: number;
    /** Geocentric ecliptic latitude, degrees. */
    latitudeDeg: number;
    /** Distance between the centres of the Earth and the moon, km. */
    distanceKm: number;
}

/** Geocentric ecliptic position of the moon — Meeus 47. */
export function moonEcliptic(date: Date): MoonEcliptic {
    const T = daysSinceJ2000(date) / 36525;
    const a = lunarArguments(T);

    let sumL = 0;
    let sumR = 0;
    for (const [d, m, mp, f, cl, cr] of LONGITUDE_TERMS) {
        const arg = d * a.D + m * a.M + mp * a.Mp + f * a.F;
        // Terms in the sun's anomaly shrink with the Earth's eccentricity.
        const e = a.E ** Math.abs(m);
        sumL += cl * e * Math.sin(arg);
        sumR += cr * e * Math.cos(arg);
    }
    let sumB = 0;
    for (const [d, m, mp, f, cb] of LATITUDE_TERMS) {
        sumB += cb * a.E ** Math.abs(m) * Math.sin(d * a.D + m * a.M + mp * a.Mp + f * a.F);
    }

    // Additive terms: Venus (A1), Jupiter (A2) and the flattening of the Earth.
    const LpRad = a.Lp * DEG;
    sumL += 3958 * Math.sin(a.A1) + 1962 * Math.sin(LpRad - a.F) + 318 * Math.sin(a.A2);
    sumB += -2235 * Math.sin(LpRad)
        + 382 * Math.sin(a.A3)
        + 175 * Math.sin(a.A1 - a.F)
        + 175 * Math.sin(a.A1 + a.F)
        + 127 * Math.sin(LpRad - a.Mp)
        - 115 * Math.sin(LpRad + a.Mp);

    return {
        longitudeDeg: ((a.Lp + sumL / 1e6) % 360 + 360) % 360,
        latitudeDeg: sumB / 1e6,
        distanceKm: 385000.56 + sumR / 1000,
    };
}

/** Geocentric equatorial position of the moon. */
export function moonEquatorial(date: Date): EquatorialPosition {
    const { longitudeDeg, latitudeDeg, distanceKm } = moonEcliptic(date);
    const eps = meanObliquity(daysSinceJ2000(date));
    const lambda = longitudeDeg * DEG;
    const beta = latitudeDeg * DEG;
    return {
        ra: Math.atan2(
            Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
            Math.cos(lambda),
        ),
        dec: Math.asin(
            Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda),
        ),
        distanceKm,
    };
}

export interface MoonState {
    /** Where the moon is SEEN: topocentric, refraction included. */
    position: SunPosition;
    /** Apparent angular RADIUS, degrees. */
    angularRadiusDeg: number;
    /** Illuminated fraction of the disc, 0 (new) to 1 (full). */
    illuminatedFraction: number;
    distanceKm: number;
}

/**
 * Everything the render needs about the moon at one instant.
 *
 * The parallax is applied as `h' = h − π·cos h`, the first-order form: it drops
 * the observer's altitude above the ellipsoid and the (tiny) azimuth shift,
 * both worth far less than the few arc-minutes the truncated series already
 * costs.
 */
export function moonState(date: Date, lat: number, lng: number): MoonState {
    const eq = moonEquatorial(date);
    const geocentric = horizontalFromEquatorial(eq, date, lat, lng);

    const parallaxDeg = Math.asin(EARTH_RADIUS_KM / eq.distanceKm) / DEG;
    const trueDeg = geocentric.elevation / DEG - parallaxDeg * Math.cos(geocentric.elevation);

    return {
        position: {
            azimuth: geocentric.azimuth,
            elevation: (trueDeg + atmosphericRefractionDeg(trueDeg)) * DEG,
        },
        angularRadiusDeg: Math.asin(MOON_RADIUS_KM / eq.distanceKm) / DEG,
        illuminatedFraction: illuminatedFraction(date, eq),
        distanceKm: eq.distanceKm,
    };
}

/**
 * Fraction of the lunar disc that is lit — Meeus 48.
 *
 * The phase angle `i` is the Sun–Moon–Earth angle, obtained from the elongation
 * `ψ` by solving the triangle; `k = (1 + cos i) / 2` is then the fraction of the
 * disc's *area* that is lit, which is also what the projected terminator cuts.
 */
function illuminatedFraction(date: Date, moon: EquatorialPosition): number {
    const sun = sunEquatorial(date);
    const cosPsi = Math.sin(sun.dec) * Math.sin(moon.dec)
        + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra);
    const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
    const i = Math.atan2(
        sun.distanceKm * Math.sin(psi),
        moon.distanceKm - sun.distanceKm * cosPsi,
    );
    return (1 + Math.cos(i)) / 2;
}

/**
 * Unit direction, perpendicular to `moonDir`, pointing at the lit limb.
 *
 * Meeus gives the bright limb's position angle from the celestial north pole,
 * which would then need the parallactic angle to be usable on screen. The
 * component of the sun's direction perpendicular to the moon's is the same
 * thing, already in the frame the billboard is drawn in.
 */
export function brightLimbDirection(
    moonDir: readonly number[],
    sunDir: readonly number[],
): [number, number, number] {
    const dot = sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2];
    const p: [number, number, number] = [
        sunDir[0] - dot * moonDir[0],
        sunDir[1] - dot * moonDir[1],
        sunDir[2] - dot * moonDir[2],
    ];
    const len = Math.hypot(p[0], p[1], p[2]);
    // Exactly full or exactly new: any limb will do, nothing is carved.
    if (len < 1e-9) return [0, 0, 1];
    return [p[0] / len, p[1] / len, p[2] / len];
}
