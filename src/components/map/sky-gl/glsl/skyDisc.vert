#version 300 es
// A body's disc — a billboard quad at infinity, sized to its TRUE angular
// radius so "the disc touches the ridge" is a judgement you can trust.
precision highp float;

layout(location = 0) in vec2 a_corner;  // -1..1 square

uniform mat4 u_matrix;
uniform vec3 u_dir;     // unit ENU direction towards the body
uniform vec3 u_right;   // unit, perpendicular to u_dir
uniform vec3 u_up;      // unit, perpendicular to both
uniform float u_radius; // tan(angular radius), possibly scaled up for the halo

out vec2 v_corner;

void main() {
    v_corner = a_corner;
    vec3 enu = u_dir + (a_corner.x * u_right + a_corner.y * u_up) * u_radius;
    vec4 c = u_matrix * vec4(enu.x, -enu.y, enu.z, 1.0);
    if (c.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    gl_Position = vec4(c.xy, c.w * 0.9999, c.w);
}
