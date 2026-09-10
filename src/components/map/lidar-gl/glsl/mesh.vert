#version 300 es
// Pass 1 — render the ground mesh into the same FBO as the points.
//
// The mesh can receive an IGN orthophoto texture draped in nadir projection
// (top-down view). The base albedo (palette colour) and the photo are blended
// in the fragment shader according to `u_photoOpacity`, then lit by the same
// ambient/diffuse + shadow model as the points. To be able to blend the albedo
// *before* lighting, the raw albedo (v_albedo) is passed through instead of
// pre-computed ambient/diffuse terms.
//
// Lighting itself is resolved PER FRAGMENT (mesh.frag): this shader only passes
// the normal along. That is the prerequisite for perturbing it at pixel scale
// (blend with the geometric normal, micro-relief) — a diffuse term
// pre-computed per vertex would leave nothing to perturb.
precision highp float;

#include ./lib/palette.glsl;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
// Encoded MACRO normal (v * 127.5 + 127.5), read normalized hence in [0,1]:
// this is the terrain orientation at decametric scale, the only one the palette
// may look at. See `macroVertexNormals` in pipeline.ts.
layout(location = 2) in vec3 a_macro;
layout(location = 3) in float a_base; // 1 = synthetic base wall (to be hatched)

uniform mat4 u_matrix;
uniform float u_mpu;
uniform mat4 u_lightMatrix;
uniform vec4 u_uvRect;   // (eMin, nMin, eMax, nMax) in offset metres
uniform vec4 u_uvRectFine; // idem for the view-sized detail mosaic
// Delaunay/Mixed meshes have no macro-normal field: the lighting normal is then
// used as a fallback, as on the CPU side.
uniform float u_hasMacro;
uniform int u_palettePreset;  // 0 = Mono, 1 = Terrain, 2 = Pente
uniform int u_rockType;       // 0 = limestone, 1 = granite, 2 = schist
uniform float u_snowLine;
uniform float u_snowAmount;
// Eye position in the SAME space as `pos` (Mercator units relative to the cloud
// origin, Y flipped) — reconstructed from the matrix by `cameraFromMatrix()`.
// Divided by u_mpu, the distance becomes metric.
uniform vec3 u_camPos;

out vec3 v_albedo;
out vec3 v_normal; // interpolated normal (east/north/up frame), per-fragment lighting
out vec2 v_uv;
out vec2 v_uvFine;
out vec4 v_lightPos;
out float v_depth;
out float v_distM;      // camera→fragment distance in metres (aerial perspective)
out float v_alpha;
out float v_base;
out vec3 v_wpos;   // world position (metres east/north/z) for mesh-anchored hatching
out vec3 v_view;   // fragment → eye, metres, same frame as v_wpos (specular lobe)
out float v_snow;  // snow ratio painted by the palette, in [0,1]

// Nadir planar projection of a world position into a mosaic's UV space: u
// follows east, v follows north. The first row of the texture corresponds to
// north (top), hence the vertical flip.
vec2 nadirUv(vec2 p, vec4 rect) {
    return vec2((p.x - rect.x) / (rect.z - rect.x), (rect.w - p.y) / (rect.w - rect.y));
}

void main() {
    vec3 pos = vec3(a_pos.x * u_mpu, -a_pos.y * u_mpu, a_pos.z * u_mpu);
    gl_Position = u_matrix * vec4(pos, 1.0);
    v_depth = gl_Position.w;
    // gl_Position.w is NOT metric (MapLibre folds worldSize = 512·2^zoom into
    // it), hence the Euclidean eye distance converted to metres by u_mpu.
    v_distM = distance(pos, u_camPos) / max(u_mpu, 1e-20);
    // Not normalized: interpolation denormalizes it anyway, mesh.frag normalizes
    // once on the fragment side.
    v_normal = a_normal;
    v_base = a_base;
    v_wpos = a_pos;
    // u_camPos is in Mercator units, Y flipped (cf. `pos` above): bring it back
    // into the metric east/north/up frame of a_pos.
    vec3 camW = vec3(u_camPos.x, -u_camPos.y, u_camPos.z) / max(u_mpu, 1e-20);
    v_view = camW - a_pos;
    // a_pos.z is already the elevation in metres: the palette reads it directly.
    vec3 macro = mix(a_normal, a_macro * 2.0 - 1.0, u_hasMacro);
    vec4 pal = paletteAlbedo(macro, a_pos.z, u_palettePreset, u_snowLine, u_snowAmount, u_rockType);
    v_albedo = pal.rgb;
    v_snow = pal.a;
    v_alpha = 1.0;
    // Nadir planar projection: u follows east, v follows north. The first row of
    // the texture corresponds to north (top), hence the vertical flip.
    v_uv = nadirUv(a_pos.xy, u_uvRect);
    v_uvFine = nadirUv(a_pos.xy, u_uvRectFine);
    v_lightPos = u_lightMatrix * vec4(a_pos, 1.0);
}
