/**
 * MapLibre CustomLayerInterface — WebGL2 point cloud with optional EDL.
 * Properly saves and restores GL state.
 */

import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';

// ─────────────────────────────────────────────────────────────────────────────
// Shaders for rendering points to FBO (pass 1)
// ─────────────────────────────────────────────────────────────────────────────
const VS_POINTS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;      // (x, y, z) in meters: x=east, y=north, z=up
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_class;   // LAS classification (0..255), unnormalized

uniform mat4 u_matrix;     // Pre-translated matrix (includes origin translation)
uniform float u_mpu;       // meters per Mercator unit
uniform float u_ps;        // point size
// 256-bit class visibility mask, one bit per LAS class. Bit i of word w (=i>>5)
// is 1 iff class (32*w + i&31) is visible. Set by setClassMask() — lets the
// user toggle classes on/off without re-fetching the cloud.
uniform uint u_classMask[8];

out vec4 v_color;
out float v_depth;
const vec3 SUN = vec3(0.4472, 0.5367, 0.7155);

void main() {
    // Cheap GPU-side LAS-class filter: discard the point if its bit is unset.
    uint c = uint(a_class);
    uint word = c >> 5u;
    uint bit  = c & 31u;
    if ((u_classMask[word] & (1u << bit)) == 0u) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space → culled
        gl_PointSize = 0.0;
        v_color = vec4(0.0);
        v_depth = 0.0;
        return;
    }

    // Position in Mercator-offset space (relative to origin, baked into matrix)
    vec3 pos = vec3(
        a_pos.x * u_mpu,
        -a_pos.y * u_mpu,
        a_pos.z * u_mpu
    );
    
    // Transform through pre-translated matrix
    gl_Position = u_matrix * vec4(pos, 1.0);
    gl_PointSize = max(u_ps, 1.0);

    // Linear view-space depth (clip-space w == -z_view for std. perspective).
    // This matches QGIS 3D EDL which uses linearizeDepth(...)/farPlane.
    // Units are the same as the post-projection w (Mercator units * matrix).
    v_depth = gl_Position.w;
    
    // Normal-based lighting
    float diff = max(0.0, dot(normalize(a_normal), SUN));
    v_color = vec4(a_color.rgb * (0.4 + 0.6 * diff), a_color.a);
}`;

const FS_POINTS = /* glsl */`#version 300 es
precision highp float;
in vec4 v_color;
in float v_depth;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out float fragDepth;
void main() {
    fragColor = v_color;
    fragDepth = v_depth;
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Shaders for EDL post-processing (pass 2)
// ─────────────────────────────────────────────────────────────────────────────
const VS_QUAD = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS_EDL = /* glsl */`#version 300 es
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
    float factor = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 nc = v_uv + u_radius * step2 * NB[i];
        float nd = texture(u_depth, nc).r / u_farPlane;
        if (nd != 0.0) {
            if (centerDepth == 0.0) factor += 1.0;
            else factor += max(0.0, centerDepth - nd);
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
        vec2 uv = v_uv + dir * r * pxScale * step2;
        float sd = texture(u_depth, uv).r;
        if (sd <= 0.0) continue;
        float dz = centerDepth - sd / u_farPlane;
        // Smooth band: ramps up from 0 at dz≈0 to 1 around range/2,
        // back to 0 by dz=range. Avoids hard "halo" rings.
        float w = smoothstep(0.0, range * 0.5, dz)
                * (1.0 - smoothstep(range * 0.5, range, dz));
        occlusion += w;
        weightSum += 1.0;
    }
    return weightSum > 0.0 ? occlusion / weightSum : 0.0;
}

void main() {
    vec4 color = texture(u_color, v_uv);
    if (color.a == 0.0) discard;
    float shade = exp(-edlFactor() * u_strength) * exp(-aoFactor() * u_aoStrength);
    fragColor = vec4(color.rgb * shade, color.a);
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

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
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

export interface LidarWebGLLayerConfig {
    pointSize: number;
    /**
     * When true, `pointSize` is interpreted as the size at `referenceZoom`,
     * and is scaled up as the user zooms out so the cloud always reads as a
     * dense surface (QGIS-style behaviour). When false, the size is constant
     * in screen pixels regardless of zoom.
     */
    adaptiveSize: boolean;
    /** Map zoom at which `pointSize` is applied verbatim. */
    referenceZoom: number;
    edlEnabled: boolean;
    edlStrength: number;
    edlRadius: number;
    edlFarPlane: number;
    /** Ambient occlusion intensity (0 disables the AO term). */
    aoStrength: number;
    /** Screen-space radius of the AO sampling kernel, in 2-pixel units. */
    aoRadius: number;
}

export class LidarWebGLLayer implements CustomLayerInterface {
    readonly id: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private _map: Map | null = null;
    private _gl: WebGL2RenderingContext | null = null;

    // Point rendering
    private _progPoints: WebGLProgram | null = null;
    private _vao: WebGLVertexArrayObject | null = null;
    private _posBuf: WebGLBuffer | null = null;
    private _norBuf: WebGLBuffer | null = null;
    private _colBuf: WebGLBuffer | null = null;
    private _clsBuf: WebGLBuffer | null = null;
    private _locPoints: {
        matrix: WebGLUniformLocation | null;
        mpu: WebGLUniformLocation | null;
        ps: WebGLUniformLocation | null;
        classMask: WebGLUniformLocation | null;
    } = { matrix: null, mpu: null, ps: null, classMask: null };

    /** 256-bit visibility mask (8 × uint32), index i = bit set ⇒ class i visible. */
    private readonly _classMask = new Uint32Array(8).fill(0xffffffff);

    // EDL post-processing
    private _progEdl: WebGLProgram | null = null;
    private _vaoQuad: WebGLVertexArrayObject | null = null;
    private _quadBuf: WebGLBuffer | null = null;
    private _fbo: WebGLFramebuffer | null = null;
    private _texColor: WebGLTexture | null = null;
    private _texDepth: WebGLTexture | null = null;
    private _rbDepth: WebGLRenderbuffer | null = null;
    private _fboWidth = 0;
    private _fboHeight = 0;
    private _locEdl: {
        color: WebGLUniformLocation | null;
        depth: WebGLUniformLocation | null;
        texelSize: WebGLUniformLocation | null;
        strength: WebGLUniformLocation | null;
        radius: WebGLUniformLocation | null;
        farPlane: WebGLUniformLocation | null;
        aoStrength: WebGLUniformLocation | null;
        aoRadius: WebGLUniformLocation | null;
    } = { color: null, depth: null, texelSize: null, strength: null, radius: null, farPlane: null, aoStrength: null, aoRadius: null };

    private _ox = 0;
    private _oy = 0;
    private _mpu = 0;
    private _count = 0;

    config: LidarWebGLLayerConfig = {
        pointSize: 2,
        adaptiveSize: true,
        referenceZoom: 19,
        edlEnabled: false,
        edlStrength: 8,
        edlRadius: 1,
        edlFarPlane: 1500,
        aoStrength: 0,
        aoRadius: 3,
    };

    constructor(id: string) {
        this.id = id;
    }

    onAdd(map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        console.log('[LidarWebGLLayer] onAdd');
        this._map = map;
        this._gl = gl as WebGL2RenderingContext;
        this._initGL(this._gl);
    }

    onRemove(_map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        console.log('[LidarWebGLLayer] onRemove');
        this._cleanup(gl as WebGL2RenderingContext);
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, _args: CustomRenderMethodInput): void {
        if (!this._count || !this._progPoints || !this._vao) {
            return;
        }
        const gl2 = gl as WebGL2RenderingContext;
        const args = _args;

        const matrix = args.defaultProjectionData?.mainMatrix;
        if (!matrix) return;

        // Pre-translate matrix by origin to avoid float32 precision loss in shader
        // M' = M * T(ox, oy, 0) — done in float64, then passed as float32
        const m = matrix;
        const translatedMatrix = new Float32Array([
            m[0], m[1], m[2], m[3],
            m[4], m[5], m[6], m[7],
            m[8], m[9], m[10], m[11],
            m[0] * this._ox + m[4] * this._oy + m[12],
            m[1] * this._ox + m[5] * this._oy + m[13],
            m[2] * this._ox + m[6] * this._oy + m[14],
            m[3] * this._ox + m[7] * this._oy + m[15],
        ]);

        const canvas = gl2.canvas as HTMLCanvasElement;
        const w = canvas.width;
        const h = canvas.height;

        // Save MapLibre's state
        const prevProg = gl2.getParameter(gl2.CURRENT_PROGRAM);
        const prevVAO = gl2.getParameter(gl2.VERTEX_ARRAY_BINDING);
        const prevFBO = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
        const prevBlend = gl2.isEnabled(gl2.BLEND);
        const prevDepthTest = gl2.isEnabled(gl2.DEPTH_TEST);

        // QGIS-style adaptive sizing: the configured pointSize is the size at
        // `referenceZoom`. Below it, points are enlarged so the cloud always
        // reads as a dense filled surface even when zoomed out. Above it, they
        // shrink (clamped to a 1 px minimum so they remain visible).
        // Square-root scaling per zoom level matches the change in screen-space
        // area each tile-zoom-step represents.
        const effectivePointSize = this._effectivePointSize();

        if (this.config.edlEnabled && this._fbo && this._progEdl) {
            // ─── Pass 1: Render points to FBO ───
            this._ensureFboSize(gl2, w, h);
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, this._fbo);
            gl2.viewport(0, 0, w, h);
            gl2.clearColor(0, 0, 0, 0);
            gl2.clearDepth(1);
            gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);

            gl2.useProgram(this._progPoints);
            // Enable depth test so nearer points correctly occlude farther ones
            // (otherwise points render in vertex order, producing see-through).
            gl2.enable(gl2.DEPTH_TEST);
            gl2.depthFunc(gl2.LEQUAL);
            gl2.depthMask(true);
            // Disable blending: R32F depth attachment cannot be alpha-blended
            // (its single channel has no alpha and would produce undefined/zero
            // results, breaking the EDL algorithm). Point colors are opaque.
            gl2.disable(gl2.BLEND);

            gl2.uniformMatrix4fv(this._locPoints.matrix, false, translatedMatrix);
            gl2.uniform1f(this._locPoints.mpu, this._mpu);
            gl2.uniform1f(this._locPoints.ps, effectivePointSize);
            gl2.uniform1uiv(this._locPoints.classMask, this._classMask);

            gl2.bindVertexArray(this._vao);
            gl2.drawArrays(gl2.POINTS, 0, this._count);

            // ─── Pass 2: Apply EDL and render to screen ───
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, prevFBO);
            gl2.viewport(0, 0, w, h);
            gl2.useProgram(this._progEdl);

            gl2.activeTexture(gl2.TEXTURE0);
            gl2.bindTexture(gl2.TEXTURE_2D, this._texColor);
            gl2.uniform1i(this._locEdl.color, 0);

            gl2.activeTexture(gl2.TEXTURE1);
            gl2.bindTexture(gl2.TEXTURE_2D, this._texDepth);
            gl2.uniform1i(this._locEdl.depth, 1);

            gl2.uniform2f(this._locEdl.texelSize, 1 / w, 1 / h);
            gl2.uniform1f(this._locEdl.strength, this.config.edlStrength);
            gl2.uniform1f(this._locEdl.radius, this.config.edlRadius);
            gl2.uniform1f(this._locEdl.farPlane, this.config.edlFarPlane);
            gl2.uniform1f(this._locEdl.aoStrength, this.config.aoStrength);
            gl2.uniform1f(this._locEdl.aoRadius, this.config.aoRadius);

            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

            gl2.bindVertexArray(this._vaoQuad);
            gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        } else if (this._fbo && this._progEdl) {
            // ─── Direct rendering (no EDL) ───
            // We still need to render into our own FBO so that point-vs-point
            // occlusion uses a private depth buffer (we cannot use MapLibre's
            // depth buffer because the terrain is offset from the cloud).
            // Then we composite the FBO color onto the screen using the EDL
            // program with strength=0 (identity pass-through that preserves
            // alpha, so terrain shows through outside the cloud).
            this._ensureFboSize(gl2, w, h);
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, this._fbo);
            gl2.viewport(0, 0, w, h);
            gl2.clearColor(0, 0, 0, 0);
            gl2.clearDepth(1);
            gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);

            gl2.useProgram(this._progPoints);
            gl2.enable(gl2.DEPTH_TEST);
            gl2.depthFunc(gl2.LEQUAL);
            gl2.depthMask(true);
            gl2.disable(gl2.BLEND);

            gl2.uniformMatrix4fv(this._locPoints.matrix, false, translatedMatrix);
            gl2.uniform1f(this._locPoints.mpu, this._mpu);
            gl2.uniform1f(this._locPoints.ps, effectivePointSize);
            gl2.uniform1uiv(this._locPoints.classMask, this._classMask);

            gl2.bindVertexArray(this._vao);
            gl2.drawArrays(gl2.POINTS, 0, this._count);

            // Composite FBO color back to MapLibre framebuffer (strength=0 ⇒ no EDL).
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, prevFBO);
            gl2.viewport(0, 0, w, h);
            gl2.useProgram(this._progEdl);

            gl2.activeTexture(gl2.TEXTURE0);
            gl2.bindTexture(gl2.TEXTURE_2D, this._texColor);
            gl2.uniform1i(this._locEdl.color, 0);

            gl2.activeTexture(gl2.TEXTURE1);
            gl2.bindTexture(gl2.TEXTURE_2D, this._texDepth);
            gl2.uniform1i(this._locEdl.depth, 1);

            gl2.uniform2f(this._locEdl.texelSize, 1 / w, 1 / h);
            gl2.uniform1f(this._locEdl.strength, 0);
            gl2.uniform1f(this._locEdl.radius, this.config.edlRadius);
            gl2.uniform1f(this._locEdl.farPlane, this.config.edlFarPlane);
            gl2.uniform1f(this._locEdl.aoStrength, this.config.aoStrength);
            gl2.uniform1f(this._locEdl.aoRadius, this.config.aoRadius);

            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

            gl2.bindVertexArray(this._vaoQuad);
            gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        } else {
            // ─── Fallback: no FBO available, render directly (legacy path) ───
            gl2.useProgram(this._progPoints);
            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

            gl2.uniformMatrix4fv(this._locPoints.matrix, false, translatedMatrix);
            gl2.uniform1f(this._locPoints.mpu, this._mpu);
            gl2.uniform1f(this._locPoints.ps, effectivePointSize);
            gl2.uniform1uiv(this._locPoints.classMask, this._classMask);

            gl2.bindVertexArray(this._vao);
            gl2.drawArrays(gl2.POINTS, 0, this._count);
        }

        // Restore state
        if (prevDepthTest) gl2.enable(gl2.DEPTH_TEST); else gl2.disable(gl2.DEPTH_TEST);
        if (prevBlend) gl2.enable(gl2.BLEND); else gl2.disable(gl2.BLEND);
        gl2.bindVertexArray(prevVAO);
        gl2.useProgram(prevProg);
    }

    /**
     * Compute the on-screen point size in pixels, optionally scaled by the
     * current map zoom (QGIS-style adaptive sizing).
     *
     * Rationale: IGN LiDAR HD is ~10 pts/m². At low zoom (zoomed out) many
     * points map to one pixel and the cloud already reads as a filled surface
     * with a 1 px dot. As the user zooms IN, inter-point screen distance
     * grows and gaps appear — so we enlarge the dots. Square-root scaling per
     * zoom step keeps the surface filled without exploding the size.
     */
    private _effectivePointSize(): number {
        const base = Math.max(this.config.pointSize, 0.5);
        if (!this.config.adaptiveSize || !this._map) return Math.max(base, 1);
        const zoom = this._map.getZoom();
        const dz = zoom - this.config.referenceZoom;
        const scale = Math.pow(2, dz * 0.5);
        return Math.min(16, Math.max(1, base * scale));
    }

    setData(
        positions: Float32Array,
        normals: Float32Array,
        colors: Uint8Array,
        classifications: Uint8Array,
        count: number,
        originLng: number,
        originLat: number,
    ): void {
        console.log('[LidarWebGLLayer] setData', { count, originLng, originLat });
        const mc = MercatorCoordinate.fromLngLat({ lng: originLng, lat: originLat });
        this._ox = mc.x;
        this._oy = mc.y;
        this._mpu = mc.meterInMercatorCoordinateUnits();
        this._count = count;

        const gl = this._gl;
        if (!gl) return;

        const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._norBuf);
        gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._colBuf);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._clsBuf);
        gl.bufferData(gl.ARRAY_BUFFER, classifications, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        gl.bindVertexArray(prevVAO);
        this._map?.triggerRepaint();
    }

    clear(): void {
        this._count = 0;
        this._map?.triggerRepaint();
    }

    setConfig(config: Partial<LidarWebGLLayerConfig>): void {
        Object.assign(this.config, config);
        this._map?.triggerRepaint();
    }

    /**
     * Set the LAS-class visibility filter. `visibleClasses` is the list of
     * class codes (0..255) that should be drawn; everything else is discarded
     * in the vertex shader. Empty array ⇒ everything hidden; pass null/undefined
     * (or omit) to show all classes.
     *
     * This is intentionally a render-side filter: no cloud re-fetch needed,
     * toggling classes is instant.
     */
    setClassMask(visibleClasses: number[] | null | undefined): void {
        this._classMask.fill(0);
        if (visibleClasses == null) {
            this._classMask.fill(0xffffffff);
        } else {
            for (const c of visibleClasses) {
                if (c < 0 || c > 255) continue;
                const word = c >>> 5;
                const bit = c & 31;
                this._classMask[word] |= 1 << bit;
            }
        }
        this._map?.triggerRepaint();
    }

    private _ensureFboSize(gl: WebGL2RenderingContext, w: number, h: number): void {
        if (this._fboWidth === w && this._fboHeight === h) return;
        this._fboWidth = w;
        this._fboHeight = h;

        // Resize color texture
        gl.bindTexture(gl.TEXTURE_2D, this._texColor);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Resize depth texture
        gl.bindTexture(gl.TEXTURE_2D, this._texDepth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);

        // Resize GL depth renderbuffer
        if (this._rbDepth) {
            gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbDepth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        }

        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private _initGL(gl: WebGL2RenderingContext): void {
        console.log('[LidarWebGLLayer] _initGL');

        // ─── Point shader ───
        this._progPoints = linkProgram(gl, VS_POINTS, FS_POINTS);
        this._locPoints = {
            matrix: gl.getUniformLocation(this._progPoints, 'u_matrix'),
            mpu: gl.getUniformLocation(this._progPoints, 'u_mpu'),
            ps: gl.getUniformLocation(this._progPoints, 'u_ps'),
            classMask: gl.getUniformLocation(this._progPoints, 'u_classMask[0]'),
        };

        // ─── Point buffers & VAO ───
        this._posBuf = gl.createBuffer();
        this._norBuf = gl.createBuffer();
        this._colBuf = gl.createBuffer();
        this._clsBuf = gl.createBuffer();

        const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        this._vao = gl.createVertexArray();
        gl.bindVertexArray(this._vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._norBuf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._colBuf);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        // a_class: uint8 read as un-normalized float (so 0..255 in shader).
        gl.bindBuffer(gl.ARRAY_BUFFER, this._clsBuf);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.bindVertexArray(prevVAO);

        // ─── EDL shader ───
        this._progEdl = linkProgram(gl, VS_QUAD, FS_EDL);
        this._locEdl = {
            color: gl.getUniformLocation(this._progEdl, 'u_color'),
            depth: gl.getUniformLocation(this._progEdl, 'u_depth'),
            texelSize: gl.getUniformLocation(this._progEdl, 'u_texelSize'),
            strength: gl.getUniformLocation(this._progEdl, 'u_strength'),
            radius: gl.getUniformLocation(this._progEdl, 'u_radius'),
            farPlane: gl.getUniformLocation(this._progEdl, 'u_farPlane'),
            aoStrength: gl.getUniformLocation(this._progEdl, 'u_aoStrength'),
            aoRadius: gl.getUniformLocation(this._progEdl, 'u_aoRadius'),
        };

        // ─── Fullscreen quad VAO ───
        this._quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1,
        ]), gl.STATIC_DRAW);

        this._vaoQuad = gl.createVertexArray();
        gl.bindVertexArray(this._vaoQuad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(prevVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // ─── FBO for EDL ───
        this._fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);

        this._texColor = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._texColor);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texColor, 0);

        this._texDepth = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._texDepth);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this._texDepth, 0);

        // Depth renderbuffer for proper occlusion (GL depth test) during pass 1.
        // Without it, points draw in vertex order regardless of camera distance,
        // producing a "see-through" effect where far points overwrite near ones.
        this._rbDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 1, 1);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._rbDepth);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);

        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private _cleanup(gl: WebGL2RenderingContext): void {
        if (this._vao) { gl.deleteVertexArray(this._vao); this._vao = null; }
        if (this._vaoQuad) { gl.deleteVertexArray(this._vaoQuad); this._vaoQuad = null; }
        if (this._posBuf) { gl.deleteBuffer(this._posBuf); this._posBuf = null; }
        if (this._norBuf) { gl.deleteBuffer(this._norBuf); this._norBuf = null; }
        if (this._colBuf) { gl.deleteBuffer(this._colBuf); this._colBuf = null; }
        if (this._clsBuf) { gl.deleteBuffer(this._clsBuf); this._clsBuf = null; }
        if (this._quadBuf) { gl.deleteBuffer(this._quadBuf); this._quadBuf = null; }
        if (this._progPoints) { gl.deleteProgram(this._progPoints); this._progPoints = null; }
        if (this._progEdl) { gl.deleteProgram(this._progEdl); this._progEdl = null; }
        if (this._texColor) { gl.deleteTexture(this._texColor); this._texColor = null; }
        if (this._texDepth) { gl.deleteTexture(this._texDepth); this._texDepth = null; }
        if (this._rbDepth) { gl.deleteRenderbuffer(this._rbDepth); this._rbDepth = null; }
        if (this._fbo) { gl.deleteFramebuffer(this._fbo); this._fbo = null; }
        this._count = 0;
        this._map = null;
        this._gl = null;
    }
}
