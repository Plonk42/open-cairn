/**
 * MapLibre CustomLayerInterface — one sky body's track across the sky, drawn
 * with a hidden-line pass so a ridge actually hides it. One instance per body;
 * the sun and the moon differ only by their palette, their disc radius and
 * their phase.
 *
 * The whole feature rests on two facts about MapLibre's framebuffer:
 *
 *   - the 3D terrain writes its depth there, and so does the LiDAR mesh (see
 *     `LidarWebGLLayer._exportDepthToMapLibre`), so a layer drawn on top can
 *     test against the relief;
 *   - the depth range is narrowed to a per-layer slice before our `render`
 *     runs, so it has to be forced back to [0, 1] to be comparable with the
 *     terrain's — exactly what the LiDAR layer already does.
 *
 * Geometry sits at infinity (`gl_Position.z = w`), i.e. on the far plane: a
 * `LEQUAL` pass therefore only paints where the sky is still visible, and a
 * `GREATER` pass paints exactly the parts a mountain covers. Those become the
 * solid and the dashed halves of the track.
 */

import { linkProgram } from '@/components/map/lidar-gl/shaders';
import FS_SKY_DISC from '@/components/map/sky-gl/glsl/skyDisc.frag';
import VS_SKY_DISC from '@/components/map/sky-gl/glsl/skyDisc.vert';
import FS_SKY_PATH from '@/components/map/sky-gl/glsl/skyPath.frag';
import VS_SKY_PATH from '@/components/map/sky-gl/glsl/skyPath.vert';
import { cameraFromMatrix } from '@/lib/cameraFromMatrix';
import { SKY_PATH_FLOATS_PER_VERTEX, SKY_PATH_STRIDE } from '@/lib/skyPath';
import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';

type Rgba = readonly [number, number, number, number];

/** Everything that distinguishes one body's drawing from another's. */
export interface SkyBodyPalette {
    trackVisible: Rgba;
    trackHidden: Rgba;
    discVisible: Rgba;
    discHidden: Rgba;
    /** Glare drawn behind the disc, clipped the same way. */
    halo: Rgba;
    /** How many disc radii the halo reaches; 0 disables it. */
    haloRadiusFactor: number;
}

export const SUN_PALETTE: SkyBodyPalette = {
    trackVisible: [1, 0.86, 0.36, 0.95],
    trackHidden: [1, 0.86, 0.36, 0.42],
    discVisible: [1, 0.96, 0.78, 1],
    discHidden: [1, 0.9, 0.55, 0.65],
    halo: [1, 0.82, 0.4, 0.22],
    haloRadiusFactor: 4,
};

/**
 * Cool and paler than the sun's: the two tracks routinely cross, and the eye
 * has to tell them apart at a glance without reading a legend.
 */
export const MOON_PALETTE: SkyBodyPalette = {
    trackVisible: [0.72, 0.84, 1, 0.9],
    trackHidden: [0.72, 0.84, 1, 0.38],
    discVisible: [0.94, 0.96, 1, 1],
    discHidden: [0.8, 0.88, 1, 0.6],
    halo: [0.6, 0.76, 1, 0],
    // No glare: the moon does not dazzle, and a halo would swamp a thin
    // crescent that is only a few pixels wide.
    haloRadiusFactor: 0,
};

const TRACK_WIDTH_CSS = 1.7;
const TICK_WIDTH_CSS = 2.4;
/** Dash period along the hidden half of the track, in degrees of arc. */
const DASH_DEG = 1.1;

/** A body's disc: where it is, how big it looks, and how much of it is lit. */
export interface SkyBodyDisc {
    /** Unit ENU direction towards the body. */
    dir: [number, number, number];
    /** Apparent angular RADIUS, in degrees. */
    radiusDeg: number;
    /** Illuminated fraction, 0 (new) to 1 (full). */
    illuminatedFraction: number;
    /**
     * Unit ENU direction, perpendicular to `dir`, towards the lit limb.
     * Ignored when the body is full.
     */
    limbDir: [number, number, number];
}

interface PathUniforms {
    matrix: WebGLUniformLocation | null;
    halfRes: WebGLUniformLocation | null;
    halfWidth: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    dashDeg: WebGLUniformLocation | null;
}

interface DiscUniforms {
    matrix: WebGLUniformLocation | null;
    dir: WebGLUniformLocation | null;
    right: WebGLUniformLocation | null;
    up: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    ring: WebGLUniformLocation | null;
    phase: WebGLUniformLocation | null;
    limb: WebGLUniformLocation | null;
}

/**
 * `M · T(eye)`, so the shader's input vector is a pure direction. By
 * construction of {@link cameraFromMatrix} the translation column of the result
 * is (0, 0, ·, 0): the projection of a direction becomes a plain linear map and
 * the arbitrary length of the direction vector cancels out.
 */
function translateToEye(m: ArrayLike<number>, eye: readonly number[]): Float32Array {
    const [ex, ey, ez] = eye;
    return new Float32Array([
        m[0], m[1], m[2], m[3],
        m[4], m[5], m[6], m[7],
        m[8], m[9], m[10], m[11],
        m[0] * ex + m[4] * ey + m[8] * ez + m[12],
        m[1] * ex + m[5] * ey + m[9] * ez + m[13],
        m[2] * ex + m[6] * ey + m[10] * ez + m[14],
        m[3] * ex + m[7] * ey + m[11] * ez + m[15],
    ]);
}

/** Two unit vectors spanning the plane perpendicular to `dir`. */
function billboardBasis(dir: readonly number[]): { right: number[]; up: number[] } {
    // Any world-up works as long as it is not parallel to `dir`.
    const wu = Math.abs(dir[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
    const rx = wu[1] * dir[2] - wu[2] * dir[1];
    const ry = wu[2] * dir[0] - wu[0] * dir[2];
    const rz = wu[0] * dir[1] - wu[1] * dir[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const right = [rx / rl, ry / rl, rz / rl];
    const up = [
        dir[1] * right[2] - dir[2] * right[1],
        dir[2] * right[0] - dir[0] * right[2],
        dir[0] * right[1] - dir[1] * right[0],
    ];
    return { right, up };
}

export class SkyBodyLayer implements CustomLayerInterface {
    readonly id: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private _gl: WebGL2RenderingContext | null = null;
    private _progPath: WebGLProgram | null = null;
    private _progDisc: WebGLProgram | null = null;
    private _locPath: PathUniforms = { matrix: null, halfRes: null, halfWidth: null, color: null, dashDeg: null };
    private _locDisc: DiscUniforms = {
        matrix: null, dir: null, right: null, up: null, radius: null, color: null, ring: null,
        phase: null, limb: null,
    };

    private _vaoTrack: WebGLVertexArrayObject | null = null;
    private _vaoTicks: WebGLVertexArrayObject | null = null;
    private _vaoDisc: WebGLVertexArrayObject | null = null;
    private _bufTrack: WebGLBuffer | null = null;
    private _bufTicks: WebGLBuffer | null = null;
    private _bufDisc: WebGLBuffer | null = null;

    private _trackCount = 0;
    private _ticksCount = 0;
    private _pending: { track: Float32Array; ticks: Float32Array } | null = null;
    private _disc: SkyBodyDisc | null = null;
    private _visible = true;
    private _hiddenPass = true;

    constructor(id: string, private readonly _palette: SkyBodyPalette) {
        this.id = id;
    }

    onAdd(_map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        const gl2 = gl as WebGL2RenderingContext;
        this._gl = gl2;
        this._progPath = linkProgram(gl2, VS_SKY_PATH, FS_SKY_PATH);
        this._progDisc = linkProgram(gl2, VS_SKY_DISC, FS_SKY_DISC);
        this._locPath = {
            matrix: gl2.getUniformLocation(this._progPath, 'u_matrix'),
            halfRes: gl2.getUniformLocation(this._progPath, 'u_halfRes'),
            halfWidth: gl2.getUniformLocation(this._progPath, 'u_halfWidth'),
            color: gl2.getUniformLocation(this._progPath, 'u_color'),
            dashDeg: gl2.getUniformLocation(this._progPath, 'u_dashDeg'),
        };
        this._locDisc = {
            matrix: gl2.getUniformLocation(this._progDisc, 'u_matrix'),
            dir: gl2.getUniformLocation(this._progDisc, 'u_dir'),
            right: gl2.getUniformLocation(this._progDisc, 'u_right'),
            up: gl2.getUniformLocation(this._progDisc, 'u_up'),
            radius: gl2.getUniformLocation(this._progDisc, 'u_radius'),
            color: gl2.getUniformLocation(this._progDisc, 'u_color'),
            ring: gl2.getUniformLocation(this._progDisc, 'u_ring'),
            phase: gl2.getUniformLocation(this._progDisc, 'u_phase'),
            limb: gl2.getUniformLocation(this._progDisc, 'u_limb'),
        };

        this._bufTrack = gl2.createBuffer();
        this._bufTicks = gl2.createBuffer();
        this._vaoTrack = this._createPathVao(gl2, this._bufTrack);
        this._vaoTicks = this._createPathVao(gl2, this._bufTicks);
        this._createDiscVao(gl2);

        if (this._pending) {
            const pending = this._pending;
            this._pending = null;
            this.setGeometry(pending.track, pending.ticks);
        }
    }

    onRemove(): void {
        const gl = this._gl;
        if (!gl) return;
        gl.deleteBuffer(this._bufTrack);
        gl.deleteBuffer(this._bufTicks);
        gl.deleteBuffer(this._bufDisc);
        gl.deleteVertexArray(this._vaoTrack);
        gl.deleteVertexArray(this._vaoTicks);
        gl.deleteVertexArray(this._vaoDisc);
        if (this._progPath) gl.deleteProgram(this._progPath);
        if (this._progDisc) gl.deleteProgram(this._progDisc);
        this._gl = null;
        this._progPath = null;
        this._progDisc = null;
        this._trackCount = 0;
        this._ticksCount = 0;
    }

    setVisible(visible: boolean): void {
        this._visible = visible;
    }

    /** Whether the part of the track a ridge covers is drawn at all. */
    setHiddenPass(draw: boolean): void {
        this._hiddenPass = draw;
    }

    /** The body's disc at the selected instant, or null to hide it. */
    setDisc(disc: SkyBodyDisc | null): void {
        this._disc = disc;
    }

    setGeometry(track: Float32Array, ticks: Float32Array): void {
        const gl = this._gl;
        // MapLibre calls `onAdd` asynchronously after `addLayer`; hold the
        // buffers until there is a context to upload them to.
        if (!gl || !this._bufTrack || !this._bufTicks) {
            this._pending = { track, ticks };
            return;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._bufTrack);
        gl.bufferData(gl.ARRAY_BUFFER, track, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._bufTicks);
        gl.bufferData(gl.ARRAY_BUFFER, ticks, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this._trackCount = track.length / SKY_PATH_FLOATS_PER_VERTEX;
        this._ticksCount = ticks.length / SKY_PATH_FLOATS_PER_VERTEX;
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
        if (!this._visible || !this._progPath || !this._progDisc) return;
        if (!this._trackCount && !this._disc) return;

        const matrix = args.defaultProjectionData?.mainMatrix;
        if (!matrix) return;
        const eye = cameraFromMatrix(matrix);
        if (!eye) return;

        const gl2 = gl as WebGL2RenderingContext;
        const m = translateToEye(matrix, eye);
        const saved = this._saveState(gl2);

        // Comparable with the terrain depth, which MapLibre writes over [0, 1].
        gl2.depthRange(0, 1);
        gl2.enable(gl2.DEPTH_TEST);
        gl2.depthMask(false);
        gl2.enable(gl2.BLEND);
        gl2.blendFunc(gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
        gl2.disable(gl2.CULL_FACE);

        if (this._hiddenPass) this._drawHidden(gl2, m);
        this._drawVisible(gl2, m);

        this._restoreState(gl2, saved);
    }

    // ── Passes ───────────────────────────────────────────────────────────────

    /** What a ridge covers: dashed track, hollow body. Drawn first, underneath. */
    private _drawHidden(gl: WebGL2RenderingContext, m: Float32Array): void {
        gl.depthFunc(gl.GREATER);
        this._drawPaths(gl, m, this._palette.trackHidden, DASH_DEG);
        this._drawDisc(gl, m, this._palette.discHidden, 1, 0.22);
    }

    private _drawVisible(gl: WebGL2RenderingContext, m: Float32Array): void {
        gl.depthFunc(gl.LEQUAL);
        this._drawPaths(gl, m, this._palette.trackVisible, 0);
        if (this._palette.haloRadiusFactor > 0) {
            this._drawDisc(gl, m, this._palette.halo, this._palette.haloRadiusFactor, 0);
        }
        this._drawDisc(gl, m, this._palette.discVisible, 1, 0);
    }

    private _drawPaths(gl: WebGL2RenderingContext, m: Float32Array, color: Rgba, dashDeg: number): void {
        if (!this._trackCount) return;
        const canvas = gl.canvas as HTMLCanvasElement;
        const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
        gl.useProgram(this._progPath);
        gl.uniformMatrix4fv(this._locPath.matrix, false, m);
        gl.uniform2f(this._locPath.halfRes, canvas.width / 2, canvas.height / 2);
        gl.uniform4f(this._locPath.color, color[0], color[1], color[2], color[3]);
        gl.uniform1f(this._locPath.dashDeg, dashDeg);

        gl.uniform1f(this._locPath.halfWidth, (TRACK_WIDTH_CSS * dpr) / 2);
        gl.bindVertexArray(this._vaoTrack);
        gl.drawArrays(gl.TRIANGLES, 0, this._trackCount);

        if (!this._ticksCount) return;
        gl.uniform1f(this._locPath.halfWidth, (TICK_WIDTH_CSS * dpr) / 2);
        gl.uniform1f(this._locPath.dashDeg, 0);
        gl.bindVertexArray(this._vaoTicks);
        gl.drawArrays(gl.TRIANGLES, 0, this._ticksCount);
    }

    private _drawDisc(
        gl: WebGL2RenderingContext,
        m: Float32Array,
        color: Rgba,
        radiusFactor: number,
        ring: number,
    ): void {
        const disc = this._disc;
        if (!disc) return;
        const { dir } = disc;
        const { right, up } = billboardBasis(dir);
        const dot = (v: readonly number[]) =>
            disc.limbDir[0] * v[0] + disc.limbDir[1] * v[1] + disc.limbDir[2] * v[2];
        gl.useProgram(this._progDisc);
        gl.uniformMatrix4fv(this._locDisc.matrix, false, m);
        gl.uniform3f(this._locDisc.dir, dir[0], dir[1], dir[2]);
        gl.uniform3f(this._locDisc.right, right[0], right[1], right[2]);
        gl.uniform3f(this._locDisc.up, up[0], up[1], up[2]);
        gl.uniform1f(this._locDisc.radius, Math.tan(disc.radiusDeg * (Math.PI / 180)) * radiusFactor);
        gl.uniform4f(this._locDisc.color, color[0], color[1], color[2], color[3]);
        gl.uniform1f(this._locDisc.ring, ring);
        // The halo has no phase: a crescent moon has no glare to carve anyway.
        gl.uniform1f(this._locDisc.phase, radiusFactor === 1 ? disc.illuminatedFraction : 1);
        // The lit limb, expressed in the billboard's own 2D frame.
        gl.uniform2f(this._locDisc.limb, dot(right), dot(up));
        gl.bindVertexArray(this._vaoDisc);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ── GL plumbing ──────────────────────────────────────────────────────────

    private _createPathVao(gl: WebGL2RenderingContext, buffer: WebGLBuffer | null): WebGLVertexArrayObject | null {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        // dirA(3) · dirB(3) · at(1) · side(1) · arc(1)
        const layout: [number, number, number][] = [[0, 3, 0], [1, 3, 12], [2, 1, 24], [3, 1, 28], [4, 1, 32]];
        for (const [index, size, offset] of layout) {
            gl.enableVertexAttribArray(index);
            gl.vertexAttribPointer(index, size, gl.FLOAT, false, SKY_PATH_STRIDE, offset);
        }
        gl.bindVertexArray(null);
        return vao;
    }

    private _createDiscVao(gl: WebGL2RenderingContext): void {
        this._bufDisc = gl.createBuffer();
        this._vaoDisc = gl.createVertexArray();
        gl.bindVertexArray(this._vaoDisc);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._bufDisc);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    private _saveState(gl: WebGL2RenderingContext) {
        return {
            program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
            vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            depthFunc: gl.getParameter(gl.DEPTH_FUNC) as number,
            depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
            depthRange: gl.getParameter(gl.DEPTH_RANGE) as Float32Array,
            blend: gl.isEnabled(gl.BLEND),
            cullFace: gl.isEnabled(gl.CULL_FACE),
        };
    }

    private _restoreState(gl: WebGL2RenderingContext, s: ReturnType<SkyBodyLayer['_saveState']>): void {
        gl.bindVertexArray(s.vao);
        gl.useProgram(s.program);
        gl.depthRange(s.depthRange[0], s.depthRange[1]);
        gl.depthFunc(s.depthFunc);
        gl.depthMask(s.depthMask);
        if (s.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (s.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        if (s.cullFace) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    }
}
