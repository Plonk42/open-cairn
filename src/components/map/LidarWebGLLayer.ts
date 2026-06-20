]633;E;sed -n '1,6p' src/components/map/LidarWebGLLayer.ts;e6fd7438-80f4-4448-b030-4719ad0de016]633;C/**
 * MapLibre CustomLayerInterface — WebGL2 point cloud with optional EDL.
 * Properly saves and restores GL state.
 */

import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';
import {
    FS_EDL, FS_MESH, FS_POINTS, FS_SHADOW,
    linkProgram,
    VS_MESH, VS_POINTS, VS_QUAD, VS_SHADOW,
} from '@/components/map/lidar-gl/shaders';


type Bbox = { min: [number, number, number]; max: [number, number, number] };

// Browsers/GPUs cap the number of vertex IDs processed per draw call
// (Firefox enforces webgl.max-vert-ids-per-draw = 30 000 000). A max-density
// cloud over a large area can exceed this in a single draw, which silently
// truncates the geometry and emits a console warning. We split large draws
// into chunks comfortably below the cap.
const MAX_VERT_IDS_PER_DRAW = 24_000_000;

function computeBbox(positions: Float32Array): Bbox | null {
    if (positions.length < 3) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Build a column-major orthographic light-space VP matrix that maps an
 * (east, north, up) world point — in the same METER_OFFSETS frame as the mesh
 * vertices — to NDC ∈ [-1,1]³. The frustum is fitted to the supplied AABB,
 * oriented along the supplied sun direction (a unit vector pointing TOWARDS
 * the sun). With the AABB padded by a few meters on every side, every caster
 * inside the box is visible from the sun's POV and the depth resolution is
 * spent on the actual range of relief instead of a generic far plane.
 */
// Fixed neutral light direction — mirrors FLAT_LIGHT_DIR in the GLSL shaders
// (already unit length: 0.5²+0.5²+0.7071² ≈ 1). Used as the shadow caster
// direction when sun lighting is disabled, so cast shadows align with the
// neutral hillshade.
const FLAT_LIGHT_DIR: [number, number, number] = [-0.5, 0.5, 0.7071];

function buildLightMatrix(sunDir: [number, number, number], bbox: Bbox): Float32Array {
    // Camera basis: forward = -sunDir (looking from sun TOWARDS scene).
    const fx = -sunDir[0], fy = -sunDir[1], fz = -sunDir[2];
    // World-up; switch to (0,1,0) when the sun is near the zenith to avoid
    // a degenerate cross product.
    let wuy = 0, wuz = 1;
    if (Math.abs(sunDir[2]) > 0.95) { wuy = 1; wuz = 0; }
    // right = forward × up
    let rx = fy * wuz - fz * wuy;
    let ry = fz * 0 - fx * wuz;
    let rz = fx * wuy - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    // up = right × forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    // Project the 8 corners onto the (right, up, forward) basis to find the
    // tight ortho extents.
    const corners: [number, number, number][] = [
        [bbox.min[0], bbox.min[1], bbox.min[2]],
        [bbox.max[0], bbox.min[1], bbox.min[2]],
        [bbox.min[0], bbox.max[1], bbox.min[2]],
        [bbox.max[0], bbox.max[1], bbox.min[2]],
        [bbox.min[0], bbox.min[1], bbox.max[2]],
        [bbox.max[0], bbox.min[1], bbox.max[2]],
        [bbox.min[0], bbox.max[1], bbox.max[2]],
        [bbox.max[0], bbox.max[1], bbox.max[2]],
    ];
    let minR = Infinity, maxR = -Infinity;
    let minU = Infinity, maxU = -Infinity;
    let minF = Infinity, maxF = -Infinity;
    for (const [x, y, z] of corners) {
        const r = x * rx + y * ry + z * rz;
        const u = x * ux + y * uy + z * uz;
        const f = x * fx + y * fy + z * fz;
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minF = Math.min(minF, f); maxF = Math.max(maxF, f);
    }
    // Pad to absorb light-space jitter at grazing angles + give the depth axis
    // some headroom so casters slightly above the mesh top still register.
    const padR = (maxR - minR) * 0.05 + 5;
    const padU = (maxU - minU) * 0.05 + 5;
    const padF = (maxF - minF) * 0.1 + 50;
    minR -= padR; maxR += padR;
    minU -= padU; maxU += padU;
    minF -= padF; maxF += padF;

    const dr = maxR - minR;
    const du = maxU - minU;
    const df = maxF - minF;
    // Combined view-projection matrix:
    //   ndc.x = 2 * (dot(right, P) - minR) / dr - 1
    //   ndc.y = 2 * (dot(up,    P) - minU) / du - 1
    //   ndc.z = 2 * (dot(fwd,   P) - minF) / df - 1     (closer to light ⇒ smaller)
    const m = new Float32Array(16);
    m[0] = (2 / dr) * rx; m[1] = (2 / du) * ux; m[2] = (2 / df) * fx; m[3] = 0;
    m[4] = (2 / dr) * ry; m[5] = (2 / du) * uy; m[6] = (2 / df) * fy; m[7] = 0;
    m[8] = (2 / dr) * rz; m[9] = (2 / du) * uz; m[10] = (2 / df) * fz; m[11] = 0;
    m[12] = -2 * minR / dr - 1;
    m[13] = -2 * minU / du - 1;
    m[14] = -2 * minF / df - 1;
    m[15] = 1;
    return m;
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
    /** Overall layer opacity 0..1 (default 1 = fully opaque). */
    opacity: number;
    /**
     * Force du drapage de l'orthophoto IGN sur le mesh (modes delaunay/poisson).
     * 0 = palette de relief pure, 1 = photo opaque. Sans effet sur les points.
     */
    photoOpacity: number;
    /** Unit direction vector pointing TOWARDS the sun (x=east, y=north, z=up). */
    sunDir: [number, number, number];
    /** 0 = no diffuse (night), 1 = full daylight. */
    sunIntensity: number;
    /** RGB tint multiplied with the diffuse term (warm at sunrise/sunset). */
    sunColor: [number, number, number];
    /**
     * Opt-in directional sun lighting. When false, a neutral omnidirectional
     * light is applied instead (full albedo, no directional bias, no shadows).
     */
    sunLightingEnabled: boolean;
    /** Cast hard/soft shadows from the mesh based on the sun direction. */
    shadowsEnabled: boolean;
    /** Resolution of the shadow map (square). 1024 / 2048 / 4096. */
    shadowMapSize: number;
    /**
     * How dark cast shadows are: 0 = no shadow, 1 = full attenuation of the
     * diffuse term inside shadowed regions. Ambient is never affected.
     */
    shadowStrength: number;
    /** Constant depth bias applied when sampling the shadow map. */
    shadowBias: number;
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
        sunDir: WebGLUniformLocation | null;
        sunIntensity: WebGLUniformLocation | null;
        sunColor: WebGLUniformLocation | null;
        flatLight: WebGLUniformLocation | null;
        lightMatrix: WebGLUniformLocation | null;
        shadowMap: WebGLUniformLocation | null;
        shadowEnabled: WebGLUniformLocation | null;
        shadowBias: WebGLUniformLocation | null;
        shadowTexel: WebGLUniformLocation | null;
        shadowStrength: WebGLUniformLocation | null;
        uvRect: WebGLUniformLocation | null;
        ortho: WebGLUniformLocation | null;
        photoOpacity: WebGLUniformLocation | null;
        hasPhoto: WebGLUniformLocation | null;
    } = { matrix: null, mpu: null, ps: null, classMask: null, sunDir: null, sunIntensity: null, sunColor: null, flatLight: null, lightMatrix: null, shadowMap: null, shadowEnabled: null, shadowBias: null, shadowTexel: null, shadowStrength: null, uvRect: null, ortho: null, photoOpacity: null, hasPhoto: null };

    /** 256-bit visibility mask (8 × uint32), index i = bit set ⇒ class i visible. */
    private readonly _classMask = new Uint32Array(8).fill(0xffffffff);

    // Mesh rendering (mixed mode): drawn into the same FBO before points.
    // Origin (centerLng/centerLat) is guaranteed to match the point cloud's,
    // so we reuse _ox/_oy/_mpu for the transform.
    private _progMesh: WebGLProgram | null = null;
    private _vaoMesh: WebGLVertexArrayObject | null = null;
    private _meshPosBuf: WebGLBuffer | null = null;
    private _meshNorBuf: WebGLBuffer | null = null;
    private _meshColBuf: WebGLBuffer | null = null;
    private _meshIdxBuf: WebGLBuffer | null = null;
    private _meshIndexCount = 0;
    // Whether the ground mesh is drawn. Toggled by the "Sol" class chip in the
    // Delaunay/Poisson modes (where ground points are replaced by this mesh).
    private _meshVisible = true;
    private _locMesh: {
        matrix: WebGLUniformLocation | null;
        mpu: WebGLUniformLocation | null;
        sunDir: WebGLUniformLocation | null;
        sunIntensity: WebGLUniformLocation | null;
        sunColor: WebGLUniformLocation | null;
        flatLight: WebGLUniformLocation | null;
        lightMatrix: WebGLUniformLocation | null;
        shadowMap: WebGLUniformLocation | null;
        shadowEnabled: WebGLUniformLocation | null;
        shadowBias: WebGLUniformLocation | null;
        shadowTexel: WebGLUniformLocation | null;
        shadowStrength: WebGLUniformLocation | null;
        uvRect: WebGLUniformLocation | null;
        ortho: WebGLUniformLocation | null;
        photoOpacity: WebGLUniformLocation | null;
        hasPhoto: WebGLUniformLocation | null;
    } = { matrix: null, mpu: null, sunDir: null, sunIntensity: null, sunColor: null, flatLight: null, lightMatrix: null, shadowMap: null, shadowEnabled: null, shadowBias: null, shadowTexel: null, shadowStrength: null, uvRect: null, ortho: null, photoOpacity: null, hasPhoto: null };

    // Orthophoto drapée sur le mesh (modes delaunay/poisson). La texture est
    // chargée à la demande par l'overlay quand l'utilisateur active le drapage.
    private _orthoTex: WebGLTexture | null = null;
    private _hasPhoto = false;
    /** Emprise de la mosaïque en mètres-offset : (eMin, nMin, eMax, nMax). */
    private readonly _uvRect = new Float32Array([0, 0, 1, 1]);

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
        opacity: WebGLUniformLocation | null;
    } = { color: null, depth: null, texelSize: null, strength: null, radius: null, farPlane: null, aoStrength: null, aoRadius: null, opacity: null };

    // Shadow pass: depth-only render of the mesh into a dedicated FBO, sampled
    // by the main pass to attenuate the diffuse term where the mesh occludes
    // the sun. Mesh-only caster keeps the shadow map dense and noise-free.
    private _progShadow: WebGLProgram | null = null;
    private _shadowFbo: WebGLFramebuffer | null = null;
    private _shadowTex: WebGLTexture | null = null;
    private _shadowSize = 0;
    private _locShadow: { lightMatrix: WebGLUniformLocation | null } = { lightMatrix: null };
    /** Cached light-space VP matrix (column-major). */
    private readonly _lightMatrix = new Float32Array(16);
    /** Mesh AABB in METER_OFFSETS, used to size the orthographic light frustum. */
    private _meshBbox: { min: [number, number, number]; max: [number, number, number] } | null = null;
    /**
     * Point-cloud AABB in METER_OFFSETS (same frame as the mesh). Used purely
     * for view-frustum culling so an off-screen cloud (the user panned away
     * from the capture site) costs nothing instead of drawing millions of
     * invisible vertices every frame.
     */
    private _pointBbox: { min: [number, number, number]; max: [number, number, number] } | null = null;
    /**
     * The shadow map only depends on the mesh and the light direction — both
     * invariant under camera motion. This flag is raised when one of those
     * changes so the (expensive) depth pass over the whole mesh runs only then,
     * and is skipped on camera-only frames (orbit / pan) where the result is
     * identical. Re-rendering it every frame made the orbit stutter.
     */
    private _shadowDirty = true;

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
        opacity: 1,
        photoOpacity: 0,
        // Default sun: SSE bearing (~150°), 45° above horizon — same flavour as the
        // old hard-coded SUN constant. Overwritten as soon as setConfig() is called.
        sunDir: [0.4472, 0.5367, 0.7155],
        sunIntensity: 1,
        sunColor: [1, 0.98, 0.95],
        sunLightingEnabled: true,
        shadowsEnabled: true,
        shadowMapSize: 2048,
        shadowStrength: 0.7,
        shadowBias: 0.0015,
    };

    constructor(id: string) {
        this.id = id;
    }

    onAdd(map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        this._map = map;
        this._gl = gl as WebGL2RenderingContext;
        this._initGL(this._gl);
    }

    onRemove(_map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        this._cleanup(gl as WebGL2RenderingContext);
    }

    /** Bind point program uniforms (incl. shadows). Caller binds the VAO. */
    private _bindPointsUniforms(gl: WebGL2RenderingContext, translatedMatrix: Float32Array, effectivePointSize: number): void {
        gl.useProgram(this._progPoints);
        gl.uniformMatrix4fv(this._locPoints.matrix, false, translatedMatrix);
        gl.uniform1f(this._locPoints.mpu, this._mpu);
        gl.uniform1f(this._locPoints.ps, effectivePointSize);
        gl.uniform1uiv(this._locPoints.classMask, this._classMask);
        gl.uniform3fv(this._locPoints.sunDir, this.config.sunDir);
        gl.uniform1f(this._locPoints.sunIntensity, this.config.sunIntensity);
        gl.uniform3fv(this._locPoints.sunColor, this.config.sunColor);
        gl.uniform1f(this._locPoints.flatLight, this.config.sunLightingEnabled ? 0 : 1);
        // Orthophoto drapée (unité texture 3 ; 2 est réservée à la shadow map).
        const photoOn = this._hasPhoto && this.config.photoOpacity > 0;
        gl.uniform4fv(this._locPoints.uvRect, this._uvRect);
        gl.uniform1f(this._locPoints.hasPhoto, photoOn ? 1 : 0);
        gl.uniform1f(this._locPoints.photoOpacity, this.config.photoOpacity);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.uniform1i(this._locPoints.ortho, 3);
        this._bindShadowToProgram(gl, this._locPoints);
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, _args: CustomRenderMethodInput): void {
        if ((!this._count && !this._meshIndexCount) || !this._progPoints || !this._vao) {
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

        // View-frustum cull: if the whole cloud/mesh sits outside the camera
        // frustum (e.g. the user panned 10+ km away from the capture site),
        // skip the entire pass — drawing millions of off-screen vertices plus
        // the mesh shadow map every frame was the main cause of the stutter.
        if (this._isOutsideFrustum(translatedMatrix)) return;

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
            // ─── Pass 0: shadow map ───
            this._renderShadowPass(gl2, prevFBO);

            // ─── Pass 1: Render mesh (if any) then points into the FBO ───
            this._ensureFboSize(gl2, w, h);
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, this._fbo);
            gl2.viewport(0, 0, w, h);
            gl2.clearColor(0, 0, 0, 0);
            gl2.clearDepth(1);
            gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
            gl2.enable(gl2.DEPTH_TEST);
            gl2.depthFunc(gl2.LEQUAL);
            gl2.depthMask(true);
            gl2.disable(gl2.BLEND);

            this._drawMesh(gl2, translatedMatrix);

            this._bindPointsUniforms(gl2, translatedMatrix, effectivePointSize);

            gl2.bindVertexArray(this._vao);
            this._drawPointsChunked(gl2);

            // Export the cloud/mesh depth into MapLibre's framebuffer so later
            // draped layers (route line, contours) don't trigger a terrain
            // re-draw that overdraws the mesh with distant hazy relief.
            this._exportDepthToMapLibre(gl2, prevFBO, translatedMatrix, effectivePointSize);

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
            gl2.uniform1f(this._locEdl.opacity, this.config.opacity);

            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

            gl2.bindVertexArray(this._vaoQuad);
            gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        } else if (this._fbo && this._progEdl) {
            // ─── Direct rendering (no EDL) ───
            this._renderShadowPass(gl2, prevFBO);
            this._ensureFboSize(gl2, w, h);
            gl2.bindFramebuffer(gl2.FRAMEBUFFER, this._fbo);
            gl2.viewport(0, 0, w, h);
            gl2.clearColor(0, 0, 0, 0);
            gl2.clearDepth(1);
            gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
            gl2.enable(gl2.DEPTH_TEST);
            gl2.depthFunc(gl2.LEQUAL);
            gl2.depthMask(true);
            gl2.disable(gl2.BLEND);

            this._drawMesh(gl2, translatedMatrix);

            this._bindPointsUniforms(gl2, translatedMatrix, effectivePointSize);

            gl2.bindVertexArray(this._vao);
            this._drawPointsChunked(gl2);

            // Export depth (see EDL path above) before compositing.
            this._exportDepthToMapLibre(gl2, prevFBO, translatedMatrix, effectivePointSize);

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
            gl2.uniform1f(this._locEdl.opacity, this.config.opacity);

            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

            gl2.bindVertexArray(this._vaoQuad);
            gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        } else {
            // ─── Fallback: no FBO available, render directly (legacy path) ───
            this._renderShadowPass(gl2, prevFBO);
            gl2.disable(gl2.DEPTH_TEST);
            gl2.enable(gl2.BLEND);
            gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);
            this._bindPointsUniforms(gl2, translatedMatrix, effectivePointSize);
            gl2.bindVertexArray(this._vao);
            this._drawPointsChunked(gl2);
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
        const mc = MercatorCoordinate.fromLngLat({ lng: originLng, lat: originLat });
        this._ox = mc.x;
        this._oy = mc.y;
        this._mpu = mc.meterInMercatorCoordinateUnits();
        this._count = count;
        this._pointBbox = computeBbox(positions);

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
        this._pointBbox = null;
        this._map?.triggerRepaint();
    }

    /**
     * Upload mesh geometry into the same FBO pipeline as the points. Sets the
     * world origin (lng/lat) so the mesh can be drawn even when no companion
     * point cloud is present. In mixed/poisson modes the origin matches the
     * points, so re-setting it is a no-op.
     */
    setMesh(
        positions: Float32Array,
        normals: Float32Array,
        colors: Uint8Array,
        indices: Uint32Array,
        originLng: number,
        originLat: number,
    ): void {
        const gl = this._gl;
        if (!gl) return;
        const mc = MercatorCoordinate.fromLngLat({ lng: originLng, lat: originLat });
        this._ox = mc.x;
        this._oy = mc.y;
        this._mpu = mc.meterInMercatorCoordinateUnits();
        this._meshIndexCount = indices.length;
        this._meshBbox = computeBbox(positions);
        this._shadowDirty = true;
        const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshPosBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshNorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshColBuf);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
        gl.bindVertexArray(this._vaoMesh);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshIdxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        gl.bindVertexArray(prevVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this._map?.triggerRepaint();
    }

    clearMesh(): void {
        this._meshIndexCount = 0;
        this._shadowDirty = true;
        this._map?.triggerRepaint();
    }

    /**
     * Show or hide the ground mesh without dropping its GPU buffers. Used by the
     * "Sol" class chip in Delaunay/Poisson modes, where the ground is a
     * reconstructed mesh rather than points, so the class-mask filter (which
     * only affects points) can't toggle it.
     */
    setMeshVisible(visible: boolean): void {
        if (this._meshVisible === visible) return;
        this._meshVisible = visible;
        this._shadowDirty = true;
        this._map?.triggerRepaint();
    }

    /**
     * Upload an orthophoto mosaic to drape over the mesh. `lngLatRect` is the
     * exact geographic extent the image covers; it is converted to the layer's
     * meter-offset frame (shared `_ox/_oy/_mpu`) so the vertex shader can map
     * each ground vertex to its UV with a planar nadir projection.
     */
    setOrthoTexture(
        source: TexImageSource,
        lngLatRect: { west: number; south: number; east: number; north: number },
    ): void {
        const gl = this._gl;
        if (!gl || !this._orthoTex) return;
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        // Upload as a single base level with a LINEAR filter (no mipmaps): the
        // mosaic is a non-power-of-two canvas and `generateMipmap` throws
        // GL_INVALID_OPERATION on some ANGLE drivers, which leaves the texture
        // mipmap-incomplete and makes every sample read back black — draping
        // the mesh in solid black. A plain LINEAR texture is robust everywhere.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // Convert the lng/lat rect to meter offsets relative to the mesh origin.
        // mercX depends only on lng, mercY only on lat; the rendering uses
        //   mercX = ox + east*mpu  →  east  = (mercX - ox) / mpu
        //   mercY = oy - north*mpu →  north = (oy - mercY) / mpu
        const w = MercatorCoordinate.fromLngLat({ lng: lngLatRect.west, lat: lngLatRect.north }).x;
        const e = MercatorCoordinate.fromLngLat({ lng: lngLatRect.east, lat: lngLatRect.north }).x;
        const n = MercatorCoordinate.fromLngLat({ lng: lngLatRect.west, lat: lngLatRect.north }).y;
        const s = MercatorCoordinate.fromLngLat({ lng: lngLatRect.west, lat: lngLatRect.south }).y;
        this._uvRect[0] = (w - this._ox) / this._mpu;          // eMin (ouest)
        this._uvRect[1] = (this._oy - s) / this._mpu;          // nMin (sud)
        this._uvRect[2] = (e - this._ox) / this._mpu;          // eMax (est)
        this._uvRect[3] = (this._oy - n) / this._mpu;          // nMax (nord)
        this._hasPhoto = true;
        this._map?.triggerRepaint();
    }

    clearOrthoTexture(): void {
        this._hasPhoto = false;
        this._map?.triggerRepaint();
    }

    setConfig(config: Partial<LidarWebGLLayerConfig>): void {
        // Only the light direction, the lighting mode and the shadow-map size
        // affect the cached shadow depth pass; flag it dirty solely when one of
        // those actually changes so unrelated tweaks (opacity, point size, …)
        // don't force a needless full mesh re-render.
        const prev = this.config;
        const sunChanged = config.sunDir !== undefined && (
            config.sunDir[0] !== prev.sunDir[0]
            || config.sunDir[1] !== prev.sunDir[1]
            || config.sunDir[2] !== prev.sunDir[2]
        );
        const lightModeChanged = config.sunLightingEnabled !== undefined
            && config.sunLightingEnabled !== prev.sunLightingEnabled;
        const sizeChanged = config.shadowMapSize !== undefined
            && config.shadowMapSize !== prev.shadowMapSize;
        Object.assign(this.config, config);
        if (sunChanged || lightModeChanged || sizeChanged) this._shadowDirty = true;
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

    /**
     * Draw the point cloud, split into chunks so no single draw call exceeds
     * the per-draw vertex-ID cap (see MAX_VERT_IDS_PER_DRAW). Points are
     * independent, so a contiguous [start, start+len) range draws correctly.
     */
    private _drawPointsChunked(gl: WebGL2RenderingContext): void {
        const total = this._count;
        for (let start = 0; start < total; start += MAX_VERT_IDS_PER_DRAW) {
            const len = Math.min(MAX_VERT_IDS_PER_DRAW, total - start);
            gl.drawArrays(gl.POINTS, start, len);
        }
    }

    /**
     * Draw the mesh element buffer, split into chunks below the per-draw
     * vertex-ID cap. The chunk size is rounded down to a multiple of 3 so a
     * triangle is never split across two draws. Each chunk is a contiguous
     * range of the index buffer; indices still address the full vertex buffer.
     */
    private _drawMeshChunked(gl: WebGL2RenderingContext): void {
        const total = this._meshIndexCount;
        const chunk = MAX_VERT_IDS_PER_DRAW - (MAX_VERT_IDS_PER_DRAW % 3);
        for (let start = 0; start < total; start += chunk) {
            const len = Math.min(chunk, total - start);
            gl.drawElements(gl.TRIANGLES, len, gl.UNSIGNED_INT, start * 4);
        }
    }

    /**
     * Draw the optional ground mesh into the currently-bound FBO. Caller is
     * responsible for setting depth/blend state (we expect DEPTH_TEST on,
     * BLEND off, both color + R32F-depth MRT attached). Origin (centerLng/Lat)
     * matches the point cloud's, so we share `_mpu` and the translated matrix.
     */
    private _drawMesh(gl: WebGL2RenderingContext, translatedMatrix: Float32Array): void {
        if (!this._meshVisible || !this._meshIndexCount || !this._progMesh || !this._vaoMesh) return;
        gl.useProgram(this._progMesh);
        gl.uniformMatrix4fv(this._locMesh.matrix, false, translatedMatrix);
        gl.uniform1f(this._locMesh.mpu, this._mpu);
        gl.uniform3fv(this._locMesh.sunDir, this.config.sunDir);
        gl.uniform1f(this._locMesh.sunIntensity, this.config.sunIntensity);
        gl.uniform3fv(this._locMesh.sunColor, this.config.sunColor);
        gl.uniform1f(this._locMesh.flatLight, this.config.sunLightingEnabled ? 0 : 1);
        // Orthophoto drapée (unité texture 3 ; 2 est réservée à la shadow map).
        const photoOn = this._hasPhoto && this.config.photoOpacity > 0;
        gl.uniform4fv(this._locMesh.uvRect, this._uvRect);
        gl.uniform1f(this._locMesh.hasPhoto, photoOn ? 1 : 0);
        gl.uniform1f(this._locMesh.photoOpacity, this.config.photoOpacity);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.uniform1i(this._locMesh.ortho, 3);
        this._bindShadowToProgram(gl, this._locMesh);
        gl.bindVertexArray(this._vaoMesh);
        this._drawMeshChunked(gl);
    }

    /**
     * Union of the active point + mesh bounding boxes (same meter-offset
     * frame), or null when there's nothing drawable to bound.
     */
    private _combinedBbox(): Bbox | null {
        const pb = this._count > 0 ? this._pointBbox : null;
        const mb = this._meshVisible && this._meshIndexCount > 0 ? this._meshBbox : null;
        if (!pb) return mb;
        if (!mb) return pb;
        return {
            min: [Math.min(pb.min[0], mb.min[0]), Math.min(pb.min[1], mb.min[1]), Math.min(pb.min[2], mb.min[2])],
            max: [Math.max(pb.max[0], mb.max[0]), Math.max(pb.max[1], mb.max[1]), Math.max(pb.max[2], mb.max[2])],
        };
    }

    /**
     * Conservative AABB view-frustum test. Returns true only when the combined
     * point+mesh bounding box is provably outside the camera frustum, so it is
     * always safe to skip drawing. Transforms the 8 corners exactly like the
     * vertex shaders (`clip = M * vec4(dx*mpu, -dy*mpu, dz*mpu, 1)`) and culls
     * when all corners fall outside the same clip-space side plane.
     */
    private _isOutsideFrustum(translatedMatrix: Float32Array): boolean {
        const bb = this._combinedBbox();
        if (!bb) return false; // nothing to cull (don't skip)
        const xs = [bb.min[0], bb.max[0]];
        const ys = [bb.min[1], bb.max[1]];
        const zs = [bb.min[2], bb.max[2]];
        // Bitwise-AND the per-corner out-codes: a bit that survives across all
        // 8 corners means every corner is beyond that one clip plane ⇒ the box
        // is fully outside the frustum on that side.
        let andCode = 0b1111;
        for (let i = 0; i < 8 && andCode !== 0; i++) {
            andCode &= this._cornerOutCode(translatedMatrix, xs[i & 1], ys[(i >> 1) & 1], zs[(i >> 2) & 1]);
        }
        return andCode !== 0;
    }

    /**
     * Out-code (4 bits: left/right/bottom/top) for one bbox corner given in the
     * meter-offset frame, using the exact vertex-shader transform.
     */
    private _cornerOutCode(m: Float32Array, dx: number, dy: number, dz: number): number {
        const mpu = this._mpu;
        const px = dx * mpu, py = -dy * mpu, pz = dz * mpu;
        const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
        const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
        let code = 0;
        if (cx < -cw) code |= 0b0001;
        if (cx > cw) code |= 0b0010;
        if (cy < -cw) code |= 0b0100;
        if (cy > cw) code |= 0b1000;
        return code;
    }

    /**
     * True iff we have a mesh, a positive sun, and shadow casting is on.
     * When false, the shadow pass is skipped and the receiver shaders
     * fall back to no-shadow rendering (u_shadowEnabled = 0).
     */
    private _shadowsActive(): boolean {
        // Shadows are available with sun lighting AND in the neutral lighting
        // mode (cast from the fixed FLAT_LIGHT_DIR). The sun-intensity floor
        // only applies when the directional sun actually drives the shading.
        return this.config.shadowsEnabled
            && this._meshVisible
            && this._meshIndexCount > 0
            && this._meshBbox !== null
            && (!this.config.sunLightingEnabled || this.config.sunIntensity > 0)
            && this._progShadow !== null
            && this._shadowFbo !== null;
    }

    /**
     * Render the mesh into the shadow map (depth-only, ortho projection
     * aligned with the sun). Updates `_lightMatrix` so receivers can sample
     * the same projection. Returns true iff the shadow map is ready.
     */
    private _renderShadowPass(gl: WebGL2RenderingContext, prevFBO: WebGLFramebuffer | null): boolean {
        if (!this._shadowsActive() || !this._meshBbox) return false;
        this._ensureShadowMap(gl, this.config.shadowMapSize);
        // Camera-only frames (orbit / pan) reuse the cached shadow map: its
        // depth render depends only on the mesh + light direction, so the
        // already-computed `_lightMatrix` and `_shadowTex` stay valid.
        if (!this._shadowDirty) return true;
        // With sun lighting on, shadows follow the sun; otherwise they follow
        // the fixed neutral light direction so they match the flat hillshade.
        const lightDir = this.config.sunLightingEnabled ? this.config.sunDir : FLAT_LIGHT_DIR;
        const m = buildLightMatrix(lightDir, this._meshBbox);
        this._lightMatrix.set(m);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFbo);
        gl.viewport(0, 0, this._shadowSize, this._shadowSize);
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        // Front-face culling reduces self-shadow acne on convex casters; for
        // a heightfield-style mesh the difference is small but the bias gets
        // a wider safe range.
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
        gl.useProgram(this._progShadow);
        gl.uniformMatrix4fv(this._locShadow.lightMatrix, false, this._lightMatrix);
        gl.bindVertexArray(this._vaoMesh);
        this._drawMeshChunked(gl);
        gl.cullFace(gl.BACK);
        gl.disable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
        this._shadowDirty = false;
        return true;
    }

    /**
     * Push shadow uniforms (light matrix, shadow texture, params) into the
     * currently-active program. Falls back to disabled state when the shadow
     * map isn't ready, so receivers always render correctly.
     */
    private _bindShadowToProgram(
        gl: WebGL2RenderingContext,
        loc: {
            lightMatrix: WebGLUniformLocation | null;
            shadowMap: WebGLUniformLocation | null;
            shadowEnabled: WebGLUniformLocation | null;
            shadowBias: WebGLUniformLocation | null;
            shadowTexel: WebGLUniformLocation | null;
            shadowStrength: WebGLUniformLocation | null;
        },
    ): void {
        const enabled = this._shadowsActive() && this._shadowSize > 0;
        gl.uniformMatrix4fv(loc.lightMatrix, false, this._lightMatrix);
        gl.uniform1f(loc.shadowEnabled, enabled ? 1 : 0);
        gl.uniform1f(loc.shadowBias, this.config.shadowBias);
        const t = this._shadowSize > 0 ? 1 / this._shadowSize : 0;
        gl.uniform2f(loc.shadowTexel, t, t);
        gl.uniform1f(loc.shadowStrength, this.config.shadowStrength);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._shadowTex);
        gl.uniform1i(loc.shadowMap, 2);
    }

    /**
     * Re-draw the cloud/mesh depth (no colour) directly into the framebuffer
     * MapLibre is compositing into (`destFbo`). Our geometry uses the SAME
     * projection matrix MapLibre uses, so the written depth is directly
     * comparable to MapLibre's terrain depth. This means the mesh now occupies
     * MapLibre's shared depth buffer; when MapLibre later re-draws the terrain
     * mesh to flush a draped layer (route line, contour lines) sitting above us
     * in the layer order, those distant terrain fragments fail the LEQUAL depth
     * test where the nearer lidar mesh is, so the hazy far relief no longer
     * overdraws the mesh silhouette (the "fog band crossing the mesh" artefact).
     *
     * A direct depth-only pass is used rather than `blitFramebuffer` because
     * MapLibre's default framebuffer is multisampled (antialias), and blitting
     * into a multisampled draw framebuffer is a GL_INVALID_OPERATION.
     */
    private _exportDepthToMapLibre(
        gl: WebGL2RenderingContext,
        destFbo: WebGLFramebuffer | null,
        translatedMatrix: Float32Array,
        effectivePointSize: number,
    ): void {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destFbo);
        const prevRange = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
        // Match the depth range MapLibre uses for the terrain mesh ([0,1]); the
        // 3D custom-layer pass may have narrowed it, which would bias the test.
        gl.depthRange(0, 1);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);

        this._drawMesh(gl, translatedMatrix);

        this._bindPointsUniforms(gl, translatedMatrix, effectivePointSize);
        gl.bindVertexArray(this._vao);
        this._drawPointsChunked(gl);

        gl.colorMask(true, true, true, true);
        gl.depthRange(prevRange[0], prevRange[1]);
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
        // ─── Point shader ───
        this._progPoints = linkProgram(gl, VS_POINTS, FS_POINTS);
        this._locPoints = {
            matrix: gl.getUniformLocation(this._progPoints, 'u_matrix'),
            mpu: gl.getUniformLocation(this._progPoints, 'u_mpu'),
            ps: gl.getUniformLocation(this._progPoints, 'u_ps'),
            classMask: gl.getUniformLocation(this._progPoints, 'u_classMask[0]'),
            sunDir: gl.getUniformLocation(this._progPoints, 'u_sunDir'),
            sunIntensity: gl.getUniformLocation(this._progPoints, 'u_sunIntensity'),
            sunColor: gl.getUniformLocation(this._progPoints, 'u_sunColor'),
            flatLight: gl.getUniformLocation(this._progPoints, 'u_flatLight'),
            lightMatrix: gl.getUniformLocation(this._progPoints, 'u_lightMatrix'),
            shadowMap: gl.getUniformLocation(this._progPoints, 'u_shadowMap'),
            shadowEnabled: gl.getUniformLocation(this._progPoints, 'u_shadowEnabled'),
            shadowBias: gl.getUniformLocation(this._progPoints, 'u_shadowBias'),
            shadowTexel: gl.getUniformLocation(this._progPoints, 'u_shadowTexel'),
            shadowStrength: gl.getUniformLocation(this._progPoints, 'u_shadowStrength'),
            uvRect: gl.getUniformLocation(this._progPoints, 'u_uvRect'),
            ortho: gl.getUniformLocation(this._progPoints, 'u_ortho'),
            photoOpacity: gl.getUniformLocation(this._progPoints, 'u_photoOpacity'),
            hasPhoto: gl.getUniformLocation(this._progPoints, 'u_hasPhoto'),
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

        // ─── Mesh shader (mixed mode) ───
        this._progMesh = linkProgram(gl, VS_MESH, FS_MESH);
        this._locMesh = {
            matrix: gl.getUniformLocation(this._progMesh, 'u_matrix'),
            mpu: gl.getUniformLocation(this._progMesh, 'u_mpu'),
            sunDir: gl.getUniformLocation(this._progMesh, 'u_sunDir'),
            sunIntensity: gl.getUniformLocation(this._progMesh, 'u_sunIntensity'),
            sunColor: gl.getUniformLocation(this._progMesh, 'u_sunColor'),
            flatLight: gl.getUniformLocation(this._progMesh, 'u_flatLight'),
            lightMatrix: gl.getUniformLocation(this._progMesh, 'u_lightMatrix'),
            shadowMap: gl.getUniformLocation(this._progMesh, 'u_shadowMap'),
            shadowEnabled: gl.getUniformLocation(this._progMesh, 'u_shadowEnabled'),
            shadowBias: gl.getUniformLocation(this._progMesh, 'u_shadowBias'),
            shadowTexel: gl.getUniformLocation(this._progMesh, 'u_shadowTexel'),
            shadowStrength: gl.getUniformLocation(this._progMesh, 'u_shadowStrength'),
            uvRect: gl.getUniformLocation(this._progMesh, 'u_uvRect'),
            ortho: gl.getUniformLocation(this._progMesh, 'u_ortho'),
            photoOpacity: gl.getUniformLocation(this._progMesh, 'u_photoOpacity'),
            hasPhoto: gl.getUniformLocation(this._progMesh, 'u_hasPhoto'),
        };

        // Texture orthophoto (1×1 par défaut, remplie par setOrthoTexture).
        this._orthoTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        gl.bindTexture(gl.TEXTURE_2D, null);

        // ─── Mesh buffers & VAO ───
        this._meshPosBuf = gl.createBuffer();
        this._meshNorBuf = gl.createBuffer();
        this._meshColBuf = gl.createBuffer();
        this._meshIdxBuf = gl.createBuffer();
        this._vaoMesh = gl.createVertexArray();
        gl.bindVertexArray(this._vaoMesh);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshPosBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshNorBuf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshColBuf);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshIdxBuf);
        gl.bindVertexArray(prevVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

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
            opacity: gl.getUniformLocation(this._progEdl, 'u_opacity'),
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

        // ─── Shadow program + depth-only FBO ──────────────────────────────
        // The shadow map is a single DEPTH_COMPONENT24 texture sized to
        // `config.shadowMapSize`. Sampled with manual 3×3 PCF in FS_POINTS.
        this._progShadow = linkProgram(gl, VS_SHADOW, FS_SHADOW);
        this._locShadow = {
            lightMatrix: gl.getUniformLocation(this._progShadow, 'u_lightMatrix'),
        };
        this._shadowFbo = gl.createFramebuffer();
        this._shadowTex = gl.createTexture();
        this._ensureShadowMap(gl, this.config.shadowMapSize);
    }

    private _ensureShadowMap(gl: WebGL2RenderingContext, size: number): void {
        if (this._shadowSize === size || !this._shadowFbo || !this._shadowTex) return;
        this._shadowSize = size;
        gl.bindTexture(gl.TEXTURE_2D, this._shadowTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._shadowTex, 0);
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private _cleanup(gl: WebGL2RenderingContext): void {
        const delVao = (v: WebGLVertexArrayObject | null) => { if (v) gl.deleteVertexArray(v); };
        const delBuf = (b: WebGLBuffer | null) => { if (b) gl.deleteBuffer(b); };
        const delProg = (p: WebGLProgram | null) => { if (p) gl.deleteProgram(p); };
        const delTex = (t: WebGLTexture | null) => { if (t) gl.deleteTexture(t); };
        delVao(this._vao); this._vao = null;
        delVao(this._vaoQuad); this._vaoQuad = null;
        delVao(this._vaoMesh); this._vaoMesh = null;
        delBuf(this._posBuf); this._posBuf = null;
        delBuf(this._norBuf); this._norBuf = null;
        delBuf(this._colBuf); this._colBuf = null;
        delBuf(this._clsBuf); this._clsBuf = null;
        delBuf(this._meshPosBuf); this._meshPosBuf = null;
        delBuf(this._meshNorBuf); this._meshNorBuf = null;
        delBuf(this._meshColBuf); this._meshColBuf = null;
        delBuf(this._meshIdxBuf); this._meshIdxBuf = null;
        delBuf(this._quadBuf); this._quadBuf = null;
        delProg(this._progPoints); this._progPoints = null;
        delProg(this._progMesh); this._progMesh = null;
        delProg(this._progEdl); this._progEdl = null;
        delProg(this._progShadow); this._progShadow = null;
        delTex(this._texColor); this._texColor = null;
        delTex(this._texDepth); this._texDepth = null;
        delTex(this._shadowTex); this._shadowTex = null;
        delTex(this._orthoTex); this._orthoTex = null;
        if (this._rbDepth) { gl.deleteRenderbuffer(this._rbDepth); this._rbDepth = null; }
        if (this._fbo) { gl.deleteFramebuffer(this._fbo); this._fbo = null; }
        if (this._shadowFbo) { gl.deleteFramebuffer(this._shadowFbo); this._shadowFbo = null; }
        this._count = 0;
        this._map = null;
        this._gl = null;
    }
}
