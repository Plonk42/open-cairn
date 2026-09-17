/**
 * A sky body's track across the sky for one day, turned into GPU-ready
 * geometry — the sun's, the moon's, anything with an apparent position.
 *
 * Everything here is expressed as **unit direction vectors** in the same ENU
 * frame as the rest of the render (x=east, y=north, z=up). A direction is all
 * such a body needs: it sits at infinity, so every point of the ray leaving the
 * eye along that direction projects to the same pixel, and the drawing is
 * independent of where the camera stands.
 *
 * The polylines are pre-expanded into screen-facing quads (two triangles per
 * segment) because `gl.lineWidth` is clamped to 1 px on virtually every
 * desktop GL driver, which would give a hairline on a HiDPI canvas. The vertex
 * shader finishes the job: it projects both endpoints, then offsets by the 2D
 * normal in pixels.
 */

import { moonState } from '@/lib/moon';
import { apparentSunPosition, sunDirectionVector } from '@/lib/sun';

/** Mean angular RADIUS of the solar disc, in degrees (the disc spans 0.53°). */
export const SUN_ANGULAR_RADIUS_DEG = 0.2665;

/** Floats per vertex in the geometry produced here — see {@link SKY_PATH_STRIDE}. */
export const SKY_PATH_FLOATS_PER_VERTEX = 9;

/** Byte stride of one vertex: dirA(3) + dirB(3) + at(1) + side(1) + arc(1). */
export const SKY_PATH_STRIDE = SKY_PATH_FLOATS_PER_VERTEX * 4;

type Vec3 = [number, number, number];

export interface SkyPathSample {
    /** Minutes since local midnight. */
    minutesOfDay: number;
    /** Degrees from north, clockwise. */
    azimuthDeg: number;
    /** APPARENT degrees above the horizon (refraction included). */
    elevationDeg: number;
    /** Unit ENU direction towards the body. */
    dir: Vec3;
}

/** A body's apparent position at one instant, fractional minutes allowed. */
export type SkySampleAt = (minutesOfDay: number) => SkyPathSample;

/** One whole-hour graduation across the track. */
export interface SkyPathTick {
    /** Minutes since local midnight — always a whole hour. */
    minutesOfDay: number;
    /** APPARENT elevation of the body at that hour, in degrees. */
    elevationDeg: number;
    /** The tick's two ends, as unit ENU directions. */
    ends: readonly [Vec3, Vec3];
}

export interface SkyPathGeometry {
    /** Interleaved vertices for the day track. */
    track: Float32Array;
    /** Interleaved vertices for the whole-hour tick marks. */
    ticks: Float32Array;
    /** The samples the track was built from, in chronological order. */
    samples: SkyPathSample[];
}

/** Half-length of an hour tick, in degrees of arc — a minor tick is about one solar diameter. */
const TICK_HALF_DEG = 0.25;
/** Whole hours that get a longer tick, to stay readable at a glance. */
const MAJOR_TICK_HOURS = 3;
const MAJOR_TICK_FACTOR = 2;

const DEG = Math.PI / 180;

/**
 * Split fractional minutes-of-day into the `HH:MM:SS` a naive local date string
 * wants. Seconds matter: the horizon-crossing solver bisects on time and would
 * otherwise quantise every rise and set onto the minute grid it started from.
 */
export function clockParts(minutesOfDay: number): { h: string; m: string; s: string } {
    const clamped = Math.max(0, Math.min(1439.999, minutesOfDay));
    return {
        h: String(Math.floor(clamped / 60)).padStart(2, '0'),
        m: String(Math.floor(clamped) % 60).padStart(2, '0'),
        s: String(Math.floor((clamped % 1) * 60)).padStart(2, '0'),
    };
}

/**
 * The sun's apparent position at one instant of a local day.
 *
 * @param datePart - "YYYY-MM-DD".
 * @param minutesOfDay - Minutes since local midnight, fractional allowed.
 */
export function sunSampleAt(
    datePart: string,
    minutesOfDay: number,
    lat: number,
    lng: number,
): SkyPathSample {
    const { h, m, s } = clockParts(minutesOfDay);
    // Naive local string, exactly like `lidarSunDate`: the hour the user reads
    // on the slider is the hour the sun is computed for.
    const pos = apparentSunPosition(new Date(`${datePart}T${h}:${m}:${s}`), lat, lng);
    return {
        minutesOfDay,
        azimuthDeg: ((pos.azimuth / DEG) % 360 + 360) % 360,
        elevationDeg: pos.elevation / DEG,
        dir: sunDirectionVector(pos),
    };
}

/**
 * Sample a body's apparent position over a whole local day.
 *
 * @param sampleAt - The body's position at a given minute of the day.
 * @param stepMinutes - Sampling interval; 6 min keeps the sun's curve smooth to
 * well under a pixel at any reachable field of view.
 */
export function sampleSkyPath(sampleAt: SkySampleAt, stepMinutes = 6): SkyPathSample[] {
    const step = Math.max(1, Math.round(stepMinutes));
    const out: SkyPathSample[] = [];
    for (let t = 0; t <= 1440; t += step) {
        const sample = sampleAt(Math.min(t, 1439));
        if (!Number.isFinite(sample.elevationDeg)) return [];
        // The last sample is midnight of the NEXT day; forcing it to 1440
        // closes the loop visually without a second date string.
        out.push(t >= 1440 ? { ...sample, minutesOfDay: 1440 } : sample);
    }
    return out;
}

/**
 * The moon's apparent position at one instant of a local day.
 *
 * Same shape as {@link sunSampleAt}, so both bodies feed the same geometry
 * builder and the same horizon solver.
 */
export function moonSampleAt(
    datePart: string,
    minutesOfDay: number,
    lat: number,
    lng: number,
): SkyPathSample {
    const { h, m, s } = clockParts(minutesOfDay);
    const { position } = moonState(new Date(`${datePart}T${h}:${m}:${s}`), lat, lng);
    return {
        minutesOfDay,
        azimuthDeg: ((position.azimuth / DEG) % 360 + 360) % 360,
        elevationDeg: position.elevation / DEG,
        dir: sunDirectionVector(position),
    };
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

function normalize(v: Vec3): Vec3 {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len < 1e-12 ? [0, 0, 1] : [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

/**
 * Unit direction across the track at `samples[i]`, in the sky's tangent plane
 * there. Built from the chord between the two neighbouring samples, with its
 * radial part removed: what is left is the track's tangent, and its cross
 * product with the direction is the normal the tick is drawn along.
 */
function acrossTrack(samples: SkyPathSample[], i: number): Vec3 {
    const dir = samples[i].dir;
    const prev = samples[Math.max(0, i - 1)].dir;
    const next = samples[Math.min(samples.length - 1, i + 1)].dir;
    const chord: Vec3 = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
    const along = chord[0] * dir[0] + chord[1] * dir[1] + chord[2] * dir[2];
    const tangent = normalize([
        chord[0] - along * dir[0],
        chord[1] - along * dir[1],
        chord[2] - along * dir[2],
    ]);
    return normalize(cross(dir, tangent));
}

/**
 * The whole-hour graduations of a sampled day.
 *
 * Each tick crosses the track at a right angle: a tick along the local vertical
 * reads as a stray mark wherever the track is steep — near rise and set, and
 * everywhere at all in winter.
 */
export function hourTicks(samples: SkyPathSample[]): SkyPathTick[] {
    const out: SkyPathTick[] = [];
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.minutesOfDay % 60 !== 0 || s.minutesOfDay >= 1440) continue;
        const hour = s.minutesOfDay / 60;
        const half = TICK_HALF_DEG * (hour % MAJOR_TICK_HOURS === 0 ? MAJOR_TICK_FACTOR : 1) * DEG;
        const across = acrossTrack(samples, i);
        // Rotation of `dir` by ±half in the (dir, across) plane: the ends stay
        // unit vectors, which the projection at infinity relies on.
        const c = Math.cos(half);
        const sn = Math.sin(half);
        const end = (sign: number): Vec3 => [
            c * s.dir[0] + sign * sn * across[0],
            c * s.dir[1] + sign * sn * across[1],
            c * s.dir[2] + sign * sn * across[2],
        ];
        out.push({ minutesOfDay: s.minutesOfDay, elevationDeg: s.elevationDeg, ends: [end(-1), end(1)] });
    }
    return out;
}

function buildTicks(samples: SkyPathSample[]): Float32Array {
    const out: number[] = [];
    for (const tick of hourTicks(samples)) pushSegment(out, tick.ends[0], tick.ends[1], 0, 0);
    return new Float32Array(out);
}

/**
 * Turn a day of samples into the interleaved vertex buffers the sky-path shader
 * consumes. `arc` accumulates the angular distance walked along the track so the
 * fragment shader can dash it at a constant angular period.
 */
export function buildSkyPathGeometry(samples: SkyPathSample[]): SkyPathGeometry {
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
