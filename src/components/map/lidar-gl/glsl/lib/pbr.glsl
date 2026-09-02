// ─── Physically-flavoured shading (shared by the mesh and point shaders) ─────
//
// The legacy model shades directly in sRGB display values with a constant
// `ambient = albedo * 0.35`. That is cheap but it caps the sunlit/shadow ratio
// at roughly 2:1, clips every highlight at 1.0, and makes shadows a uniform
// grey — which is exactly why snow used to read chalky and flat.
//
// This path instead:
//   • converts the albedo to **linear** radiance before any multiplication,
//   • lights it with a **hemispheric** ambient (cold sky above, warm bounce
//     below) plus a direct term several times brighter than that ambient,
//   • fades it toward an inscattering colour with distance (aerial
//     perspective), and
//   • compresses the resulting over-range values with a filmic tone curve
//     before encoding back to sRGB.
//
// See `src/lib/lidarAtmosphere.ts` for where the linear radiances come from.

uniform float u_pbr;         // 0 = legacy sRGB shading, 1 = linear + tone-mapped
uniform float u_exposure;    // linear multiplier applied before the tone curve
uniform vec3  u_ambSky;      // linear ambient radiance for up-facing normals
uniform vec3  u_ambGround;   // linear ambient radiance for down-facing normals
uniform vec3  u_sunRadiance; // linear radiance of the direct (sun or key) light
uniform vec3  u_hazeColor;   // linear inscattering colour of the distance haze
uniform float u_hazeDensity; // extinction per metre; 0 disables aerial perspective

// Fast sRGB→linear (Brennan's cubic fit). Max error ≈ 1e-3 — far below 8-bit
// quantisation — and avoids three pow() per fragment.
vec3 srgbToLinear(vec3 c) {
    vec3 x = clamp(c, 0.0, 1.0);
    return x * (x * (x * 0.305306011 + 0.682171111) + 0.012522878);
}

// Narkowicz's fit of the ACES filmic tone curve: a smooth shoulder that rolls
// over-range radiance into [0,1] instead of clipping it, plus a slight toe that
// keeps shadow detail. This is what lets sunlit snow sit at 2.5+ linear and
// still come out as a bright, *textured* white rather than a flat 255.
vec3 tonemapAces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Ambient radiance arriving at a surface whose normal has vertical component
 * `nz` (+1 = facing the sky, -1 = facing the ground). Cheap two-lobe
 * approximation of a sky dome over a diffuse ground plane — the reason snow in
 * shadow turns blue and overhangs pick up a warm bounce.
 */
vec3 hemisphericAmbient(float nz) {
    return mix(u_ambGround, u_ambSky, clamp(nz * 0.5 + 0.5, 0.0, 1.0));
}

/** Exponential inscattering toward `u_hazeColor` over `distM` metres. */
vec3 aerialPerspective(vec3 radiance, float distM) {
    float t = 1.0 - exp(-max(distM, 0.0) * u_hazeDensity);
    return mix(radiance, u_hazeColor, t);
}

/**
 * Full linear shade: albedo (given in sRGB, as stored in the vertex colours)
 * lit by hemispheric ambient + `direct` × sun radiance, then hazed.
 * `direct` already carries N·L, the sun intensity and the cast-shadow factor.
 */
vec3 pbrShade(vec3 albedoSrgb, float nz, float direct, float distM) {
    vec3 albedo = srgbToLinear(albedoSrgb);
    vec3 irradiance = hemisphericAmbient(nz) + u_sunRadiance * max(direct, 0.0);
    return aerialPerspective(albedo * irradiance, distM);
}

/** Tone-map linear radiance and encode to display sRGB. */
vec3 pbrEncode(vec3 radiance) {
    return pow(tonemapAces(radiance * u_exposure), vec3(1.0 / 2.2));
}
