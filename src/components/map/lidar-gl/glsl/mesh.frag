#version 300 es
precision highp float;
in vec3 v_albedo;
in vec3 v_normal;
in vec2 v_uv;
in vec2 v_uvFine;
in vec4 v_lightPos;
in float v_depth;
in float v_distM;
in float v_alpha;
in float v_base;
in vec3 v_wpos;
in vec3 v_view;
in float v_snow;

#include ./lib/sampleShadow.glsl;
#include ./lib/flatLight.glsl;
#include ./lib/microRelief.glsl;
// rockAlbedo uses mrValueNoise: it must stay AFTER microRelief.
#include ./lib/rockAlbedo.glsl;
#include ./lib/pbr.glsl;

uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
// Blend interpolated normal → geometric normal (0 = smooth, 1 = faceted).
// See docs/ROCK_AND_CLIFF_DETAIL.md §2.C.8.
uniform float u_facet;
// Amplitude of the procedural micro-relief (0 = none). §2.D.12.
uniform float u_microRelief;
// Amplitude of the albedo breakup (patina + firn edge, 0 = none). §2.D.13.
uniform float u_rockBreak;
// Strength of the GGX specular lobe (0 = pure diffuse). §2.C.9.
uniform float u_specular;
uniform sampler2D u_ortho;       // IGN orthophoto mosaic (texture unit 3)
uniform sampler2D u_orthoFine;   // view-sized detail mosaic (texture unit 4)
uniform float u_photoOpacityGround;    // 0..1, photo draping on the ground (the mesh = ground)
uniform float u_hasPhoto;        // 0 or 1, photo texture available
uniform float u_hasPhotoFine;    // 0 or 1, detail mosaic available
uniform float u_wireframe;       // 1 = debug wireframe (flat colour, no light/texture)
layout(location = 0) out vec4 fragColor;
// x = linear EDL depth (v_depth, normalized by u_farPlane in edl.frag), stored
// **negated** so the composite pass can tell mesh fragments from point ones:
// EDL's black silhouettes are a point-cloud legibility trick and read as
// cracks on a continuous surface, so edl.frag skips them here. Magnitude is
// unchanged (edl.frag takes abs()), and 0 stays the no-data sentinel.
// y = real hardware NDC depth (gl_FragCoord.z) — sampled in edl.frag as the
// "own depth" and compared against the LiDAR-only shared depth texture so a
// nearer cloud wins over a farther one where they overlap (multi-cloud
// occlusion; see SharedLidarDepth in LidarWebGLLayer.ts).
layout(location = 1) out vec2 fragDepth;

void main() {
    // Wireframe debug mode: readable flat colour, no light and no photo.
    if (u_wireframe > 0.5) {
        fragColor = vec4(0.15, 1.0, 0.55, 1.0);
        fragDepth = vec2(-v_depth, gl_FragCoord.z);
        return;
    }
    float s = sampleShadow();

    vec3 nSmooth = normalize(v_normal);
    vec3 albedo = v_albedo;
    // Photo draping only inside the mosaic footprint — and only on surfaces
    // that "see the sky". A nadir photo makes no sense on a downward-facing
    // face: it is faded out as the normal tips below the horizontal, which
    // removes the texture from the Poisson mesh's phantom closed bottom (and
    // from the undersides of overhangs) without touching the geometry or the
    // vertical cliffs. The vertical walls of the synthetic base (v_base,
    // hatched below) do not "see" the sky either, but their normal is nearly
    // horizontal (v_up≈0) so the fade above would let them receive the photo —
    // they are excluded explicitly.
    // The SMOOTH normal is used here: draping must not shimmer with faceting.
    // The detail mosaic covers the current view at a finer zoom and wins
    // wherever it reaches; the footprint-wide one keeps the rest textured.
    float photoFacing = v_base > 0.5 ? 0.0 : smoothstep(-0.25, 0.05, nSmooth.z);
    float photoK = 0.0;
    bool fine = u_hasPhotoFine > 0.5
        && v_uvFine.x >= 0.0 && v_uvFine.x <= 1.0
        && v_uvFine.y >= 0.0 && v_uvFine.y <= 1.0;
    bool coarse = v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
    if (u_hasPhoto > 0.5 && photoFacing > 0.0 && (fine || coarse)) {
        vec3 photo = fine ? texture(u_orthoFine, v_uvFine).rgb : texture(u_ortho, v_uv).rgb;
        photoK = u_photoOpacityGround * photoFacing;
        albedo = mix(v_albedo, photo, photoK);
    }

    // ── Shading normal ──────────────────────────────────────────────
    // The Poisson vertex normal is smooth by construction (the solver solves a
    // C² scalar field, and the pipeline applies two further Laplacian passes to
    // it): interpolated across the triangle, it gives rock a waxy look. The
    // geometric normal — constant over each facet, reconstructed here from the
    // screen-space derivatives of the world position — restores the mesh's real
    // faceting instead. u_facet doses between the two.
    vec3 nGeom = nSmooth;
    if (u_facet > 0.0) {
        vec3 g = cross(dFdx(v_wpos), dFdy(v_wpos));
        float gLen2 = dot(g, g);
        // Degenerate triangle / silhouette: no usable geometric normal.
        if (gLen2 > 1e-20) {
            nGeom = g * inversesqrt(gLen2);
            // The sign depends on screen winding, not on the real orientation.
            if (dot(nGeom, nSmooth) < 0.0) nGeom = -nGeom;
        }
    }
    vec3 n = normalize(mix(nSmooth, nGeom, u_facet));

    // Micro-relief: on rock only. Snow is smooth in nature, and the vertical
    // walls of the synthetic base are not terrain.
    // Multiplied rather than branched: `microReliefNormal` takes screen-space
    // derivatives, which would be undefined under a divergent branch.
    //
    // The snow ratio comes from the palette itself (v_snow), which KNOWS where
    // it put snow. Under a draped photo, however, the visible firn is the one
    // in the photograph, not the palette's: we then fall back on luminance, the
    // only available cue — hence the cross-fade on `photoK`.
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    float notBase = 1.0 - step(0.5, v_base);
    float snowT = mix(v_snow, smoothstep(RA_SNOW_LO, RA_SNOW_HI, lum), photoK);
    float rockness = (1.0 - snowT) * notBase;
    n = microReliefNormal(n, v_wpos, u_microRelief * rockness);

    // Albedo breakup: fractal patina on the rock + ragged firn edge.
    // Purely reflectance — applied before any lighting computation.
    float pixelM = max(length(dFdx(v_wpos)), length(dFdy(v_wpos)));
    albedo = rockAlbedoBreakup(albedo, v_wpos, pixelM, rockness, u_rockBreak * notBase, snowT);

    float diff = max(0.0, dot(n, u_sunDir)) * u_sunIntensity;
    vec3 flatDir = normalize(FLAT_LIGHT_DIR);    // Neutral lighting: soft wrap lighting → readable relief without harshness.
    float flatDiff = dot(n, flatDir) * 0.5 + 0.5;
    // The PBR path already provides a floor through the hemispheric ambient: it
    // needs a plain N·L, not the wrap (which would add phantom light on faces
    // turned away from the light and flatten the relief).
    float flatDirect = max(0.0, dot(n, flatDir));

    // ── Specular lobe ───────────────────────────────────────────────
    // Rock is not clay: most of its mineral character comes from a broad
    // reflection that follows grazing light. Snow is smoother and less
    // reflective than rock (bare dielectric F0), hence parameters interpolated
    // on `rockness`.
    const float SPEC_ROUGH_ROCK = 0.42;
    const float SPEC_ROUGH_SNOW = 0.22;
    const float SPEC_F0_ROCK = 0.09;
    const float SPEC_F0_SNOW = 0.03;
    // Artistic gain. A physically exact dielectric lobe is nearly invisible next
    // to the diffuse term (measured: ~3 % in display value), all the more so as
    // the anti-shimmer term widens the lobe. The slider therefore drives a
    // deliberate exaggeration, calibrated so that 100 % reads as "mineral"
    // without blowing out.
    const float SPEC_GAIN = 6.0;
    vec3 dnx = dFdx(n);
    vec3 dny = dFdy(n);
    // Anti-shimmer (Kaplanyan): the pixel-scale variance of the normal is
    // converted into extra roughness, otherwise the micro-relief would make the
    // lobe sparkle at the slightest camera movement.
    float nVar = min(dot(dnx, dnx) + dot(dny, dny), 0.12);
    float rough = mix(SPEC_ROUGH_SNOW, SPEC_ROUGH_ROCK, rockness);
    rough = min(1.0, sqrt(rough * rough + nVar));
    vec3 lightDir = normalize(mix(u_sunDir, flatDir, u_flatLight));
    float lightGain = mix(u_sunIntensity, 1.0, u_flatLight);
    float spec = pbrSpecular(n, normalize(v_view), lightDir, rough,
            mix(SPEC_F0_SNOW, SPEC_F0_ROCK, rockness))
        * lightGain * s * u_specular * notBase * SPEC_GAIN;

    vec3 ambient = albedo * 0.35;
    vec3 diffuse = albedo * (0.75 * diff) * u_sunColor;
    vec3 lit = ambient + diffuse * s;
    // Neutral lighting (sun disabled): soft fixed direction + high ambient
    // floor → relief always readable. Cast shadows (s) may apply even without
    // the sun — the shadow map then follows the fixed direction.
    vec3 neutral = albedo * (0.2 + 0.8 * flatDiff * s);
    vec3 rgb = mix(lit, neutral, u_flatLight);
    // Photorealistic path: same decomposition (direct × shadow, sun or fixed
    // light) but resolved in linear radiance with hemispheric ambient, aerial
    // perspective and filmic tone mapping.
    float direct = mix(diff, flatDirect, u_flatLight) * s;
    rgb = mix(rgb, pbrEncode(pbrShadeSpec(albedo, n.z, direct, v_distM, spec)), u_pbr);
    // 45° hatching engraved on the walls of the synthetic base. In world space
    // (v_wpos, metres): the lines follow the mesh (they stay pinned to the wall
    // when the camera moves). Thickness is measured in pixels through fwidth so
    // it stays a thin ~1 px stroke at any zoom.
    if (v_base > 0.5) {
        const float HATCH_PERIOD_M = 10.0; // line spacing (metres, on the mesh)
        float coord = (v_wpos.z + v_wpos.x + v_wpos.y) / HATCH_PERIOD_M;
        float f = fract(coord);
        float line = min(f, 1.0 - f);                  // distance to the nearest line
        float dist = line / max(fwidth(coord), 1e-5);  // distance in pixels
        float lineMask = 1.0 - smoothstep(0.5, 1.0, dist); // thin ~1 px stroke
        rgb = mix(rgb, rgb * 0.75, lineMask);
    }
    // Colour PREMULTIPLIED by alpha: the geometry pass may be rendered
    // supersampled, and only a premultiplied colour averages correctly —
    // otherwise silhouettes, averaged with the background cleared to (0,0,0,0),
    // come out darkened. Compositing (edl.frag) therefore uses a premultiplied
    // blend.
    fragColor = vec4(rgb * v_alpha, v_alpha);
    fragDepth = vec2(-v_depth, gl_FragCoord.z);
}
