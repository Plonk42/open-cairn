/**
 * MapLibre sky paint derived from the LiDAR lighting environment.
 *
 * The photorealistic mesh already fades toward `LidarAtmosphere.haze` with
 * distance (aerial perspective) and picks up `LidarAtmosphere.sky` as its
 * ambient. If the sky drawn *behind* it comes from an unrelated constant —
 * as it did, a fixed dark slate — the two disagree exactly where the eye is
 * most sensitive: on the horizon, where a distant ridge meets the sky. Driving
 * both from the same atmosphere makes them agree by construction, at every
 * hour of the day.
 *
 * See `src/lib/lidarAtmosphere.ts` for the linear radiances this consumes.
 */

import type { LidarAtmosphere } from './lidarAtmosphere';

/** The subset of MapLibre's `sky` spec this module drives. */
export interface SkyPaint {
    'sky-color': string;
    'horizon-color': string;
    'fog-color': string;
    'fog-ground-blend': number;
    'horizon-fog-blend': number;
    'sky-horizon-blend': number;
    'atmosphere-blend': number;
}

/**
 * Zenith tint applied to the ambient sky radiance.
 *
 * `atmo.sky` is the *dome average* irradiance: it is dragged toward white by
 * the bright, multiply-scattered sky near the horizon, so it is both paler and
 * brighter than the deep sky overhead. Rayleigh's λ⁻⁴ says what the zenith
 * keeps — the blue — and what it loses, so the correction is a redistribution
 * rather than an invention.
 *
 * Numerically, these three factors were solved by inverting the same ACES +
 * gamma chain the mesh uses so that a clear-noon atmosphere lands on the
 * zenith colour sampled from the reference renders (≈ #3d6fa8).
 */
const ZENITH_TINT: readonly [number, number, number] = [0.26, 0.44, 0.60];

/**
 * Horizon tint applied to the haze radiance. `atmo.haze` is inscattering
 * integrated over a long line of sight (hence `HAZE_GAIN`), which overshoots
 * what the sky itself displays at the horizon; solved the same way against the
 * reference's horizon band (≈ #b9c9dc).
 */
const HORIZON_TINT: readonly [number, number, number] = [0.51, 0.55, 0.60];

/** Narkowicz's ACES fit — the tone curve `lib/pbr.glsl` applies to the mesh. */
function tonemapAces(x: number): number {
    const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    return Math.min(1, Math.max(0, v));
}

/** Linear radiance → 8-bit display channel, via ACES then sRGB-ish gamma. */
function encodeChannel(linear: number, exposure: number): number {
    return Math.round(255 * tonemapAces(Math.max(0, linear) * exposure) ** (1 / 2.2));
}

function encodeCss(
    radiance: readonly [number, number, number],
    tint: readonly [number, number, number],
    exposure: number,
): string {
    const r = encodeChannel(radiance[0] * tint[0], exposure);
    const g = encodeChannel(radiance[1] * tint[1], exposure);
    const b = encodeChannel(radiance[2] * tint[2], exposure);
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Build MapLibre `sky` paint matching the current lighting environment.
 *
 * @param atmo - Linear environment from {@link import('./lidarAtmosphere').atmosphereFromSun}.
 * @param exposure - Same linear multiplier the mesh applies before tone mapping.
 */
export function skyFromAtmosphere(atmo: LidarAtmosphere, exposure: number): SkyPaint {
    const horizon = encodeCss(atmo.haze, HORIZON_TINT, exposure);
    return {
        'sky-color': encodeCss(atmo.sky, ZENITH_TINT, exposure),
        'horizon-color': horizon,
        // The DEM terrain around the LiDAR tile fades into the very colour the
        // mesh's own aerial perspective converges to, so the two blend instead
        // of the tile standing out as a cut-out.
        'fog-color': horizon,
        'fog-ground-blend': 0.5,
        'horizon-fog-blend': 0.4,
        'sky-horizon-blend': 0.5,
        'atmosphere-blend': 0.6,
    };
}
