/**
 * Lighting environment for the "photorealistic" LiDAR render path.
 *
 * The reference alpine renders we benchmark against (Unreal Engine, see
 * `docs/LIDAR_RENDERING.md`) owe almost none of their quality to geometry and
 * almost all of it to *how light is described*:
 *
 *   1. shading happens in **linear** radiance, not in sRGB display values;
 *   2. ambient light is **hemispheric** — a cold blue sky above, a warmer
 *      bounce from the ground below — instead of a flat grey constant. This is
 *      what makes snow in shadow read blue rather than dirty grey, the single
 *      most recognisable trait of a real mountain photograph;
 *   3. the direct sun is several times brighter than the ambient, and the
 *      resulting over-range values are **tone-mapped** instead of clipped.
 *
 * This module owns step 2's colours (plus the sun radiance and the aerial
 * perspective tint) so they can be unit-tested and tuned without a GPU. All
 * values it returns are **linear** radiances, ready to be uploaded as-is; the
 * conversion to display sRGB happens once, at the end of the fragment shader.
 */

/** Linear-space lighting environment uploaded to the point/mesh shaders. */
export interface LidarAtmosphere {
    /** Ambient radiance received by an up-facing normal (the sky dome). */
    sky: [number, number, number];
    /** Ambient radiance received by a down-facing normal (ground bounce). */
    bounce: [number, number, number];
    /** Inscattering colour of the aerial perspective / distance haze. */
    haze: [number, number, number];
    /** Radiance of the direct (sun or neutral key) light. */
    sun: [number, number, number];
}

export interface AtmosphereParams {
    /** Sun direction, east/north/up; only the `up` component is used here. */
    sunDir: readonly [number, number, number];
    /** Sun tint from {@link import('./sun').sunLighting} (0..1 per channel). */
    sunColor: readonly [number, number, number];
    /** 0 at night, 1 in full daylight. */
    sunIntensity: number;
    /** 0 = real sun lighting, 1 = neutral fixed-direction "flat" lighting. */
    flat: number;
    /** User multiplier on the ambient term (1 = nominal). */
    ambient: number;
    /** User multiplier on the direct term (1 = nominal ≈ 3× the ambient). */
    sunStrength: number;
}

// Clear-sky zenith radiance, high sun. Deliberately saturated: it is what
// tints shadowed snow blue once the (much brighter) sun term is absent.
// Its *luminance* (≈ 0.27) is the anchor of the whole calibration — see the
// note above `SUN_BASE`.
const SKY_DAY: readonly [number, number, number] = [0.19, 0.27, 0.46];
// Twilight sky: dim, desaturated, very slightly violet.
const SKY_DUSK: readonly [number, number, number] = [0.075, 0.075, 0.115];
// Ground bounce, high sun (snow/rock average albedo, sun-warmed). Around 0.6×
// the sky, which is what a mixed rock/snow basin returns.
const BOUNCE_DAY: readonly [number, number, number] = [0.17, 0.165, 0.155];
const BOUNCE_DUSK: readonly [number, number, number] = [0.040, 0.037, 0.037];

// Neutral "flat light" environment: no colour cast, so the technical presets
// (slope map, height ramps, diagnostics) keep their palette readable.
const FLAT_SKY: readonly [number, number, number] = [0.36, 0.38, 0.42];
const FLAT_BOUNCE: readonly [number, number, number] = [0.21, 0.21, 0.22];
const FLAT_HAZE: readonly [number, number, number] = [0.66, 0.68, 0.72];
const FLAT_SUN: readonly [number, number, number] = [0.90, 0.90, 0.90];

/**
 * Radiance of one "sun" at `sunStrength = 1`.
 *
 * Calibration: a white sunlit surface (linear albedo ≈ 0.9, N·L ≈ 0.9) must
 * land a little *over* 1.0 so the tone curve has something to roll off — here
 * ≈ 1.5 — while the same surface in shadow only gets the ≈ 0.27 sky term. That
 * is the ~6:1 ratio of a real mountain photograph. An earlier value of 3.2 put
 * everything past the shoulder of the curve and the whole cloud came out as a
 * flat, bluish white.
 */
const SUN_BASE = 1.75;
/** How much brighter than the sky dome the horizon haze integrates to. */
const HAZE_GAIN = 2.2;
/**
 * Neutral "key light" level in flat mode, as a fraction of {@link SUN_BASE}.
 * Tuned so flat lighting reads at roughly the same overall exposure as the sun
 * path despite its lower fixed N·L.
 */
const FLAT_SUN_GAIN = 0.62;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function mix3(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    t: number,
): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const scale3 = (a: readonly [number, number, number], k: number): [number, number, number] =>
    [a[0] * k, a[1] * k, a[2] * k];

/**
 * Build the linear lighting environment for the current sun position and the
 * user's ambient/sun sliders.
 *
 * Rationale for the numbers: a sunlit snow face (albedo ≈ 0.85) should land
 * around 1.7 linear — above 1, so the tone-mapper compresses it to a bright but
 * *unclipped* white — while the same face in shadow only receives the sky term
 * (≈ 0.23 linear, strongly blue). That ~7:1 ratio is what produces the crisp,
 * high-contrast alpine look of the reference images; a naive `ambient = 0.35`
 * constant gives barely 2:1 and reads flat and chalky.
 */
export function atmosphereFromSun(p: AtmosphereParams): LidarAtmosphere {
    const amb = Math.max(0, p.ambient);
    const flat = clamp01(p.flat);

    // Sun height above the horizon, 0 (horizon) → 1 (zenith); drives both the
    // sky colour (blue by day, violet-grey at dusk) and the ambient level.
    const h = clamp01(p.sunDir[2]);
    const day = smoothstep(0.0, 0.30, h);
    // The ambient never fully dies with the sun: even a night render must stay
    // legible, and skylight lags the sun in reality anyway.
    const level = (0.35 + 0.65 * day) * amb;

    const sunSky = scale3(mix3(SKY_DUSK, SKY_DAY, day), level);
    const sunBounce = scale3(mix3(BOUNCE_DUSK, BOUNCE_DAY, day), level);

    const direct = SUN_BASE * Math.max(0, p.sunStrength) * clamp01(p.sunIntensity);
    const sunLit: [number, number, number] = [
        p.sunColor[0] * direct,
        p.sunColor[1] * direct,
        p.sunColor[2] * direct,
    ];

    // Aerial perspective: the light scattered *into* a long line of sight. It
    // is essentially skylight integrated over distance (hence the sky colour,
    // several times brighter) plus a warm forward-scattering lobe around the
    // sun, which is what makes distant ridges glow instead of turning grey.
    const sunTint = clamp01(p.sunIntensity) * 0.28;
    const sunHaze: [number, number, number] = [
        sunSky[0] * HAZE_GAIN + p.sunColor[0] * sunTint,
        sunSky[1] * HAZE_GAIN + p.sunColor[1] * sunTint,
        sunSky[2] * HAZE_GAIN + p.sunColor[2] * sunTint,
    ];

    return {
        sky: mix3(sunSky, scale3(FLAT_SKY, amb), flat),
        bounce: mix3(sunBounce, scale3(FLAT_BOUNCE, amb), flat),
        haze: mix3(sunHaze, scale3(FLAT_HAZE, amb), flat),
        sun: mix3(sunLit, scale3(FLAT_SUN, SUN_BASE * Math.max(0, p.sunStrength) * FLAT_SUN_GAIN), flat),
    };
}
