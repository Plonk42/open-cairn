#version 300 es
precision highp float;

in vec2 v_corner;

uniform vec4 u_color;  // straight (non-premultiplied) RGBA
uniform float u_ring;  // 0 = filled disc, >0 = ring of that half-thickness

out vec4 fragColor;

void main() {
    float r = length(v_corner);
    float aa = fwidth(r);
    float alpha = u_ring > 0.0
        // Hollow outline: used where terrain hides the sun, so the disc's
        // position stays legible without pretending it is visible.
        ? (1.0 - smoothstep(u_ring, u_ring + aa, abs(r - 1.0 + u_ring)))
        : (1.0 - smoothstep(1.0 - aa, 1.0, r));
    if (alpha <= 0.0) discard;
    float a = u_color.a * alpha;
    fragColor = vec4(u_color.rgb * a, a);
}
