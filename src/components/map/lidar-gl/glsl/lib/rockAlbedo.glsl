// Rock albedo breakup. See docs/ROCK_AND_CLIFF_DETAIL.md §2.D.13.
//
// The `montagne` palette (src/lib/lidarBrowser/slope.ts) is a smooth function of
// slope, elevation and aspect: at a given slope and elevation, the whole
// mountain side gets exactly the same colour. Real rock, on the other hand, is
// zoned — beds, veins, patina, lichen, runoff streaks — and that reflectance
// variation is a good half of what makes it *read* as rock. It is added here in
// world space, in pure reflectance: no light is baked in, the palette knows
// nothing about it, and the result follows the mesh when the camera moves.
//
// Second effect, same slider: the firn/rock limit of `montagneGround` is a
// smooth ramp → blurry, gelatinous snow patches. It is re-thresholded with the
// same noise, which gives it a ragged edge back.
//
// DEPENDENCY: requires `mrValueNoise` from ./lib/microRelief.glsl, which must be
// included BEFORE this file (includes are textual and flat).

// Wavelengths (m) of the two patina octaves: the scale of the rock bed and that
// of the slab.
const float RA_BAND_M = 22.0;
const float RA_DETAIL_M = 6.5;
// Amplitude of the brightness modulation at 100 % (±18 %) and of the associated
// warm/cold drift (oxidation vs fresh rock).
const float RA_VALUE = 0.18;
const float RA_TINT = 0.07;

// Luminance window within which we consider ourselves on the rock → snow
// transition. Only the draped-photo case still uses it: the palette, evaluated
// on the GPU, now supplies its snow ratio directly (see `paletteAlbedo` in
// ./palette.glsl), and only an orthophoto can still show a firn patch the
// palette knows nothing about.
//
// The lower bound must stay ABOVE the lightest rock the palette can produce,
// otherwise the mask mistakes washed limestone for the start of a firn patch
// and strips its patina. Urgonian limestone peaks at 172/255 = 0.67 luminance;
// packed snow starts at 0.85.
const float RA_SNOW_LO = 0.76;
const float RA_SNOW_HI = 0.86;
// Wavelength (m) and amplitude of the noise that cuts the firn edge, and
// steepness of the re-thresholding (>1 = sharper edge than the original ramp).
const float RA_SNOW_M = 5.0;
const float RA_SNOW_JITTER = 0.42;
const float RA_SNOW_SHARPEN = 2.6;

/**
 * 2-octave fractal noise in world space, roughly in [-1,1].
 * `pixelM` = footprint of one pixel on the surface (m): each octave fades out
 * before reaching the screen's Nyquist frequency, otherwise the rock crawls as
 * soon as one moves away.
 */
float raFbm(vec3 wpos, float pixelM) {
    float w1 = 1.0 - smoothstep(0.25 * RA_BAND_M, 0.9 * RA_BAND_M, pixelM);
    float w2 = 1.0 - smoothstep(0.25 * RA_DETAIL_M, 0.9 * RA_DETAIL_M, pixelM);
    return mrValueNoise(wpos / RA_BAND_M) * w1
         + mrValueNoise(wpos / RA_DETAIL_M) * 0.5 * w2;
}

/**
 * Modulates the rock albedo and re-cuts the edge of firn patches.
 *
 * @param albedo  base colour (palette or draped photo), perceptually linear
 * @param wpos    world position in metres (east, north, elevation)
 * @param pixelM  pixel footprint on the surface, in metres
 * @param rock    rock mask in [0,1] (0 = snow)
 * @param amount  strength of the effect (0 = none, 1 = nominal). The caller
 *                zeroes it on the synthetic base, which is not terrain.
 * @param snow    snow ratio already mixed into `albedo`, in [0,1]. At 0 the
 *                firn-edge re-cut is strictly the identity: a reading palette
 *                (Mono, Pente), where lightness means nothing of the sort, is
 *                therefore no longer torn into patches.
 */
vec3 rockAlbedoBreakup(vec3 albedo, vec3 wpos, float pixelM, float rock, float amount, float snow) {
    if (amount <= 0.0) return albedo;

    // ── Patina: value variation + warm/cold drift ────────────────────────
    float nb = raFbm(wpos, pixelM);
    float k = amount * rock;
    // Red rises and blue falls when the noise is positive: that is the
    // signature of a ferrous patina, the opposite drift giving freshly broken
    // rock, greyer and colder.
    vec3 tint = vec3(1.0 + RA_TINT * nb, 1.0, 1.0 - RA_TINT * nb);
    vec3 out_ = albedo * (1.0 + RA_VALUE * nb * k) * mix(vec3(1.0), tint, k);

    // ── Firn edge ─────────────────────────────────────────────────
    // We rebuild the two extreme colours that give exactly `out_` back at `t`
    // (hence no effect when the noise is zero), then re-mix with a noisy and
    // steeper threshold.
    float t = clamp(snow, 0.0, 1.0);
    // Outside the transition zone (t≈0 or t≈1) the re-mix must be STRICTLY the
    // identity: bare slab and solid firn do not move. The noise therefore fades
    // out at both ends (4t(1-t) is 1 in the middle, 0 at the bounds), otherwise
    // an extreme `ns` was enough to push `tn` to 0.29 on rock without a single
    // flake of snow, and to sprinkle a noisy brightening over it.
    float ns = mrValueNoise(wpos / RA_SNOW_M) * 4.0 * t * (1.0 - t);
    float tn = clamp((t - 0.5 - RA_SNOW_JITTER * ns) * RA_SNOW_SHARPEN + 0.5, 0.0, 1.0);
    vec3 rockRef = out_ * (1.0 - 0.30 * t);
    vec3 snowRef = out_ + 0.30 * (1.0 - t) * (vec3(1.0) - out_);
    out_ = mix(out_, mix(rockRef, snowRef, tn), amount);

    return clamp(out_, 0.0, 1.0);
}
