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
layout(location = 3) in float a_base; // 1 = mur du socle synthétique (à hachurer)

uniform mat4 u_matrix;
uniform float u_mpu;
uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform mat4 u_lightMatrix;
uniform vec4 u_uvRect;   // (eMin, nMin, eMax, nMax) en mètres-offset
// Position de l'œil dans le MÊME espace que `pos` (unités Mercator relatives à
// l'origine du nuage, Y inversé) — reconstruite depuis la matrice par
// `cameraFromMatrix()`. Divisée par u_mpu, la distance devient métrique.
uniform vec3 u_camPos;

out vec3 v_albedo;
// N·L NON repliés : le maillage est dessiné deux faces, et mesh.frag retourne
// la normale vers l'œil avant de replier (voir gl_FrontFacing là-bas).
out float v_ndotl;
out float v_flatNdotl;
out vec2 v_uv;
out vec4 v_lightPos;
out float v_depth;
out float v_distM;      // distance caméra→fragment en mètres (perspective aérienne)
out float v_alpha;
out float v_up;
out float v_base;
out vec3 v_wpos;   // position monde (mètres est/nord/z) pour hachures ancrées au mesh

#include ./lib/flatLight.glsl;

void main() {
    vec3 pos = vec3(a_pos.x * u_mpu, -a_pos.y * u_mpu, a_pos.z * u_mpu);
    gl_Position = u_matrix * vec4(pos, 1.0);
    v_depth = gl_Position.w;
    // gl_Position.w n'est PAS métrique (MapLibre y replie worldSize = 512·2^zoom),
    // d'où la distance euclidienne à l'œil ramenée en mètres par u_mpu.
    v_distM = distance(pos, u_camPos) / max(u_mpu, 1e-20);
    vec3 n = normalize(a_normal);
    v_ndotl = dot(n, u_sunDir) * u_sunIntensity;
    v_flatNdotl = dot(n, normalize(FLAT_LIGHT_DIR));
    // Composante « vers le haut » de la normale (frame est/nord/up) : +1 face
    // au ciel, -1 face au sol. Sert à ne pas draper la photo nadir sur les
    // surfaces orientées vers le bas (fond fermé « fantôme » du mesh Poisson,
    // dessous de surplombs/grottes).
    v_up = n.z;
    v_base = a_base;
    v_wpos = a_pos;
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
