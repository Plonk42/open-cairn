#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_color;
uniform sampler2D u_depth;
// Real hardware NDC depth (0..1) accumulated across ALL LiDAR cloud/mesh
// layers this frame — NOT MapLibre's own depth buffer, so terrain (often
// imprecise) can never hide LiDAR. Used only to let a genuinely nearer cloud
// win over a farther one when they overlap on screen (see SharedLidarDepth /
// _writeSharedDepth in LidarWebGLLayer.ts).
uniform sampler2D u_sharedDepth;
uniform vec2 u_texelSize;
uniform float u_strength;   // QGIS-equivalent edlStrength (default ~1000)
uniform float u_radius;     // QGIS-equivalent edlDistance (in 2-pixel units)
uniform float u_farPlane;   // depth normalization, in same units as v_depth
uniform float u_aoStrength; // additional ambient-occlusion darkening (0 = off)
uniform float u_aoRadius;   // AO sampling radius, in 2-pixel units
uniform float u_opacity;    // overall layer opacity (0..1)
out vec4 fragColor;

// Port of QGIS 3D postprocess.frag::edlFactor (https://github.com/qgis/QGIS).
// 4 cardinal neighbors only; linear view-space depth normalized to [0,1].
// Center being *further* than a neighbor accumulates darkening, producing
// the characteristic black silhouettes around foreground point-cloud edges.
// The FBO depth attachment is cleared to 0, so 0 acts as the no-data sentinel
// (matches QGIS where depth==1.0 is no-data after re-mapping to 0).
const vec2 NB[4] = vec2[4](vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0));

// 8 neighbours (cardinals + diagonals) for the ambient-occlusion lobe — gives
// a smoother, less directional darkening than the 4-tap EDL kernel.
const vec2 NB8[8] = vec2[8](
    vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0),
    vec2(-0.707, -0.707), vec2(0.707, -0.707), vec2(-0.707, 0.707), vec2(0.707, 0.707)
);

float edlFactor() {
    // QGIS uses texelSize = 2.0 / textureSize, i.e. step unit = 2 pixels.
    vec2 step2 = 2.0 * u_texelSize;
    float centerDepth = texture(u_depth, v_uv).r / u_farPlane;

    // Tangent-plane compensation (same idea as aoFactor below): without it,
    // a smooth surface viewed obliquely darkens uniformly because every
    // down-slope neighbour is legitimately deeper. We estimate the local
    // depth gradient (dDepth/dPixel) via 1-pixel central differences and
    // subtract the plane-predicted depth from each neighbour, so EDL only
    // reacts to true relief / silhouettes — not to camera tilt.
    float dRight = texture(u_depth, v_uv + vec2(u_texelSize.x, 0.0)).r;
    float dLeft  = texture(u_depth, v_uv - vec2(u_texelSize.x, 0.0)).r;
    float dUp    = texture(u_depth, v_uv + vec2(0.0, u_texelSize.y)).r;
    float dDown  = texture(u_depth, v_uv - vec2(0.0, u_texelSize.y)).r;
    float gx = (dRight > 0.0 && dLeft > 0.0) ? (dRight - dLeft) * 0.5 / u_farPlane : 0.0;
    float gy = (dUp    > 0.0 && dDown > 0.0) ? (dUp    - dDown) * 0.5 / u_farPlane : 0.0;
    vec2 grad = vec2(gx, gy);

    float factor = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 offsetUv = u_radius * step2 * NB[i];
        vec2 nc = v_uv + offsetUv;
        float nd = texture(u_depth, nc).r / u_farPlane;
        if (nd != 0.0) {
            if (centerDepth == 0.0) {
                factor += 1.0;
            } else {
                vec2 offsetPx = offsetUv / u_texelSize;
                float ndExpected = centerDepth + dot(grad, offsetPx);
                factor += max(0.0, ndExpected - nd);
            }
        }
    }
    return factor / 4.0;
}

// Screen-space ambient occlusion (inspired by QGIS 3D's
// ssao_factor_render.frag, simplified to a single-pass 2D-disk variant).
//
// Key differences from EDL:
//  • 24 jittered samples on a golden-angle spiral (vs EDL's 4 cardinal taps).
//  • Per-pixel rotation hash → no directional bias, smooth without blur.
//  • Smooth range check → only "nearby" occluders count, so distant background
//    edges don't bleed darkness over foreground geometry (this is what made
//    our earlier 8-tap version look like just-stronger-EDL).
//  • Radius is perspective-scaled by 1/centerDepth, so the AO lobe is roughly
//    constant in world units across the scene.
//
// Result: a cavity/concavity darkening that complements EDL's silhouettes —
// valleys and recesses get filled with shadow, flat surfaces stay bright.
const int AO_SAMPLES = 24;

float hash12(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract((p.x + p.y) * p.x);
}

float aoFactor() {
    if (u_aoStrength <= 0.0) return 0.0;
    float centerDepthRaw = texture(u_depth, v_uv).r;
    if (centerDepthRaw <= 0.0) return 0.0;
    float centerDepth = centerDepthRaw / u_farPlane;

    // --- Tangent-plane (slope) compensation -------------------------------
    // Without this, an obliquely-viewed flat surface darkens dramatically:
    // samples down-slope have legitimately greater depth than the centre and
    // get counted as occluders even though there's no cavity. We estimate the
    // local depth gradient (dDepth / dPixel) via central differences, then for
    // every disk sample we subtract the depth difference the tangent plane
    // alone would predict. Only deviations from the plane contribute to AO.
    float dRight = texture(u_depth, v_uv + vec2(u_texelSize.x, 0.0)).r;
    float dLeft  = texture(u_depth, v_uv - vec2(u_texelSize.x, 0.0)).r;
    float dUp    = texture(u_depth, v_uv + vec2(0.0, u_texelSize.y)).r;
    float dDown  = texture(u_depth, v_uv - vec2(0.0, u_texelSize.y)).r;
    // Per-pixel gradient in normalized depth units. Guard against no-data
    // (0.0) and against large discontinuities (edges) by using the smaller
    // one-sided difference whose magnitude is more plausible.
    float gx = 0.0;
    if (dRight > 0.0 && dLeft > 0.0) {
        gx = (dRight - dLeft) * 0.5 / u_farPlane;
    }
    float gy = 0.0;
    if (dUp > 0.0 && dDown > 0.0) {
        gy = (dUp - dDown) * 0.5 / u_farPlane;
    }
    vec2 grad = vec2(gx, gy);

    // Per-pixel rotation, breaks the banding that fixed sample directions cause.
    float ang = hash12(gl_FragCoord.xy) * 6.28318;
    float ca = cos(ang);
    float sa = sin(ang);
    mat2 rot = mat2(ca, -sa, sa, ca);

    // Perspective-scaled screen radius: u_aoRadius is "px×2 at unit depth".
    // We invert depth so closer geometry gets a larger search kernel,
    // approximating QGIS's world-space radius without needing a view matrix.
    vec2 step2 = 2.0 * u_texelSize;
    float pxScale = u_aoRadius / max(centerDepth, 0.002);
    // Range over which a depth difference counts as an occluder.
    // Narrow band → only nearby surfaces, like QGIS's range-check smoothstep.
    float range = 0.05;

    float occlusion = 0.0;
    float weightSum = 0.0;
    for (int i = 0; i < AO_SAMPLES; i++) {
        float t = (float(i) + 0.5) / float(AO_SAMPLES);
        // Square-root for uniform disk distribution; golden-angle for spiral.
        float r = sqrt(t);
        float theta = t * 6.28318 * 7.0;
        vec2 dir = rot * vec2(cos(theta), sin(theta));
        vec2 offsetUv = dir * r * pxScale * step2;
        vec2 uv = v_uv + offsetUv;
        float sd = texture(u_depth, uv).r;
        if (sd <= 0.0) continue;
        float dz = centerDepth - sd / u_farPlane;
        // Expected dz on the local tangent plane at this offset (in pixels):
        //   sample_plane = centre + grad · offsetPx
        //   dz_plane     = centre - sample_plane = -grad · offsetPx
        vec2 offsetPx = offsetUv / u_texelSize;
        float dzPlane = -dot(grad, offsetPx);
        float dzDev = dz - dzPlane;
        // Smooth band on the *deviation* from the tangent plane.
        // Symmetric clamp lets us ignore both pure slope and far background.
        float w = smoothstep(0.0, range * 0.5, dzDev)
                * (1.0 - smoothstep(range * 0.5, range, dzDev));
        occlusion += w;
        weightSum += 1.0;
    }
    return weightSum > 0.0 ? occlusion / weightSum : 0.0;
}

void main() {
    vec4 color = texture(u_color, v_uv);
    if (color.a == 0.0) discard;
    // Cloud-vs-cloud occlusion only (never vs. terrain): if a NEARER cloud
    // already claimed this pixel this frame, let it win instead of painting
    // over it — order-independent regardless of which LidarWebGLLayer
    // instance MapLibre happens to render first/last.
    float ownDepth = texture(u_depth, v_uv).g;
    float nearestDepth = texture(u_sharedDepth, v_uv).r;
    if (ownDepth > nearestDepth + 1e-6) discard;
    float shade = exp(-edlFactor() * u_strength) * exp(-aoFactor() * u_aoStrength);
    fragColor = vec4(color.rgb * shade, color.a * u_opacity);
}
