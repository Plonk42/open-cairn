/**
 * WebGL2 GLSL shaders + program helpers for the LiDAR point-cloud layer.
 * Extracted from LidarWebGLLayer.ts (pure strings + compile/link, no DOM).
 */


// ─────────────────────────────────────────────────────────────────────────────
// Shaders for rendering points to FBO (pass 1)
//
// Lighting decomposition: each vertex emits its ambient term and its diffuse
// term separately. The fragment shader recombines them as
//     final = v_ambient + v_diffuse * shadowFactor
// where shadowFactor ∈ [0,1] comes from sampling the shadow map. Splitting
// ambient/diffuse this way lets cast shadows darken only the lit portion of
// the surface (so shaded sides remain legible).
// ─────────────────────────────────────────────────────────────────────────────
export const VS_POINTS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;      // (x, y, z) in meters: x=east, y=north, z=up
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_class;   // LAS classification (0..255), unnormalized

uniform mat4 u_matrix;     // Pre-translated matrix (includes origin translation)
uniform float u_mpu;       // meters per Mercator unit
uniform float u_ps;        // point size
uniform uint u_classMask[8];
uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform mat4 u_lightMatrix;   // world-meters → light-clip space
uniform vec4 u_uvRect;        // (eMin, nMin, eMax, nMax) en mètres-offset

out vec3 v_albedo;
out float v_diff;
out float v_flatDiff;
out vec2 v_uv;
out vec4 v_lightPos;
out float v_depth;
out float v_alpha;

// Direction fixe (vers la lumière) de l'éclairage neutre : nord-ouest, 45°
// au-dessus de l'horizon (frame est/nord/up). Convention cartographique
// classique d'ombrage de relief — indépendante de la position du soleil.
const vec3 FLAT_LIGHT_DIR = vec3(-0.5, 0.5, 0.7071);

void main() {
    uint c = uint(a_class);
    uint word = c >> 5u;
    uint bit  = c & 31u;
    if ((u_classMask[word] & (1u << bit)) == 0u) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        v_albedo = vec3(0.0);
        v_diff = 0.0;
        v_flatDiff = 0.0;
        v_uv = vec2(-1.0);
        v_lightPos = vec4(0.0);
        v_depth = 0.0;
        v_alpha = 0.0;
        return;
    }

    vec3 pos = vec3(
        a_pos.x * u_mpu,
        -a_pos.y * u_mpu,
        a_pos.z * u_mpu
    );
    gl_Position = u_matrix * vec4(pos, 1.0);
    gl_PointSize = max(u_ps, 1.0);
    v_depth = gl_Position.w;

    vec3 nrm = normalize(a_normal);
    v_diff = max(0.0, dot(nrm, u_sunDir)) * u_sunIntensity;
    // Éclairage neutre : wrap-lighting doux (le terme négatif est replié pour
    // que les faces opposées restent éclairées) → relief lisible sans dureté.
    v_flatDiff = dot(nrm, normalize(FLAT_LIGHT_DIR)) * 0.5 + 0.5;
    v_albedo = a_color.rgb;
    v_alpha = a_color.a;
    // Projection planaire nadir (vue de dessus) identique au mesh : permet de
    // draper l'orthophoto sur les points (végétation, bâti, …).
    v_uv = vec2(
        (a_pos.x - u_uvRect.x) / (u_uvRect.z - u_uvRect.x),
        (u_uvRect.w - a_pos.y) / (u_uvRect.w - u_uvRect.y)
    );

    // a_pos is east/north/up in meters — same frame as the light matrix.
    v_lightPos = u_lightMatrix * vec4(a_pos, 1.0);
}`;

export const FS_POINTS = /* glsl */`#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_diff;
in float v_flatDiff;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_alpha;
uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
uniform sampler2D u_shadowMap;
uniform float u_shadowEnabled;   // 0 or 1
uniform float u_shadowBias;
uniform vec2 u_shadowTexel;      // 1/shadowMapSize (x,y)
uniform float u_shadowStrength;  // 0..1, how dark cast shadows are
uniform sampler2D u_ortho;       // mosaïque orthophoto IGN (unité texture 3)
uniform float u_photoOpacity;    // 0..1, force du drapage photo
uniform float u_hasPhoto;        // 0 ou 1, texture photo disponible
layout(location = 0) out vec4 fragColor;
layout(location = 1) out float fragDepth;

float sampleShadow() {
    if (u_shadowEnabled < 0.5) return 1.0;
    // Perspective divide (light projection is ortho so w==1, but be safe).
    vec3 lp = v_lightPos.xyz / v_lightPos.w;
    // Light NDC ∈ [-1,1] → texture uv ∈ [0,1] and reference depth ∈ [0,1].
    vec3 luv = lp * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0 || luv.z > 1.0) {
        return 1.0;
    }
    float ref = luv.z - u_shadowBias;
    // 3×3 PCF for a soft penumbra.
    float sum = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * u_shadowTexel;
            float d = texture(u_shadowMap, luv.xy + off).r;
            sum += (ref <= d) ? 1.0 : 0.0;
        }
    }
    float visible = sum / 9.0;
    // Blend toward fully lit by (1 - strength) so a strength of 1 gives
    // hard cast shadows and strength 0 disables them.
    return mix(1.0, visible, u_shadowStrength);
}

void main() {
    float s = sampleShadow();
    vec3 albedo = v_albedo;
    // Drapage photo uniquement à l'intérieur de l'emprise de la mosaïque.
    if (u_hasPhoto > 0.5
        && v_uv.x >= 0.0 && v_uv.x <= 1.0
        && v_uv.y >= 0.0 && v_uv.y <= 1.0) {
        vec3 photo = texture(u_ortho, v_uv).rgb;
        albedo = mix(v_albedo, photo, u_photoOpacity);
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
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Shaders for rendering the ground mesh into the same FBO as the points.
// Sharing the FBO (color + depth + linear-depth MRT) guarantees correct
// depth ordering between mesh and points, and lets the EDL composite shade
// the whole thing uniformly. MRT output convention matches FS_POINTS.
// ─────────────────────────────────────────────────────────────────────────────
// Le mesh peut recevoir une texture orthophoto IGN drapée en projection nadir
// (vue de dessus). L'albédo de base (couleur de palette) et la photo sont
// mélangés dans le fragment shader selon `u_photoOpacity`, puis éclairés par le
// même modèle ambient/diffus + ombres que les points. Pour pouvoir mélanger
// l'albédo *avant* l'éclairage, on transmet l'albédo brut (v_albedo) et le
// facteur diffus scalaire (v_diff) au lieu des termes ambient/diffus pré-calculés.
export const VS_MESH = /* glsl */`#version 300 es
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

// Direction fixe (vers la lumière) de l'éclairage neutre : nord-ouest, 45°.
const vec3 FLAT_LIGHT_DIR = vec3(-0.5, 0.5, 0.7071);

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
}`;

export const FS_MESH = /* glsl */`#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_diff;
in float v_flatDiff;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_alpha;
in float v_up;
uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
uniform sampler2D u_shadowMap;
uniform float u_shadowEnabled;   // 0 ou 1
uniform float u_shadowBias;
uniform vec2 u_shadowTexel;      // 1/shadowMapSize (x,y)
uniform float u_shadowStrength;  // 0..1
uniform sampler2D u_ortho;       // mosaïque orthophoto IGN (unité texture 3)
uniform float u_photoOpacity;    // 0..1, force du drapage photo
uniform float u_hasPhoto;        // 0 ou 1, texture photo disponible
layout(location = 0) out vec4 fragColor;
layout(location = 1) out float fragDepth;

float sampleShadow() {
    if (u_shadowEnabled < 0.5) return 1.0;
    vec3 lp = v_lightPos.xyz / v_lightPos.w;
    vec3 luv = lp * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0 || luv.z > 1.0) {
        return 1.0;
    }
    float ref = luv.z - u_shadowBias;
    float sum = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * u_shadowTexel;
            float d = texture(u_shadowMap, luv.xy + off).r;
            sum += (ref <= d) ? 1.0 : 0.0;
        }
    }
    float visible = sum / 9.0;
    return mix(1.0, visible, u_shadowStrength);
}

void main() {
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
        albedo = mix(v_albedo, photo, u_photoOpacity * photoFacing);
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
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Depth-only shadow pass: project mesh vertices into the sun's ortho view.
// The framebuffer attaches only a depth texture; we sample it later with PCF.
// ─────────────────────────────────────────────────────────────────────────────
export const VS_SHADOW = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat4 u_lightMatrix;
void main() {
    gl_Position = u_lightMatrix * vec4(a_pos, 1.0);
}`;

export const FS_SHADOW = /* glsl */`#version 300 es
precision highp float;
void main() {}`;

// ─────────────────────────────────────────────────────────────────────────────
// Shaders for EDL post-processing (pass 2)
// ─────────────────────────────────────────────────────────────────────────────
export const VS_QUAD = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FS_EDL = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_color;
uniform sampler2D u_depth;
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
    float shade = exp(-edlFactor() * u_strength) * exp(-aoFactor() * u_aoStrength);
    fragColor = vec4(color.rgb * shade, color.a * u_opacity);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(s) ?? 'unknown';
        gl.deleteShader(s);
        throw new Error(`Shader compile:\n${info}`);
    }
    return s;
}

export function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
    const v = compileShader(gl, gl.VERTEX_SHADER, vs);
    const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Program link:\n${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
}
