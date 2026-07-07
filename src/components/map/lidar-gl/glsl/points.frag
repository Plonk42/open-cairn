#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_diff;
in float v_flatDiff;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_alpha;
in float v_isVeg;
in float v_isGround;
in float v_emissive;

#include ./lib/sampleShadow.glsl;

uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
uniform sampler2D u_ortho;       // mosaïque orthophoto IGN (unité texture 3)
uniform float u_photoOpacityGround;    // 0..1, drapage photo sur le sol (classe 2)
uniform float u_photoOpacityNonGround; // 0..1, drapage photo hors-sol (végét./bâti/…)
uniform float u_hasPhoto;        // 0 ou 1, texture photo disponible
uniform float u_vegNormalShade;  // 0..1 = strength of normal-driven shading on vegetation
layout(location = 0) out vec4 fragColor;
// x = linear EDL depth (v_depth, normalized by u_farPlane in edl.frag);
// y = real hardware NDC depth (gl_FragCoord.z) — sampled in edl.frag as the
// "own depth" and compared against the LiDAR-only shared depth texture so a
// nearer cloud wins over a farther one where they overlap (multi-cloud
// occlusion; see SharedLidarDepth in LidarWebGLLayer.ts).
layout(location = 1) out vec2 fragDepth;

void main() {
    // Splats ronds opaques pour la végétation : on découpe le carré du point
    // en disque (alpha-test, pas de blending) → feuillage organique tout en
    // gardant une écriture de profondeur propre pour l'EDL.
    if (v_isVeg > 0.5) {
        if (length(gl_PointCoord - 0.5) > 0.5) discard;
    }
    // Mode diagnostic « Analyse hauteur » : couleur plate émissive — on bypasse
    // l'ombrage, l'EDL via la profondeur restant écrite pour garder le relief.
    if (v_emissive > 0.5) {
        fragColor = vec4(v_albedo, v_alpha);
        fragDepth = vec2(v_depth, gl_FragCoord.z);
        return;
    }
    float s = sampleShadow();
    vec3 albedo = v_albedo;
    // Drapage photo uniquement à l'intérieur de l'emprise de la mosaïque.
    if (u_hasPhoto > 0.5
        && v_uv.x >= 0.0 && v_uv.x <= 1.0
        && v_uv.y >= 0.0 && v_uv.y <= 1.0) {
        vec3 photo = texture(u_ortho, v_uv).rgb;
        float op = (v_isGround > 0.5) ? u_photoOpacityGround : u_photoOpacityNonGround;
        albedo = mix(v_albedo, photo, op);
    }
    vec3 ambient = albedo * 0.35;
    vec3 diffuse = albedo * (0.75 * v_diff) * u_sunColor;
    vec3 lit = ambient + diffuse * s;
    // Éclairage neutre (soleil désactivé) : direction fixe douce + plancher
    // ambiant élevé → relief toujours lisible. Les ombres portées (s) peuvent
    // s'appliquer même sans soleil — la shadow map suit alors la direction fixe.
    // L'ombrage par normale n'est atténué que sur la végétation (slider) : à 0 le
    // feuillage devient plat (EDL seul), à 1 il garde tout son relief de normale.
    float vegNorm = (v_isVeg > 0.5) ? u_vegNormalShade : 1.0;
    float flatMod = mix(1.0, v_flatDiff, vegNorm);
    vec3 neutral = albedo * (0.2 + 0.8 * flatMod * s);
    // Sur le feuillage, le slider mélange aussi l'éclairage neutre même quand le
    // soleil est actif : 1 = soleil directionnel pur (inchangé), plus bas = part
    // croissante d'éclairage neutre/normale pour adoucir le rendu.
    float flatVeg = (v_isVeg > 0.5) ? max(u_flatLight, 1.0 - u_vegNormalShade) : u_flatLight;
    fragColor = vec4(mix(lit, neutral, flatVeg), v_alpha);
    fragDepth = vec2(v_depth, gl_FragCoord.z);
}
