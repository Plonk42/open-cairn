#version 300 es
precision highp float;

in float v_arc;

uniform vec4 u_color;    // straight (non-premultiplied) RGBA
uniform float u_dashDeg; // dash period in degrees of arc; 0 = solid

out vec4 fragColor;

void main() {
    if (u_dashDeg > 0.0 && fract(v_arc / u_dashDeg) > 0.5) discard;
    fragColor = vec4(u_color.rgb * u_color.a, u_color.a);
}
