#version 300 es
// Sun track / tick marks — a polyline of directions at INFINITY.
//
// Two things make this work:
//   1. `u_matrix` is MapLibre's projection pre-translated to the eye, so the
//      input vector is a pure direction. Every point of the ray leaving the eye
//      projects to the same pixel, which is why the (arbitrary) 1-unit length of
//      the direction vector cancels out entirely.
//   2. `gl_Position.z` is pinned to `w` (the skybox trick), putting the track on
//      the far plane so the depth test alone decides what a ridge hides.
precision highp float;

layout(location = 0) in vec3 a_dirA;   // segment start, unit ENU (x=east, y=north, z=up)
layout(location = 1) in vec3 a_dirB;   // segment end
layout(location = 2) in float a_at;    // 0 = at A, 1 = at B
layout(location = 3) in float a_side;  // -1 / +1, which side of the line to expand to
layout(location = 4) in float a_arc;   // degrees walked along the track, for dashes

uniform mat4 u_matrix;
uniform vec2 u_halfRes;     // canvas size / 2, device pixels
uniform float u_halfWidth;  // line half-width, device pixels

out float v_arc;

// ENU → MapLibre mercator axes: y grows SOUTH, hence the negation. Same
// convention as the LiDAR layer's vertex shaders.
vec4 clipOf(vec3 enu) {
    return u_matrix * vec4(enu.x, -enu.y, enu.z, 1.0);
}

void main() {
    v_arc = a_arc;

    vec4 ca = clipOf(a_dirA);
    vec4 cb = clipOf(a_dirB);
    // A segment straddling the camera plane would blow up the perspective
    // divide. It is always off-screen (90° off the view axis), so drop it.
    if (ca.w <= 0.0 || cb.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    vec2 pa = ca.xy / ca.w * u_halfRes;
    vec2 pb = cb.xy / cb.w * u_halfRes;
    vec2 d = pb - pa;
    float len = length(d);
    vec2 nrm = len > 1e-6 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);

    vec4 c = mix(ca, cb, a_at);
    vec2 p = mix(pa, pb, a_at) + nrm * (a_side * u_halfWidth);
    gl_Position = vec4(p / u_halfRes * c.w, c.w * 0.9999, c.w);
}
