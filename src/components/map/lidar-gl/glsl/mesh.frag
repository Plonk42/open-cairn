#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_diff;
in float v_flatDiff;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_alpha;
in float v_up;

#include ./lib/sampleShadow.glsl;

uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
uniform sampler2D u_ortho;       // mosaïque orthophoto IGN (unité texture 3)
uniform float u_photoOpacityGround;    // 0..1, drapage photo sur le sol (le mesh = sol)
uniform float u_hasPhoto;        // 0 ou 1, texture photo disponible
uniform float u_wireframe;       // 1 = fil de fer debug (couleur plate, sans lumière/texture)
layout(location = 0) out vec4 fragColor;
layout(location = 1) out float fragDepth;

void main() {
    // Mode debug fil de fer : couleur plate lisible, aucune lumière ni photo.
    if (u_wireframe > 0.5) {
        fragColor = vec4(0.15, 1.0, 0.55, 1.0);
        fragDepth = v_depth;
        return;
    }
    float s = sampleShadow();
    vec3 albedo = v_albedo;
    // Drapage photo uniquement à l'intérieur de l'emprise de la mosaïque — et
    // seulement sur les surfaces qui « voient le ciel ». Une photo nadir n'a
    // aucun sens sur une face orientée vers le bas : on l'estompe quand la
    // normale bascule sous l'horizontale, ce qui retire la texture du fond
    // fermé fantôme du mesh Poisson (et des dessous de surplombs) sans toucher
    // à la géométrie ni aux falaises verticales.
    float photoFacing = smoothstep(-0.25, 0.05, v_up);
    if (u_hasPhoto > 0.5
        && photoFacing > 0.0
        && v_uv.x >= 0.0 && v_uv.x <= 1.0
        && v_uv.y >= 0.0 && v_uv.y <= 1.0) {
        vec3 photo = texture(u_ortho, v_uv).rgb;
        albedo = mix(v_albedo, photo, u_photoOpacityGround * photoFacing);
    }
    vec3 ambient = albedo * 0.35;
    vec3 diffuse = albedo * (0.75 * v_diff) * u_sunColor;
    vec3 lit = ambient + diffuse * s;
    // Éclairage neutre (soleil désactivé) : direction fixe douce + plancher
    // ambiant élevé → relief toujours lisible. Les ombres portées (s) peuvent
    // s'appliquer même sans soleil — la shadow map suit alors la direction fixe.
    vec3 neutral = albedo * (0.2 + 0.8 * v_flatDiff * s);
    fragColor = vec4(mix(lit, neutral, u_flatLight), v_alpha);
    fragDepth = v_depth;
}
