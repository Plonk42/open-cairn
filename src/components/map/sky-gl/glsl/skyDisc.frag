#version 300 es
precision highp float;

in vec2 v_corner;

uniform vec4 u_color;  // straight (non-premultiplied) RGBA
uniform float u_ring;  // 0 = filled disc, >0 = ring of that half-thickness
uniform float u_phase; // illuminated fraction, 1 = full (the sun, always)
uniform vec2 u_limb;   // disc-plane direction of the lit limb, unit

out vec4 fragColor;

/** How dark the unlit part is left — enough to read the disc, not to mislead. */
const float EARTHSHINE = 0.13;

/**
 * How lit is this point of the disc?
 *
 * The terminator is a great circle of the sphere, so it projects to a
 * half-ellipse: on axes where +x points at the lit limb, the boundary is
 * x = (1 - 2k)·sqrt(1 - y²). k = 1 (full) puts it at -sqrt(1-y²), the dark
 * limb, so everything is lit; k = 0 puts it at +sqrt(1-y²) and nothing is.
 */
float litAmount(vec2 p) {
    if (u_phase >= 0.999) return 1.0;
    float x = dot(p, u_limb);
    float y = dot(p, vec2(-u_limb.y, u_limb.x));
    float edge = (1.0 - 2.0 * u_phase) * sqrt(max(0.0, 1.0 - y * y));
    // Antialias across the terminator, which runs nearly tangent to the pixel
    // grid near the cusps of a thin crescent.
    float aa = max(fwidth(x), 1e-4);
    return smoothstep(edge - aa, edge + aa, x);
}

void main() {
    float r = length(v_corner);
    float aa = fwidth(r);
    float alpha = u_ring > 0.0
        // Hollow outline: used where terrain hides the body, so its position
        // stays legible without pretending it is visible.
        ? (1.0 - smoothstep(u_ring, u_ring + aa, abs(r - 1.0 + u_ring)))
        : (1.0 - smoothstep(1.0 - aa, 1.0, r));
    if (alpha <= 0.0) discard;
    alpha *= mix(EARTHSHINE, 1.0, litAmount(v_corner));
    float a = u_color.a * alpha;
    fragColor = vec4(u_color.rgb * a, a);
}
