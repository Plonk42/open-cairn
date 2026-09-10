#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_diff;
in float v_flatDiff;
in float v_flatDirect;
in vec2 v_uv;
in vec2 v_uvFine;
in vec4 v_lightPos;
in float v_depth;
in float v_distM;
in float v_nz;
in float v_alpha;
in float v_isVeg;
in float v_isGround;
in float v_emissive;

#include ./lib/sampleShadow.glsl;
#include ./lib/pbr.glsl;

uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
uniform sampler2D u_ortho;       // IGN orthophoto mosaic (texture unit 3)
uniform sampler2D u_orthoFine;   // view-sized detail mosaic (texture unit 4)
uniform float u_photoOpacityGround;    // 0..1, photo draping on the ground (class 2)
uniform float u_photoOpacityNonGround; // 0..1, photo draping off-ground (veg./buildings/…)
uniform float u_hasPhoto;        // 0 or 1, photo texture available
uniform float u_hasPhotoFine;    // 0 or 1, detail mosaic available
uniform float u_vegNormalShade;  // 0..1 = strength of normal-driven shading on vegetation
layout(location = 0) out vec4 fragColor;
// x = linear EDL depth (v_depth, normalized by u_farPlane in edl.frag);
// y = real hardware NDC depth (gl_FragCoord.z) — sampled in edl.frag as the
// "own depth" and compared against the LiDAR-only shared depth texture so a
// nearer cloud wins over a farther one where they overlap (multi-cloud
// occlusion; see SharedLidarDepth in LidarWebGLLayer.ts).
layout(location = 1) out vec2 fragDepth;

void main() {
    // Opaque round splats for vegetation: the point's square is cut into a disc
    // (alpha test, no blending) → organic foliage while keeping a clean depth
    // write for the EDL.
    if (v_isVeg > 0.5) {
        if (length(gl_PointCoord - 0.5) > 0.5) discard;
    }
    // « Analyse hauteur » diagnostic mode: flat emissive colour — shading is
    // bypassed, the depth write (hence the EDL) is kept so the relief remains.
    if (v_emissive > 0.5) {
        // Premultiplied colour: see mesh.frag (supersampling requires averaging
        // premultiplied colours).
        fragColor = vec4(v_albedo * v_alpha, v_alpha);
        fragDepth = vec2(v_depth, gl_FragCoord.z);
        return;
    }
    float s = sampleShadow();
    vec3 albedo = v_albedo;
    // Photo draping only inside the mosaic footprint. The detail mosaic covers
    // the current view at a finer zoom and wins wherever it reaches; the
    // footprint-wide one keeps everything else textured.
    bool fine = u_hasPhotoFine > 0.5
        && v_uvFine.x >= 0.0 && v_uvFine.x <= 1.0
        && v_uvFine.y >= 0.0 && v_uvFine.y <= 1.0;
    bool coarse = v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
    if (u_hasPhoto > 0.5 && (fine || coarse)) {
        vec3 photo = fine ? texture(u_orthoFine, v_uvFine).rgb : texture(u_ortho, v_uv).rgb;
        float op = (v_isGround > 0.5) ? u_photoOpacityGround : u_photoOpacityNonGround;
        albedo = mix(v_albedo, photo, op);
    }
    vec3 ambient = albedo * 0.35;
    vec3 diffuse = albedo * (0.75 * v_diff) * u_sunColor;
    vec3 lit = ambient + diffuse * s;
    // Neutral lighting (sun disabled): soft fixed direction + high ambient floor
    // → relief always readable. Cast shadows (s) may apply even without the sun
    // — the shadow map then follows the fixed direction.
    // Normal-driven shading is only attenuated on vegetation (slider): at 0 the
    // foliage goes flat (EDL only), at 1 it keeps all its normal relief.
    float vegNorm = (v_isVeg > 0.5) ? u_vegNormalShade : 1.0;
    float flatMod = mix(1.0, v_flatDiff, vegNorm);
    vec3 neutral = albedo * (0.2 + 0.8 * flatMod * s);
    // On foliage, the slider also mixes in the neutral lighting even when the
    // sun is active: 1 = pure directional sun (unchanged), lower = growing share
    // of neutral/normal lighting to soften the render.
    float flatVeg = (v_isVeg > 0.5) ? max(u_flatLight, 1.0 - u_vegNormalShade) : u_flatLight;
    vec3 rgb = mix(lit, neutral, flatVeg);
    // Photorealistic path: same decomposition, resolved in linear radiance
    // (hemispheric ambient + aerial perspective + filmic tone mapping).
    // The « ombrage feuillage » slider still flattens the foliage normal by
    // pushing it towards the fixed light, as in the legacy model.
    float direct = mix(v_diff, v_flatDirect, flatVeg) * s;
    rgb = mix(rgb, pbrEncode(pbrShade(albedo, v_nz, direct, v_distM)), u_pbr);
    fragColor = vec4(rgb * v_alpha, v_alpha);
    fragDepth = vec2(v_depth, gl_FragCoord.z);
}
