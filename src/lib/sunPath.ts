/**
 * The sun's track across the sky for one day, turned into GPU-ready geometry.
 *
 * Everything here is expressed as **unit direction vectors** in the same ENU
 * frame as the rest of the render (x=east, y=north, z=up). A direction is all
 * the sun needs: it sits at infinity, so every point of the ray leaving the eye
 * along that direction projects to the same pixel, and the drawing is
 * independent of where the camera stands.
 *
 * The polylines are pre-expanded into screen-facing quads (two triangles per
 * segment) because `gl.lineWidth` is clamped to 1 px on virtually every
 * desktop GL driver, which would give a hairline on a HiDPI canvas. The vertex
 * shader finishes the job: it projects both endpoints, then offsets by the 2D
 * normal in pixels.
 */

import { apparentSunPosition, sunDirectionVector } from '@/lib/sun';

/** Mean angular RADIUS of the solar disc, in degrees (the disc spans 0.53°). */
export const SUN_ANGULAR_RADIUS_DEG = 0.2665;

/** Floats per vertex in the geometry produced here — see {@link SUN_PATH_STRIDE}. */
export const SUN_PATH_FLOATS_PER_VERTEX = 9;

/** Byte stride of one vertex: dirA(3) + dirB(3) + at(1) + side(1) + arc(1). */
export const SUN_PATH_STRIDE = SUN_PATH_FLOATS_PER_VERTEX * 4;

export interface SunPathSample {
    /** Minutes since local midnight. */
    minutesOfDay: number;
    /** Degrees from north, clockwise. */
    azimuthDeg: number;
    /** APPARENT degrees above the horizon (refraction included). */
    elevationDeg: number;
    /** Unit ENU direction towards the sun. */
    dir: [number, number, number];
}

export interface SunPathGeometry {
    /** Interleaved vertices for the day track. */
    track: Float32Array;
    /** Interleaved vertices for the whole-hour tick marks. */
    ticks: Float32Array;
    /** The samples the track was built from, in chronological order. */
    samples: SunPathSample[];
}

/** Half-length of an hour tick, in degrees of elevation. */
const TICK_HALF_DEG = 0.45;
/** Whole hours that get a longer tick, to stay readable at a glance. */
const MAJOR_TICK_HOURS = 3;
const MAJOR_TICK_FACTOR = 2.2;

const DEG = Math.PI / 180;

function directionAt(datePart: string, minutesOfDay: number, lat: number, lng: number): SunPathSample {
    const h = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const m = String(minutesOfDay % 60).padStart(2, '0');
    // Naive local string, exactly like `lidarSunDate`: the hour the user reads
    // on the slider is the hour the sun is computed for.
    const pos = apparentSunPosition(new Date(`${datePart}T${h}:${m}`), lat, lng);
    return {
        minutesOfDay,
        azimuthDeg: ((pos.azimuth / DEG) % 360 + 360) % 360,
        elevationDeg: pos.elevation / DEG,
        dir: sunDirectionVector(pos),
    };
}

/**
 * Sample the sun's apparent position over a whole local day.
 *
 * @param datePart - "YYYY-MM-DD".
 * @param stepMinutes - Sampling interval; 6 min keeps the curve smooth to well
 * under a pixel at any reachable field of view.
 */
export function sampleSunPath(
    datePart: string,
    lat: number,
    lng: number,
    stepMinutes = 6,
): SunPathSample[] {
    if (!datePart || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const step = Math.max(1, Math.round(stepMinutes));
    const out: SunPathSample[] = [];
    for (let t = 0; t <= 1440; t += step) {
        const sample = directionAt(datePart, Math.min(t, 1439), lat, lng);
        if (!Number.isFinite(sample.elevationDeg)) return [];
        // The last sample is midnight of the NEXT day; forcing it to 1440
        // closes the loop visually without a second date string.
        out.push(t >= 1440 ? { ...sample, minutesOfDay: 1440 } : sample);
    }
    return out;
}

/** Push one screen-facing quad (6 vertices) for the segment a→b. */
function pushSegment(
    out: number[],
    a: readonly number[],
    b: readonly number[],
    arcA: number,
    arcB: number,
): void {
    // at, side pairs for the two triangles of the quad.
    const corners: [number, number][] = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
    for (const [at, side] of corners) {
        out.push(a[0], a[1], a[2], b[0], b[1], b[2], at, side, at === 0 ? arcA : arcB);
    }
}

/** Angular separation between two unit vectors, in degrees. */
function angleBetweenDeg(a: readonly number[], b: readonly number[]): number {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return Math.acos(dot) / DEG;
}

/** Direction at the given azimuth/elevation, in degrees. */
function dirAt(azimuthDeg: number, elevationDeg: number): [number, number, number] {
    return sunDirectionVector({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG });
}

function buildTicks(samples: SunPathSample[]): Float32Array {
    const out: number[] = [];
    for (const s of samples) {
        if (s.minutesOfDay % 60 !== 0 || s.minutesOfDay >= 1440) continue;
        const hour = s.minutesOfDay / 60;
        const half = TICK_HALF_DEG * (hour % MAJOR_TICK_HOURS === 0 ? MAJOR_TICK_FACTOR : 1);
        // A tick runs along the local vertical, which reads as upright whatever
        // the camera roll — and never overlaps the track it marks.
        pushSegment(
            out,
            dirAt(s.azimuthDeg, s.elevationDeg - half),
            dirAt(s.azimuthDeg, s.elevationDeg + half),
            0,
            0,
        );
    }
    return new Float32Array(out);
}

/**
 * Turn a day of samples into the interleaved vertex buffers the sun-path shader
 * consumes. `arc` accumulates the angular distance walked along the track so the
 * fragment shader can dash it at a constant angular period.
 */
export function buildSunPathGeometry(samples: SunPathSample[]): SunPathGeometry {
    if (samples.length < 2) {
        return { track: new Float32Array(0), ticks: new Float32Array(0), samples };
    }
    const out: number[] = [];
    let arc = 0;
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i].dir;
        const b = samples[i + 1].dir;
        const next = arc + angleBetweenDeg(a, b);
        pushSegment(out, a, b, arc, next);
        arc = next;
    }
    return { track: new Float32Array(out), ticks: buildTicks(samples), samples };
}
