#version 300 es
// Pass 1 — render the ground mesh into the same FBO as the points.
//
// Le mesh peut recevoir une texture orthophoto IGN drapée en projection nadir
// (vue de dessus). L'albédo de base (couleur de palette) et la photo sont
// mélangés dans le fragment shader selon `u_photoOpacity`, puis éclairés par le
// même modèle ambient/diffus + ombres que les points. Pour pouvoir mélanger
// l'albédo *avant* l'éclairage, on transmet l'albédo brut (v_albedo) et le
// facteur diffus scalaire (v_diff) au lieu des termes ambient/diffus pré-calculés.
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;

uniform mat4 u_matrix;
uniform float u_mpu;
uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform mat4 u_lightMatrix;
uniform vec4 u_uvRect;   // (eMin, nMin, eMax, nMax) en mètres-offset

out vec3 v_albedo;
out float v_diff;
out float v_flatDiff;
out vec2 v_uv;
out vec4 v_lightPos;
out float v_depth;
out float v_alpha;
out float v_up;

#include ./lib/flatLight.glsl;

void main() {
    vec3 pos = vec3(a_pos.x * u_mpu, -a_pos.y * u_mpu, a_pos.z * u_mpu);
    gl_Position = u_matrix * vec4(pos, 1.0);
    v_depth = gl_Position.w;
    vec3 n = normalize(a_normal);
    v_diff = max(0.0, dot(n, u_sunDir)) * u_sunIntensity;
    // Éclairage neutre : wrap-lighting doux → relief lisible sans dureté.
    v_flatDiff = dot(n, normalize(FLAT_LIGHT_DIR)) * 0.5 + 0.5;
    // Composante « vers le haut » de la normale (frame est/nord/up) : +1 face
    // au ciel, -1 face au sol. Sert à ne pas draper la photo nadir sur les
    // surfaces orientées vers le bas (fond fermé « fantôme » du mesh Poisson,
    // dessous de surplombs/grottes).
    v_up = n.z;
    v_albedo = a_color.rgb;
    v_alpha = a_color.a;
    // Projection planaire nadir : u suit l'est, v suit le nord. La première
    // ligne de la texture correspond au nord (haut), d'où le flip vertical.
    v_uv = vec2(
        (a_pos.x - u_uvRect.x) / (u_uvRect.z - u_uvRect.x),
        (u_uvRect.w - a_pos.y) / (u_uvRect.w - u_uvRect.y)
    );
    v_lightPos = u_lightMatrix * vec4(a_pos, 1.0);
}
