/**
 * Re-exposes the photographic basemap so it agrees with the procedurally lit
 * LiDAR mesh.
 *
 * The IGN orthophoto is a *photograph*, shot once, near noon, in clear weather:
 * its brightness is frozen. The reconstructed mesh next to it is lit by our own
 * sun, at whatever hour the user picked. Move the sun to 18:00 and the mesh
 * correctly darkens into raking light while the ortho stays at midday — the
 * seam between the two becomes the most obvious "this is a computer image" tell
 * in the whole frame, and it is the reason the render was stuck at noon.
 *
 * A raster layer cannot be relit properly (we have no normals, no shadows, and
 * the photo already contains its own shading). But the *first-order* term — how
 * much light a horizontal surface receives now versus at the noon the photo was
 * taken — is a single scalar, and MapLibre exposes exactly the three knobs
 * needed to apply it: `raster-brightness-max` (white point),
 * `raster-brightness-min` (black point, i.e. how much skylight fills the
 * shadows) and `raster-saturation`.
 *
 * The result is not physically exact, but it removes the discontinuity: at
 * dusk the whole scene — mesh and basemap — goes dark, flat and blue together,
 * which is what a photograph of that hour looks like.
 */

import { atmosphereFromSun, type AtmosphereParams, type LidarAtmosphere } from './lidarAtmosphere';

/** MapLibre `raster-*` paint values to apply to every basemap raster layer. */
export interface RasterRelight {
    /** `raster-brightness-min`: black point, lifted as skylight takes over. */
    brightnessMin: number;
    /** `raster-brightness-max`: white point, i.e. the overall exposure. */
    brightnessMax: number;
    /** `raster-saturation`, -1..1. Negative as the light turns to pure skylight. */
    saturation: number;
}

/** Neutral values — what MapLibre uses by default, i.e. "photo as shot". */
export const NEUTRAL_RELIGHT: RasterRelight = { brightnessMin: 0, brightnessMax: 1, saturation: 0 };

/** Rec. 709 luma of a linear radiance triple. */
const lum = (c: readonly [number, number, number]): number =>
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * How flat the light is allowed to get: at pure skylight the basemap's own
 * baked-in shadows are lifted by this fraction of its white point. Full
 * flattening (1) would grey the image out completely; a real overcast/dusk
 * photograph keeps some contrast.
 */
const MAX_SHADOW_LIFT = 0.4;
/** Desaturation at pure skylight — the ortho's warm midday hues have to go. */
const MAX_DESATURATION = 0.35;
/**
 * Floor on the white point. Without it a night sun would take the basemap to
 * pure black and the mesh would float over a void; the render stays readable
 * (and moonlit-looking) instead.
 */
const MIN_EXPOSURE = 0.08;

/**
 * Irradiance received by a horizontal, up-facing surface, in the same linear
 * units the shaders use: direct sun projected on the normal, plus the sky dome.
 */
function horizontalIrradiance(atmo: LidarAtmosphere, sunUp: number): number {
    return lum(atmo.sun) * Math.max(0, sunUp) + lum(atmo.sky);
}

/**
 * Paint values that bring the basemap photograph to the current lighting.
 *
 * The reference is the *same* atmosphere with the sun at the zenith and the
 * user's ambient/sun sliders untouched: the relight then reacts to the time of
 * day only, and the sliders keep acting on mesh and basemap coherently instead
 * of fighting each other.
 *
 * @param p Same parameters used to build the render's atmosphere.
 * @param exposure The photoreal exposure slider; only darkens (the raster white
 *   point cannot exceed 1, so a brighter exposure leaves the photo untouched).
 */
export function basemapRelight(p: AtmosphereParams, exposure: number): RasterRelight {
    const atmo = atmosphereFromSun(p);
    const noon = atmosphereFromSun({ ...p, sunDir: [0, 0, 1], sunColor: [1, 1, 1], sunIntensity: 1 });

    const now = horizontalIrradiance(atmo, p.sunDir[2]);
    const reference = horizontalIrradiance(noon, 1);
    if (reference <= 0) return { ...NEUTRAL_RELIGHT };

    // Radiance ratio → display ratio: the raster is sRGB-encoded, so scaling
    // its stored values by r^(1/2.2) scales the light it depicts by r.
    const ratio = (now / reference) * Math.max(0, exposure);
    const brightnessMax = Math.min(1, Math.max(MIN_EXPOSURE, ratio ** (1 / 2.2)));

    // Fraction of the light that has no direction. At noon it is ~15 % and the
    // photo is left alone; with the sun below the horizon it is all of it, and
    // the image has to read as shadowless.
    const ambientFraction = lum(atmo.sky) / Math.max(1e-6, now);
    return {
        brightnessMin: brightnessMax * MAX_SHADOW_LIFT * ambientFraction,
        brightnessMax,
        saturation: -MAX_DESATURATION * ambientFraction,
    };
}
