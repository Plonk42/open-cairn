// Procedural micro-relief for the rock mesh.
//
// Poisson reconstruction is capped by the resolution of the data (~0.45 m
// sample spacing on gentle slopes, far less on walls: a nadir LiDAR samples a
// slope at density × cos θ, i.e. 9 % at 85°). Anything finer than that — the
// grain of the rock, decimetric cracks, flaking — simply does not exist in the
// geometry and never will.
//
// It is therefore restored through lighting: a fractal height field in world
// space perturbs the shading normal, without touching either the silhouette or
// the cast shadows. See docs/ROCK_AND_CLIFF_DETAIL.md §2.D.12.

/** 3D hash → [0,1). Dave Hoskins variant (hash13), without sin(). */
float mrHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

/**
 * 3D value noise with Hermite interpolation, in [-1,1], AND its analytic
 * gradient `grad` (per unit of `p`).
 *
 * The gradient is essential: taking it from screen derivatives (dFdx/dFdy)
 * would make it constant over the GPU's 2×2 quad, so all the rock relief would
 * be shaded at half the linear resolution of the screen. See
 * docs/ROCK_AND_CLIFF_DETAIL.md §4. The trilinear form is written out expanded
 * (k0..k7) — algebraically identical to the nested `mix`, but the three partial
 * derivatives follow from it without re-evaluating the 8 corners.
 */
float mrValueNoiseD(vec3 p, out vec3 grad) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    vec3 du = 6.0 * f * (1.0 - f);
    float n000 = mrHash(i);
    float n100 = mrHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = mrHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = mrHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = mrHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = mrHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = mrHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = mrHash(i + vec3(1.0, 1.0, 1.0));

    float k0 = n000;
    float k1 = n100 - n000;
    float k2 = n010 - n000;
    float k3 = n001 - n000;
    float k4 = n000 - n100 - n010 + n110;
    float k5 = n000 - n100 - n001 + n101;
    float k6 = n000 - n010 - n001 + n011;
    float k7 = -n000 + n100 + n010 - n110 + n001 - n101 - n011 + n111;

    float n = k0 + k1 * u.x + k2 * u.y + k3 * u.z
        + k4 * u.x * u.y + k5 * u.x * u.z + k6 * u.y * u.z
        + k7 * u.x * u.y * u.z;

    // ×2 to follow the [0,1] → [-1,1] rescaling of the return value.
    grad = 2.0 * du * vec3(
        k1 + k4 * u.y + k5 * u.z + k7 * u.y * u.z,
        k2 + k4 * u.x + k6 * u.z + k7 * u.x * u.z,
        k3 + k5 * u.x + k6 * u.y + k7 * u.x * u.y);

    return n * 2.0 - 1.0;
}

/** Same noise, without the gradient (`grad` is eliminated at compile time). */
float mrValueNoise(vec3 p) {
    vec3 grad;
    return mrValueNoiseD(p, grad);
}

// Wavelength (m) and amplitude (m) of the first octave. 1.6 m / 13.5 cm: the
// scale of the block and of the flake, just below what the reconstruction can
// resolve — coarse enough to read at 200 m, fine enough not to compete with the
// real relief. Amplitude tuned by eye on the Aiguilles Rouges: beyond that, the
// rock turns into noise rather than grain.
const float MR_BASE_M = 1.6;
const float MR_AMPL_M = 0.135;
const int MR_OCTAVES = 3;
// Octave fade, in fractions of the wavelength: an octave starts fading out as
// soon as the pixel footprint reaches half its wavelength and is gone at 1.4 λ.
// Deliberately early — at 0.9 λ an octave was still beating at half amplitude
// right on the screen's Nyquist frequency (§4.2).
const float MR_FADE_LO = 0.5;
const float MR_FADE_HI = 1.4;

/**
 * Fractal height field in metres, and its world gradient `grad` (dimensionless).
 * `pixelM` is the world footprint of one pixel: an octave whose wavelength
 * drops below the pixel size can no longer be sampled and would shimmer, so it
 * is faded out progressively — this stands in for the mip-mapping we do not
 * have here.
 */
float mrHeight(vec3 wpos, float pixelM, out vec3 grad) {
    float h = 0.0;
    grad = vec3(0.0);
    float lambda = MR_BASE_M;
    float amp = MR_AMPL_M;
    for (int o = 0; o < MR_OCTAVES; o++) {
        float w = 1.0 - smoothstep(MR_FADE_LO * lambda, MR_FADE_HI * lambda, pixelM);
        vec3 g;
        h += amp * w * mrValueNoiseD(wpos / lambda, g);
        grad += (amp * w / lambda) * g;
        lambda *= 0.42;
        amp *= 0.55;
    }
    return h;
}

/**
 * Perturbs `n` with the micro-relief, `amount` dosing the amplitude (0 = no
 * effect).
 *
 * Mikkelsen's method ("bump mapping unparametrized surfaces"): the surface
 * gradient is the tangential component of the 3D height gradient, so no
 * tangents and no UVs — which is convenient, since a Poisson mesh has neither.
 * The gradient being analytic, the perturbation is computed PER PIXEL (it was
 * per 2×2 quad as long as it came from dFdx/dFdy — see §4.2).
 */
vec3 microReliefNormal(vec3 n, vec3 wpos, float amount) {
    // Only the pixel footprint remains a screen derivative: it is a
    // low-frequency quantity, so its per-quad quantization has no visible effect.
    float pixelM = max(length(dFdx(wpos)), length(dFdy(wpos)));
    vec3 grad;
    mrHeight(wpos, pixelM, grad);
    grad *= amount;
    vec3 surfGrad = grad - n * dot(n, grad);
    return normalize(n - surfGrad);
}
