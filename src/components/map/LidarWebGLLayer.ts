/**
 * MapLibre CustomLayerInterface — WebGL2 point cloud with optional EDL.
 * Properly saves and restores GL state.
 */

import {
    FS_EDL, FS_MESH, FS_POINTS, FS_SHADOW,
    linkProgram,
    VS_MESH, VS_POINTS, VS_QUAD, VS_SHADOW,
} from '@/components/map/lidar-gl/shaders';
import { isMeshWireframeDebugEnabled } from '@/lib/debugFlags';
import { buildForestGpuTables, buildForestPalette, type ForestGrouping } from '@/lib/lidarBrowser/bdforet';
import { requestMeshLods } from '@/lib/lidarBrowser/lodWorkerClient';
import type { CustomLayerInterface, CustomRenderMethodInput, Map } from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';


type Bbox = { min: [number, number, number]; max: [number, number, number] };

// Browsers/GPUs cap the number of vertex IDs processed per draw call
// (Firefox enforces webgl.max-vert-ids-per-draw = 30 000 000). A max-density
// cloud over a large area can exceed this in a single draw, which silently
// truncates the geometry and emits a console warning. We split large draws
// into chunks comfortably below the cap.
const MAX_VERT_IDS_PER_DRAW = 24_000_000;

/**
 * Distance-based level-of-detail (classic video-game LOD): when the camera is
 * zoomed far out, drawing the full-resolution point cloud / mesh wastes GPU
 * time on geometry that collapses to a handful of screen pixels anyway.
 *
 * Points: each coarser level is an index subset picked by `pointStrideIndices`
 * — a plain "keep every Nth point" walk, computed synchronously on the main
 * thread the moment a cloud loads (see that function's doc comment for why
 * this is both cheap and more accurate than a WASM approach here).
 *
 * Mesh: each coarser level is a simplified triangle mesh (`MeshoptSimplifier.
 * simplify`), precomputed in a dedicated Web Worker (`lodWorkerClient.ts` —
 * unlike points, triangles can't just be dropped by index without tearing
 * the surface, so this genuinely needs the WASM simplifier; and it's CPU-heavy
 * enough on dense gallery scenes that running it on the main thread, even
 * deferred via `requestIdleCallback`, froze navigation for several seconds
 * since idle callbacks aren't preemptible).
 *
 * Both are swapped in wholesale based on the map zoom relative to `config.
 * referenceZoom` — the same zoom-vs-referenceZoom heuristic already used by
 * `_effectivePointSize()`. `ratio` is the fraction of the original element
 * count kept; `zoomOffset` is how far below `referenceZoom` the level kicks in.
 * The offsets below are tuned against the default `referenceZoom: 19` (never
 * overridden elsewhere in the app) to land on absolute zoom breakpoints of
 * 17.5 / 16 / 15 / 14.
 */
interface LodLevel { ratio: number; zoomOffset: number }
const POINT_LOD_LEVELS: readonly LodLevel[] = [
    { ratio: 1, zoomOffset: 0 },
    { ratio: 0.75, zoomOffset: -1.5 },
    { ratio: 0.5, zoomOffset: -3 },
    { ratio: 0.25, zoomOffset: -4 },
    { ratio: 0.1, zoomOffset: -5 },
];
const MESH_LOD_LEVELS: readonly LodLevel[] = [
    { ratio: 1, zoomOffset: 0 },
    { ratio: 0.6, zoomOffset: -1.5 },
    { ratio: 0.35, zoomOffset: -3 },
    { ratio: 0.15, zoomOffset: -4 },
    { ratio: 0.05, zoomOffset: -5 },
];
/** Number of LOD levels (shared by points/mesh); used by the debug override
 *  slider to size its range. */
export const LOD_LEVEL_COUNT = POINT_LOD_LEVELS.length;

/**
 * Build a deduplicated GL_LINES edge index list from a triangle index buffer,
 * for the debug wireframe. Each undirected edge is emitted once (interior edges
 * are shared by two triangles), so the segment count is ~half of a naive
 * 3-edges-per-triangle list. Keys pack the ordered endpoint pair into one
 * number; `stride > maxIndex` keeps them collision-free for any realistic
 * capture (safe while `maxIndex² < 2^53`).
 */
export function buildEdgeList(indices: Uint32Array): Uint32Array {
    let maxIdx = 0;
    for (const idx of indices) if (idx > maxIdx) maxIdx = idx;
    const stride = maxIdx + 1;
    const seen = new Set<number>();
    const lines: number[] = [];
    const addEdge = (u: number, v: number) => {
        const a = Math.min(u, v);
        const b = Math.max(u, v);
        const key = a * stride + b;
        if (seen.has(key)) return;
        seen.add(key);
        lines.push(a, b);
    };
    const triCount = Math.floor(indices.length / 3);
    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
        addEdge(i0, i1);
        addEdge(i1, i2);
        addEdge(i2, i0);
    }
    return new Uint32Array(lines);
}

/** Live LOD snapshot returned by `getLodDebugInfo()` — see that method's doc comment. */
export interface LodDebugInfo {
    zoom: number;
    pointLevel: number;
    pointRatio: number;
    pointReady: boolean;
    meshLevel: number;
    meshRatio: number;
    meshReady: boolean;
    /** Full-res triangle count (level 0), and the triangle count actually drawn at `meshLevel`. */
    meshTriangleCount: number;
    meshDisplayedTriangleCount: number;
}
/** Hysteresis band (zoom units) around each threshold to avoid flicker when
 *  the camera hovers/animates right at a level boundary. */
const LOD_HYSTERESIS = 0.1;

/**
 * Pick the LOD level for the current zoom. Levels are ordered finest-first
 * (index 0 = full detail); a level `i > 0` applies once `zoom` drops below
 * `referenceZoom + levels[i].zoomOffset`. `prevLevel` adds hysteresis: moving
 * to a coarser level requires crossing the threshold by `LOD_HYSTERESIS`,
 * and moving back to a finer level requires crossing back by the same
 * margin — a plain nearest-threshold pick would flicker every frame when the
 * zoom sits exactly on a boundary (e.g. during a smooth zoom animation).
 */
function pickLodLevel(zoom: number, referenceZoom: number, levels: readonly LodLevel[], prevLevel: number): number {
    let level = 0;
    for (let i = levels.length - 1; i >= 1; i--) {
        const threshold = referenceZoom + levels[i].zoomOffset;
        // Moving further from full detail than prevLevel: cross threshold - margin.
        // Moving back towards full detail: only cross back at threshold + margin.
        const margin = i > prevLevel ? -LOD_HYSTERESIS : LOD_HYSTERESIS;
        if (zoom < threshold + margin) { level = i; break; }
    }
    return level;
}

/**
 * Pick `target` indices out of `[0, total)`, evenly spread by position (a
 * plain "keep every Nth point" walk, generalized to non-integer strides so it
 * lands on an exact count for any ratio). Unlike a triangle mesh, a point
 * cloud has no connectivity to preserve, so this is all a point-cloud LOD
 * level needs — no simplification algorithm required, and unlike
 * `MeshoptSimplifier.simplifyPoints` (a density-based voxel clustering that
 * assumes a roughly uniform point distribution to estimate its cell size) it
 * always hits the target exactly, regardless of how uneven the real spatial
 * density is (dense canopy vs sparse bare ground/water in a LiDAR cloud).
 */
function pointStrideIndices(total: number, target: number): Uint32Array {
    const out = new Uint32Array(Math.max(0, target));
    if (target <= 0 || total <= 0) return out;
    const step = total / target;
    for (let k = 0; k < target; k++) out[k] = Math.min(total - 1, Math.floor(k * step));
    return out;
}

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
    /**
     * Final multiplier applied to the computed point size, AFTER the normal
     * 1..16 device-pixel clamp — used to compensate for a supersampled export
     * capture (see `ShowcaseExport.downloadFrame`). `gl_PointSize` is set in
     * drawing-buffer (device) pixels, not CSS pixels, so boosting the map's
     * pixel ratio for a higher-resolution screenshot without also scaling
     * this up would shrink every point (proportionally to the resolution
     * boost) relative to the exported image — most visible on non-ground
     * (vegetation) points, since the reconstructed ground mesh has no point
     * size to shrink. Always 1 outside of an export capture.
     */
    pointSizeMultiplier: number;
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
     * Distance-based LOD: decimate the point cloud / simplify the mesh once
     * the map is zoomed far below `referenceZoom` (see POINT_LOD_LEVELS /
     * MESH_LOD_LEVELS). Dev-only debug toggle — always true in normal use.
     */
    lodEnabled: boolean;
    /**
     * Debug-only override: when set (0/1/2), pins both the point and mesh LOD
     * to this level regardless of the current zoom, so the effect of a level
     * can be inspected without having to zoom out to reach it. `null` (the
     * normal/production behaviour) picks the level from zoom vs
     * `referenceZoom` as usual. Ignored entirely when `lodEnabled` is false.
     */
    lodForceLevel: number | null;
    /**
     * Force du drapage de l'orthophoto IGN sur la géométrie, séparée en deux :
     * `photoOpacityGround` s'applique au sol (points classes 2 sol + 9 eau + mesh reconstruit)
     * et `photoOpacityNonGround` au hors-sol (végétation, bâti, …). 0 = palette
     * de relief pure, 1 = photo opaque.
     */
    photoOpacityGround: number;
    photoOpacityNonGround: number;
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
    /** Master toggle for the enhanced vegetation rendering (round splats, size boost). */
    vegEnhance: boolean;
    /** Point-size multiplier applied to vegetation points. */
    vegSizeBoost: number;
    /** Strength of normal-driven relief shading on vegetation (0 = flat/EDL only, 1 = full). */
    vegNormalShade: number;
    /** Foliage palette blend strength (0 = flat class colour, 1 = full palette). */
    vegIntensity: number;
    /** Height (m) mapped to the top of the foliage palette. */
    vegHeightScale: number;
    /** Foliage palette: 0 = natural ramp, 1 = viridis height colormap, 2 = species. */
    vegColorMode: number;
    /** BD Forêt detail: 'group' (coarse) or 'species' (concrete leaf). */
    forestGrouping: ForestGrouping;
    /** Grid-hash cell size (m) for the mix fallback when no treeSeed is present. */
    forestMixCellSize: number;
    /** Whether the legend filter hides unmasked species/groups. */
    forestSpeciesFilterOn: boolean;
    /**
     * Debug: draw the reconstructed ground mesh as a plain wireframe (no
     * lighting, no texture) so the triangle density is directly visible.
     * Enabled from the `?debug=mesh` URL flag.
     */
    meshWireframe: boolean;
}

/**
 * Cross-cloud (but explicitly NOT cross-terrain) shared depth buffer.
 *
 * Each loaded LiDAR cloud/mesh is its own independent `LidarWebGLLayer`
 * custom-layer instance (own FBO, own LOD/culling — see LidarCloudOverlay).
 * When two clouds overlap on screen, whichever layer's FBO-composite blit ran
 * last used to always win visually, regardless of which was actually nearer
 * the camera. Testing that composite against MapLibre's REAL shared depth
 * buffer would fix cloud-vs-cloud ordering, but it would also let terrain
 * occlude LiDAR — and that's deliberately never wanted: terrain elevation is
 * frequently imprecise, and LiDAR must always stay visible on top of it, even
 * where the (wrong) terrain height would otherwise hide it.
 *
 * So this keeps a SEPARATE, LiDAR-only depth texture (a real depth-attachment
 * texture, hardware LEQUAL-tested), used purely to arbitrate cloud-vs-cloud
 * occlusion. It's written by every instance (`_writeSharedDepth`) right after
 * `_exportDepthToMapLibre`, then sampled during the FBO→MapLibre composite
 * (`edl.frag`'s `u_sharedDepth`) to discard a pixel if a NEARER cloud already
 * claimed it this frame. The result is order-independent: whichever cloud is
 * truly nearest ends up visible regardless of which LidarWebGLLayer instance
 * MapLibre happens to render first/last. MapLibre's own depth buffer / terrain
 * is never read here, so LiDAR still always wins over terrain, exactly as
 * before.
 */
class SharedLidarDepth {
    private _fbo: WebGLFramebuffer | null = null;
    private _tex: WebGLTexture | null = null;
    private _w = 0;
    private _h = 0;
    /**
     * True for the duration of one MapLibre repaint. Set by the first LiDAR
     * layer to render this frame (which also clears the shared depth) and reset
     * via a microtask that only runs once the whole synchronous render loop —
     * every LiDAR layer's `render()` — has finished. This finds frame boundaries
     * without counting layers, so it stays correct even when some clouds are
     * frustum-culled, hidden or still loading and skip rendering entirely.
     */
    private _frameActive = false;

    get texture(): WebGLTexture | null {
        return this._tex;
    }

    get framebuffer(): WebGLFramebuffer | null {
        return this._fbo;
    }

    /**
     * Call once per instance per `render()`, before writing its own depth.
     * Clears the shared depth texture exactly once per repaint: the first LiDAR
     * layer of the frame does the clear and marks the frame active; a microtask
     * resets that flag, and since microtasks can't run until the current task
     * (MapLibre's whole synchronous render loop, i.e. every LiDAR layer's
     * `render()`) has drained, the flag stays set for the entire frame and
     * clears exactly once at the next one — regardless of how many clouds
     * actually render.
     */
    beginLayer(gl: WebGL2RenderingContext, w: number, h: number): void {
        this._ensureSize(gl, w, h);
        if (this._frameActive) return;
        this._frameActive = true;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.viewport(0, 0, w, h);
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        queueMicrotask(() => { this._frameActive = false; });
    }

    private _ensureSize(gl: WebGL2RenderingContext, w: number, h: number): void {
        if (!this._fbo) {
            this._fbo = gl.createFramebuffer();
            this._tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this._tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._tex, 0);
            gl.drawBuffers([gl.NONE]);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        if (this._w === w && this._h === h) return;
        this._w = w;
        this._h = h;
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

const sharedLidarDepth = new SharedLidarDepth();

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
    private _hgtBuf: WebGLBuffer | null = null;
    private _tfvBuf: WebGLBuffer | null = null;
    private _seedBuf: WebGLBuffer | null = null;
    private _diagBuf: WebGLBuffer | null = null;
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
        photoOpacityGround: WebGLUniformLocation | null;
        photoOpacityNonGround: WebGLUniformLocation | null;
        hasPhoto: WebGLUniformLocation | null;
        vegEnhance: WebGLUniformLocation | null;
        vegSizeBoost: WebGLUniformLocation | null;
        vegNormalShade: WebGLUniformLocation | null;
        vegIntensity: WebGLUniformLocation | null;
        vegHeightScale: WebGLUniformLocation | null;
        vegColorMode: WebGLUniformLocation | null;
        forestGrouping: WebGLUniformLocation | null;
        forestMixCellSize: WebGLUniformLocation | null;
        forestSpeciesFilterOn: WebGLUniformLocation | null;
        forestPalette: WebGLUniformLocation | null;
        catGroup: WebGLUniformLocation | null;
        catSpecies: WebGLUniformLocation | null;
        catMixBase: WebGLUniformLocation | null;
        catMixCount: WebGLUniformLocation | null;
        mixSpecies: WebGLUniformLocation | null;
        speciesMask: WebGLUniformLocation | null;
    } = { matrix: null, mpu: null, ps: null, classMask: null, sunDir: null, sunIntensity: null, sunColor: null, flatLight: null, lightMatrix: null, shadowMap: null, shadowEnabled: null, shadowBias: null, shadowTexel: null, shadowStrength: null, uvRect: null, ortho: null, photoOpacityGround: null, photoOpacityNonGround: null, hasPhoto: null, vegEnhance: null, vegSizeBoost: null, vegNormalShade: null, vegIntensity: null, vegHeightScale: null, vegColorMode: null, forestGrouping: null, forestMixCellSize: null, forestSpeciesFilterOn: null, forestPalette: null, catGroup: null, catSpecies: null, catMixBase: null, catMixCount: null, mixSpecies: null, speciesMask: null };

    /** 256-bit visibility mask (8 × uint32), index i = bit set ⇒ class i visible. */
    private readonly _classMask = new Uint32Array(8).fill(0xffffffff);

    // ── IGN BD Forêt® species rendering state ──
    /** Static category→group/species/mix lookup tables (Int32, 255 = sentinel). */
    private readonly _forestCatGroup = new Int32Array(32).fill(255);
    private readonly _forestCatSpecies = new Int32Array(32).fill(255);
    private readonly _forestCatMixBase = new Int32Array(32);
    private readonly _forestCatMixCount = new Int32Array(32);
    private readonly _forestMixSpecies = new Int32Array(32);
    /** Active legend palette (16 × RGB), recomputed when the grouping changes. */
    private _forestPalette = buildForestPalette('group');
    private _forestPaletteGrouping: ForestGrouping = 'group';
    /** 256-bit legend-id visibility mask (8 × uint32). */
    private readonly _speciesMask = new Uint32Array(8).fill(0xffffffff);

    // Mesh rendering (mixed mode): drawn into the same FBO before points.
    // Origin (centerLng/centerLat) is guaranteed to match the point cloud's,
    // so we reuse _ox/_oy/_mpu for the transform.
    private _progMesh: WebGLProgram | null = null;
    private _vaoMesh: WebGLVertexArrayObject | null = null;
    private _meshPosBuf: WebGLBuffer | null = null;
    private _meshNorBuf: WebGLBuffer | null = null;
    private _meshColBuf: WebGLBuffer | null = null;
    private _meshBaseBuf: WebGLBuffer | null = null;
    private _meshIdxBuf: WebGLBuffer | null = null;
    private _meshIndexCount = 0;
    // Debug wireframe: a deduplicated GL_LINES edge buffer per LOD level (index i
    // mirrors `_meshLodIdxBuf`, level 0 = full-res), drawn instead of the filled
    // mesh when `config.meshWireframe` is on. Following the LOD keeps zoomed-out
    // wireframes cheap; deduping halves the segment count versus 3 edges/triangle.
    private _meshWireIdxBuf: (WebGLBuffer | null)[] = MESH_LOD_LEVELS.map(() => null);
    private _meshWireCount: number[] = MESH_LOD_LEVELS.map(() => 0);
    // CPU-side triangle indices per LOD level, retained only in wireframe debug
    // mode so the edge buffers can be built lazily the first time the toggle is
    // switched on (the mesh may already be loaded), without keeping them around
    // in the normal render path.
    private _meshCpuIndices: (Uint32Array | null)[] = MESH_LOD_LEVELS.map(() => null);
    // Whether the ground mesh is drawn. Toggled by the "Sol" class chip in the
    // Delaunay/Poisson modes (where ground points are replaced by this mesh).
    private _meshVisible = true;
    // Whether this ENTIRE layer instance (points + mesh + shadow pass) is drawn.
    // Used to hide one loaded cloud among several without discarding its GPU
    // buffers, so re-showing it is instant (see `setVisible`).
    private _visible = true;
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
        photoOpacityGround: WebGLUniformLocation | null;
        hasPhoto: WebGLUniformLocation | null;
        wireframe: WebGLUniformLocation | null;
    } = { matrix: null, mpu: null, sunDir: null, sunIntensity: null, sunColor: null, flatLight: null, lightMatrix: null, shadowMap: null, shadowEnabled: null, shadowBias: null, shadowTexel: null, shadowStrength: null, uvRect: null, ortho: null, photoOpacityGround: null, hasPhoto: null, wireframe: null };

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
        sharedDepth: WebGLUniformLocation | null;
        texelSize: WebGLUniformLocation | null;
        strength: WebGLUniformLocation | null;
        radius: WebGLUniformLocation | null;
        farPlane: WebGLUniformLocation | null;
        aoStrength: WebGLUniformLocation | null;
        aoRadius: WebGLUniformLocation | null;
        opacity: WebGLUniformLocation | null;
    } = { color: null, depth: null, sharedDepth: null, texelSize: null, strength: null, radius: null, farPlane: null, aoStrength: null, aoRadius: null, opacity: null };

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

    // ── Distance-based LOD (points) ──
    // Level 0 has no dedicated buffer: `_drawPointsChunked` falls back to the
    // existing drawArrays(0, _count) path unchanged, so the common in-focus
    // case is byte-identical to before this feature. Levels 1/2 are index
    // buffers into the SAME position/attribute buffers, selecting an evenly
    // spaced subset computed synchronously by `pointStrideIndices`.
    private _pointLodIdxBuf: (WebGLBuffer | null)[] = POINT_LOD_LEVELS.map(() => null);
    private _pointLodCount: number[] = POINT_LOD_LEVELS.map(() => 0);
    private _pointLodLevel = 0;

    // ── Distance-based LOD (mesh) ──
    // Level 0 reuses the existing `_meshIdxBuf` (full-res). Levels 1/2 are
    // simplified index buffers from MeshoptSimplifier.simplify(), reusing the
    // same vertex buffers (positions/normals/colors are untouched).
    private _meshLodIdxBuf: (WebGLBuffer | null)[] = MESH_LOD_LEVELS.map(() => null);
    private _meshLodCount: number[] = MESH_LOD_LEVELS.map(() => 0);
    private _meshLodLevel = 0;
    private _meshGeneration = 0;

    config: LidarWebGLLayerConfig = {
        pointSize: 2,
        adaptiveSize: true,
        referenceZoom: 19,
        pointSizeMultiplier: 1,
        edlEnabled: false,
        edlStrength: 40,
        edlRadius: 0.7,
        edlFarPlane: 350,
        aoStrength: 0,
        aoRadius: 3,
        opacity: 1,
        lodEnabled: true,
        lodForceLevel: null,
        photoOpacityGround: 0,
        photoOpacityNonGround: 0,
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
        vegEnhance: true,
        vegSizeBoost: 1.3,
        vegNormalShade: 1,
        vegIntensity: 0.7,
        vegHeightScale: 25,
        vegColorMode: 0,
        forestGrouping: 'group',
        forestMixCellSize: 6,
        forestSpeciesFilterOn: false,
        meshWireframe: false,
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
        // Végétation enrichie : splats ronds, boost de taille, ombrage par normale.
        gl.uniform1f(this._locPoints.vegEnhance, this.config.vegEnhance ? 1 : 0);
        gl.uniform1f(this._locPoints.vegSizeBoost, this.config.vegEnhance ? this.config.vegSizeBoost : 1);
        gl.uniform1f(this._locPoints.vegNormalShade, this.config.vegEnhance ? this.config.vegNormalShade : 1);
        // Coloration du feuillage (calculée dans le VS) : intensité du dégradé,
        // hauteur de référence et palette — de simples uniforms (sliders instantanés).
        gl.uniform1f(this._locPoints.vegIntensity, this.config.vegEnhance ? this.config.vegIntensity : 0);
        gl.uniform1f(this._locPoints.vegHeightScale, this.config.vegHeightScale);
        gl.uniform1f(this._locPoints.vegColorMode, this.config.vegColorMode);
        // IGN BD Forêt species rendering: static category LUTs + the active
        // grouping palette + the legend filter mask. All small uniforms, so the
        // grouping/filter controls are instantaneous (no re-upload of the cloud).
        this._ensureForestPalette();
        gl.uniform1f(this._locPoints.forestGrouping, this.config.forestGrouping === 'species' ? 1 : 0);
        gl.uniform1f(this._locPoints.forestMixCellSize, this.config.forestMixCellSize);
        gl.uniform1f(this._locPoints.forestSpeciesFilterOn, this.config.forestSpeciesFilterOn ? 1 : 0);
        gl.uniform3fv(this._locPoints.forestPalette, this._forestPalette);
        gl.uniform1iv(this._locPoints.catGroup, this._forestCatGroup);
        gl.uniform1iv(this._locPoints.catSpecies, this._forestCatSpecies);
        gl.uniform1iv(this._locPoints.catMixBase, this._forestCatMixBase);
        gl.uniform1iv(this._locPoints.catMixCount, this._forestCatMixCount);
        gl.uniform1iv(this._locPoints.mixSpecies, this._forestMixSpecies);
        gl.uniform1uiv(this._locPoints.speciesMask, this._speciesMask);
        // Orthophoto drapée (unité texture 3 ; 2 est réservée à la shadow map).
        const photoOn = this._hasPhoto && (this.config.photoOpacityGround > 0 || this.config.photoOpacityNonGround > 0);
        gl.uniform4fv(this._locPoints.uvRect, this._uvRect);
        gl.uniform1f(this._locPoints.hasPhoto, photoOn ? 1 : 0);
        gl.uniform1f(this._locPoints.photoOpacityGround, this.config.photoOpacityGround);
        gl.uniform1f(this._locPoints.photoOpacityNonGround, this.config.photoOpacityNonGround);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.uniform1i(this._locPoints.ortho, 3);
        this._bindShadowToProgram(gl, this._locPoints);
    }

    /** Populate the static category→group/species/mix lookup tables (once). */
    private _initForestTables(): void {
        const t = buildForestGpuTables();
        this._forestCatGroup.set(t.catGroup.subarray(0, 32));
        this._forestCatSpecies.set(t.catSpecies.subarray(0, 32));
        this._forestCatMixBase.set(t.catMixBase.subarray(0, 32));
        this._forestCatMixCount.set(t.catMixCount.subarray(0, 32));
        this._forestMixSpecies.fill(0);
        this._forestMixSpecies.set(t.mixSpecies.subarray(0, Math.min(32, t.mixSpecies.length)));
    }

    /** Rebuild the active palette when the grouping mode changes. */
    private _ensureForestPalette(): void {
        if (this._forestPaletteGrouping === this.config.forestGrouping) return;
        this._forestPaletteGrouping = this.config.forestGrouping;
        this._forestPalette = buildForestPalette(this.config.forestGrouping);
    }

    /**
     * Set the 256-bit legend-id visibility mask used by the species filter.
     * Bit `i` set ⇒ legend id `i` is shown. Mirrors {@link setClassMask}.
     */
    setSpeciesMask(mask: Uint32Array): void {
        this._speciesMask.set(mask.subarray(0, 8));
        this._map?.triggerRepaint();
    }

    /**
     * Re-upload only the per-tree seed buffer (BD Forêt mix mosaic). Used when
     * the treetop-detection sensitivity changes, so we don't re-upload the whole
     * cloud. `seed.length` must equal the current point count.
     */
    setTreeSeed(seed: Uint8Array): void {
        const gl = this._gl;
        if (!gl || seed.length !== this._count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._seedBuf);
        gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this._map?.triggerRepaint();
    }

    /**
     * Re-upload only the per-point BD Forêt category buffer (`a_tfv`). Used when
     * the essence-boundary blend mode (sharp / feather / scatter) changes, so we
     * re-label points on the CPU and push just this attribute instead of the
     * whole cloud. `tfv.length` must equal the current point count.
     */
    setForestTfv(tfv: Uint8Array): void {
        const gl = this._gl;
        if (!gl || tfv.length !== this._count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._tfvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, tfv, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this._map?.triggerRepaint();
    }

    /**
     * Re-upload only the per-point height-decision diagnostics buffer
     * (`a_vegDiag`, 4 bytes/point). Used after a live veg-height recompute so the
     * « Analyse hauteur » false-colour modes refresh without re-pushing the whole
     * cloud. `diag.length` must equal 4 × the current point count.
     */
    setVegDiag(diag: Uint8Array): void {
        const gl = this._gl;
        if (!gl || diag.length !== this._count * 4) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._diagBuf);
        gl.bufferData(gl.ARRAY_BUFFER, diag, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this._map?.triggerRepaint();
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, _args: CustomRenderMethodInput): void {
        if (!this._visible || (!this._count && !this._meshIndexCount) || !this._progPoints || !this._vao) {
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

        // Distance-based LOD: pick the point/mesh detail level for the current
        // zoom once per frame (see pickLodLevel doc comment). Disabled ⇒ always
        // level 0 (full detail, byte-identical to before this feature).
        this._updateLodLevels();

        const canvas = gl2.canvas as HTMLCanvasElement;
        const w = canvas.width;
        const h = canvas.height;

        // Save MapLibre's state
        const prevProg = gl2.getParameter(gl2.CURRENT_PROGRAM);
        const prevVAO = gl2.getParameter(gl2.VERTEX_ARRAY_BINDING);
        const prevFBO = gl2.getParameter(gl2.FRAMEBUFFER_BINDING);
        const prevBlend = gl2.isEnabled(gl2.BLEND);
        const prevDepthTest = gl2.isEnabled(gl2.DEPTH_TEST);
        // MapLibre narrows the depth range to a per-layer sub-slice (for layer
        // ordering) before calling us — and a DIFFERENT slice for each of the two
        // lidar layers. `gl_FragCoord.z` written into `_texDepth.g` during the FBO
        // pass below would therefore be in a per-layer scale, incomparable to the
        // full-[0,1] depth `_writeSharedDepth` stores. We force [0,1] for the FBO
        // geometry so both live in the same scale, then restore MapLibre's range.
        const prevDepthRange = gl2.getParameter(gl2.DEPTH_RANGE) as Float32Array;

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
            gl2.depthRange(0, 1);
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

            // Write this cloud's depth into the LiDAR-only shared depth buffer
            // (arbitrates cloud-vs-cloud occlusion below; never compared against
            // terrain — see SharedLidarDepth doc comment).
            this._writeSharedDepth(gl2, translatedMatrix, effectivePointSize);

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

            gl2.activeTexture(gl2.TEXTURE2);
            gl2.bindTexture(gl2.TEXTURE_2D, sharedLidarDepth.texture);
            gl2.uniform1i(this._locEdl.sharedDepth, 2);

            gl2.uniform2f(this._locEdl.texelSize, 1 / w, 1 / h);
            gl2.uniform1f(this._locEdl.strength, this.config.edlStrength);
            gl2.uniform1f(this._locEdl.radius, this.config.edlRadius);
            gl2.uniform1f(this._locEdl.farPlane, this.config.edlFarPlane);
            gl2.uniform1f(this._locEdl.aoStrength, this.config.aoStrength);
            gl2.uniform1f(this._locEdl.aoRadius, this.config.aoRadius);
            gl2.uniform1f(this._locEdl.opacity, this.config.opacity);

            // NOT depth-tested against MapLibre's real (terrain-including) depth
            // buffer on purpose: LiDAR must always render on top of terrain, even
            // where imprecise terrain elevation would otherwise hide it. Cloud-vs-
            // cloud occlusion is instead resolved in edl.frag via u_sharedDepth.
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
            gl2.depthRange(0, 1);
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

            // Write this cloud's depth into the LiDAR-only shared depth buffer
            // (arbitrates cloud-vs-cloud occlusion below; never compared against
            // terrain — see SharedLidarDepth doc comment).
            this._writeSharedDepth(gl2, translatedMatrix, effectivePointSize);

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

            gl2.activeTexture(gl2.TEXTURE2);
            gl2.bindTexture(gl2.TEXTURE_2D, sharedLidarDepth.texture);
            gl2.uniform1i(this._locEdl.sharedDepth, 2);

            gl2.uniform2f(this._locEdl.texelSize, 1 / w, 1 / h);
            gl2.uniform1f(this._locEdl.strength, 0);
            gl2.uniform1f(this._locEdl.radius, this.config.edlRadius);
            gl2.uniform1f(this._locEdl.farPlane, this.config.edlFarPlane);
            gl2.uniform1f(this._locEdl.aoStrength, this.config.aoStrength);
            gl2.uniform1f(this._locEdl.aoRadius, this.config.aoRadius);
            gl2.uniform1f(this._locEdl.opacity, this.config.opacity);

            // See comment in the EDL path above: never depth-test against
            // MapLibre's real (terrain-including) depth buffer — LiDAR must
            // always stay on top of terrain. Cloud-vs-cloud occlusion is
            // resolved in edl.frag via u_sharedDepth instead.
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
        gl2.depthRange(prevDepthRange[0], prevDepthRange[1]);
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
        if (!this.config.adaptiveSize || !this._map) return Math.max(base, 1) * this.config.pointSizeMultiplier;
        const zoom = this._map.getZoom();
        const dz = zoom - this.config.referenceZoom;
        const scale = Math.pow(2, dz * 0.5);
        return Math.min(16, Math.max(1, base * scale)) * this.config.pointSizeMultiplier;
    }

    /**
     * Refresh `_pointLodLevel`/`_meshLodLevel` for the current zoom. A level is
     * only actually used by `_drawPointsChunked`/`_drawMeshChunked` once its
     * buffer has finished computing (`_pointLodCount[level] > 0`), so a cloud
     * that just loaded keeps drawing at level 0 until the async simplification
     * catches up — never a stall, only a delayed decimation. `lodForceLevel`
     * (debug-only) bypasses the zoom heuristic entirely, pinning both levels
     * so a level's visual effect can be inspected without zooming.
     */
    private _updateLodLevels(): void {
        if (!this.config.lodEnabled || !this._map) {
            this._pointLodLevel = 0;
            this._meshLodLevel = 0;
            return;
        }
        if (this.config.lodForceLevel !== null) {
            const forced = Math.max(0, Math.min(POINT_LOD_LEVELS.length - 1, this.config.lodForceLevel));
            this._pointLodLevel = forced;
            this._meshLodLevel = Math.min(forced, MESH_LOD_LEVELS.length - 1);
            return;
        }
        const zoom = this._map.getZoom();
        const ref = this.config.referenceZoom;
        this._pointLodLevel = pickLodLevel(zoom, ref, POINT_LOD_LEVELS, this._pointLodLevel);
        this._meshLodLevel = pickLodLevel(zoom, ref, MESH_LOD_LEVELS, this._meshLodLevel);
    }

    setData(data: {
        positions: Float32Array;
        normals: Float32Array;
        colors: Uint8Array;
        classifications: Uint8Array;
        heights: Float32Array;
        originLng: number;
        originLat: number;
        forestTfv?: Uint8Array;
        treeSeed?: Uint8Array;
        vegDiag?: Uint8Array;
    }): void {
        const { positions, normals, colors, classifications, heights, originLng, originLat } = data;
        const mc = MercatorCoordinate.fromLngLat({ lng: originLng, lat: originLat });
        this._ox = mc.x;
        this._oy = mc.y;
        this._mpu = mc.meterInMercatorCoordinateUnits();
        this._count = positions.length / 3;
        this._pointBbox = computeBbox(positions);
        this._pointLodCount = POINT_LOD_LEVELS.map(() => 0);
        this._pointLodLevel = 0;

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
        gl.bindBuffer(gl.ARRAY_BUFFER, this._hgtBuf);
        gl.bufferData(gl.ARRAY_BUFFER, heights, gl.STATIC_DRAW);
        // BD Forêt category + per-tree seed. Default to 255 (no forest data) when
        // the pipeline could not type the vegetation — the shader then falls back
        // to the generic height ramp.
        const tfv = data.forestTfv ?? new Uint8Array(this._count).fill(255);
        const seed = data.treeSeed ?? new Uint8Array(this._count).fill(255);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._tfvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, tfv, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._seedBuf);
        gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW);
        // Per-point height-decision diagnostics (4 bytes/point). Zeros when the
        // cloud predates the diagnostics (restored scene) — the shader then never
        // enters a diagnostic mode for it.
        const diag = data.vegDiag ?? new Uint8Array(this._count * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._diagBuf);
        gl.bufferData(gl.ARRAY_BUFFER, diag, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        gl.bindVertexArray(prevVAO);
        this._map?.triggerRepaint();
        this._computePointLods(positions);
    }

    /**
     * Compute the coarser point-cloud LOD levels: unlike a triangle mesh,
     * dropping points by index can't tear anything (there's no connectivity
     * to preserve), so each level is just "keep every Nth point" via
     * `pointStrideIndices` — an O(target) walk, cheap enough (a few ms even
     * for a multi-million-point gallery scene) to run synchronously right
     * here, with no worker round-trip and no approximation error (unlike
     * `MeshoptSimplifier.simplifyPoints`'s density-based clustering, which
     * can undershoot the target badly on a real LiDAR cloud's very
     * non-uniform density — dense canopy vs sparse bare ground/water).
     */
    private _computePointLods(positions: Float32Array): void {
        const gl = this._gl;
        if (!gl) return;
        const levels = POINT_LOD_LEVELS;
        const total = positions.length / 3;
        for (let i = 1; i < levels.length; i++) {
            const target = Math.max(1, Math.round(total * levels[i].ratio));
            const indices = pointStrideIndices(total, target);
            this._pointLodIdxBuf[i] ??= gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._pointLodIdxBuf[i]);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
            this._pointLodCount[i] = indices.length;
        }
        this._map?.triggerRepaint();
    }

    clear(): void {
        this._count = 0;
        this._pointBbox = null;
        this._pointLodCount = POINT_LOD_LEVELS.map(() => 0);
        this._pointLodLevel = 0;
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
        baseMask?: Uint8Array,
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
        const generation = ++this._meshGeneration;
        this._meshLodCount = MESH_LOD_LEVELS.map(() => 0);
        this._meshWireCount = MESH_LOD_LEVELS.map(() => 0);
        this._meshCpuIndices = MESH_LOD_LEVELS.map(() => null);
        this._meshLodLevel = 0;
        const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshPosBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshNorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshColBuf);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshBaseBuf);
        gl.bufferData(gl.ARRAY_BUFFER, baseMask ?? new Uint8Array(positions.length / 3), gl.STATIC_DRAW);
        gl.bindVertexArray(this._vaoMesh);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshIdxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        gl.bindVertexArray(prevVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        if (isMeshWireframeDebugEnabled()) {
            this._meshCpuIndices[0] = indices;
            if (this.config.meshWireframe) this._buildWireLevel(gl, indices, 0);
        }
        this._map?.triggerRepaint();
        this._computeMeshLods(generation, positions, indices);
    }

    /**
     * Compute the coarser mesh LOD levels off the render path: the WASM
     * simplification runs in a dedicated Web Worker (`lodWorkerClient.ts`) so
     * it never blocks the main thread, and levels stream back one at a time
     * so the browser can start using each as soon as it's ready. Guarded by
     * `generation` so a mesh that's since been replaced (or cleared) can't
     * have its buffers clobbered by a stale result — unlike point LOD
     * (`_computePointLods`), this can't just be done synchronously: triangles
     * can't be dropped by index without tearing the surface, so it genuinely
     * needs the WASM edge-collapse simplifier, which is slow enough on dense
     * gallery scenes to require a worker.
     * `LockBorder` (applied inside the worker) keeps the reconstructed ground
     * mesh's outer capture-radius edge from shrinking/deforming, so it stays
     * visually consistent with the (undecimated) point-cloud edge at low LOD.
     */
    private _computeMeshLods(generation: number, positions: Float32Array, indices: Uint32Array): void {
        const levels = MESH_LOD_LEVELS;
        const targets = levels.slice(1).map((level) => Math.max(3, Math.round((indices.length * level.ratio) / 3) * 3));
        requestMeshLods(positions, indices, targets, (levelIndex, simplified) => {
            if (generation !== this._meshGeneration) return;
            const gl = this._gl;
            if (!gl) return; // layer torn down mid-computation: nothing left to upload to
            const i = levelIndex + 1;
            this._meshLodIdxBuf[i] ??= gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshLodIdxBuf[i]);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, simplified, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
            this._meshLodCount[i] = simplified.length;
            if (isMeshWireframeDebugEnabled()) {
                this._meshCpuIndices[i] = simplified;
                if (this.config.meshWireframe) this._buildWireLevel(gl, simplified, i);
            }
            this._map?.triggerRepaint();
        }).catch(() => { /* worker unavailable/crashed: LOD stays at level 0, no functional loss */ });
    }

    clearMesh(): void {
        this._meshIndexCount = 0;
        this._shadowDirty = true;
        ++this._meshGeneration;
        this._meshLodCount = MESH_LOD_LEVELS.map(() => 0);
        this._meshWireCount = MESH_LOD_LEVELS.map(() => 0);
        this._meshCpuIndices = MESH_LOD_LEVELS.map(() => null);
        this._meshLodLevel = 0;
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
     * Show/hide this entire cloud/mesh instance (points, mesh and shadow
     * pass). Unlike removing the map layer, the GPU buffers stay allocated,
     * so toggling back on is instant. Used by the multi-cloud list to hide a
     * loaded cloud without unloading it.
     */
    setVisible(visible: boolean): void {
        if (this._visible === visible) return;
        this._visible = visible;
        this._shadowDirty = true;
        this._map?.triggerRepaint();
    }

    /**
     * Debug-only snapshot of the current LOD state (see `isLodDebugEnabled`):
     * which level is currently selected for points/mesh, whether its decimated
     * buffer has finished computing (still drawing level 0 until then), and
     * the ACTUAL ratio of elements kept in the ready buffer (1 = full detail,
     * not decimated). This is measured from the real buffer sizes rather than
     * the level's configured target ratio: `simplify()`'s error tolerance can
     * refuse to reach the requested ratio on already-fairly-planar geometry
     * (it stops simplifying once the shape would distort beyond the allowed
     * error), so the *requested* 35% can end up keeping far more than 35% of
     * the original triangles/points — reporting the target instead of the
     * outcome would make the read-out lie about how much was actually cut.
     */
    getLodDebugInfo(): LodDebugInfo {
        const pointReady = this._pointLodLevel > 0 && this._pointLodCount[this._pointLodLevel] > 0;
        const meshReady = this._meshLodLevel > 0 && this._meshLodCount[this._meshLodLevel] > 0;
        const meshDisplayedIndexCount = meshReady ? this._meshLodCount[this._meshLodLevel] : this._meshIndexCount;
        return {
            zoom: this._map?.getZoom() ?? 0,
            pointLevel: this._pointLodLevel,
            pointRatio: pointReady && this._count > 0 ? this._pointLodCount[this._pointLodLevel] / this._count : 1,
            pointReady,
            meshLevel: this._meshLodLevel,
            meshRatio: meshReady && this._meshIndexCount > 0 ? this._meshLodCount[this._meshLodLevel] / this._meshIndexCount : 1,
            meshReady,
            meshTriangleCount: this._meshIndexCount / 3,
            meshDisplayedTriangleCount: meshDisplayedIndexCount / 3,
        };
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
        const wireTurnedOn = config.meshWireframe === true && !prev.meshWireframe;
        Object.assign(this.config, config);
        if (sunChanged || lightModeChanged || sizeChanged) this._shadowDirty = true;
        if (wireTurnedOn) this._ensureWireframe();
        this._map?.triggerRepaint();
    }

    /**
     * Lazily build any missing wireframe edge buffers from the retained CPU
     * indices. Called when the debug wireframe toggle is switched on after the
     * mesh has already loaded (so `setMesh` didn't build them yet).
     */
    private _ensureWireframe(): void {
        const gl = this._gl;
        if (!gl) return;
        for (let level = 0; level < this._meshCpuIndices.length; level++) {
            const idx = this._meshCpuIndices[level];
            if (idx && this._meshWireCount[level] === 0) this._buildWireLevel(gl, idx, level);
        }
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
     *
     * Level 0 (full detail, or a coarser level whose buffer hasn't finished
     * computing yet) keeps the original `drawArrays` path untouched — zero
     * regression risk for the common in-focus case. A ready coarser level
     * switches to `drawElements` over its decimated index buffer instead.
     */
    private _drawPointsChunked(gl: WebGL2RenderingContext): void {
        const level = this._pointLodLevel;
        const idxBuf = level > 0 ? this._pointLodIdxBuf[level] : null;
        const lodCount = level > 0 ? this._pointLodCount[level] : 0;
        if (!idxBuf || lodCount === 0) {
            const total = this._count;
            for (let start = 0; start < total; start += MAX_VERT_IDS_PER_DRAW) {
                const len = Math.min(MAX_VERT_IDS_PER_DRAW, total - start);
                gl.drawArrays(gl.POINTS, start, len);
            }
            return;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        for (let start = 0; start < lodCount; start += MAX_VERT_IDS_PER_DRAW) {
            const len = Math.min(MAX_VERT_IDS_PER_DRAW, lodCount - start);
            gl.drawElements(gl.POINTS, len, gl.UNSIGNED_INT, start * 4);
        }
    }

    /**
     * Build the deduplicated GL_LINES edge buffer for one mesh LOD level from
     * its triangle index buffer. Runs off the render path (setMesh / the async
     * LOD callback), only when the wireframe debug flag is on.
     */
    private _buildWireLevel(gl: WebGL2RenderingContext, indices: Uint32Array, level: number): void {
        const lines = buildEdgeList(indices);
        this._meshWireIdxBuf[level] ??= gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshWireIdxBuf[level]);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        this._meshWireCount[level] = lines.length;
    }

    /**
     * Draw the debug wireframe as GL_LINES, chunked under the per-draw cap.
     * Uses the current LOD level's edge buffer when ready, else falls back to
     * the full-res level 0 (mirrors `_drawMeshChunked`).
     */
    private _drawMeshWire(gl: WebGL2RenderingContext): void {
        const level = this._meshLodLevel;
        const useLod = level > 0 && this._meshWireCount[level] > 0;
        const idxLevel = useLod ? level : 0;
        const total = this._meshWireCount[idxLevel];
        if (!total) return;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshWireIdxBuf[idxLevel]);
        const chunk = MAX_VERT_IDS_PER_DRAW - (MAX_VERT_IDS_PER_DRAW % 2);
        for (let start = 0; start < total; start += chunk) {
            const len = Math.min(chunk, total - start);
            gl.drawElements(gl.LINES, len, gl.UNSIGNED_INT, start * 4);
        }
    }

    /**
     * Draw the mesh element buffer, split into chunks below the per-draw
     * vertex-ID cap. The chunk size is rounded down to a multiple of 3 so a
     * triangle is never split across two draws. Each chunk is a contiguous
     * range of the index buffer; indices still address the full vertex buffer.
     *
     * Level 0 (or a coarser level not ready yet) draws the original full-res
     * index buffer, unchanged; a ready coarser level swaps in its simplified
     * index buffer (same vertex buffers, fewer triangles).
     */
    private _drawMeshChunked(gl: WebGL2RenderingContext): void {
        const level = this._meshLodLevel;
        const useLod = level > 0 && this._meshLodCount[level] > 0;
        const total = useLod ? this._meshLodCount[level] : this._meshIndexCount;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, useLod ? this._meshLodIdxBuf[level] : this._meshIdxBuf);
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
        const photoOn = this._hasPhoto && this.config.photoOpacityGround > 0;
        gl.uniform4fv(this._locMesh.uvRect, this._uvRect);
        gl.uniform1f(this._locMesh.hasPhoto, photoOn ? 1 : 0);
        gl.uniform1f(this._locMesh.photoOpacityGround, this.config.photoOpacityGround);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._orthoTex);
        gl.uniform1i(this._locMesh.ortho, 3);
        this._bindShadowToProgram(gl, this._locMesh);
        gl.bindVertexArray(this._vaoMesh);
        if (this.config.meshWireframe && this._meshWireCount[0] > 0) {
            gl.uniform1f(this._locMesh.wireframe, 1);
            this._drawMeshWire(gl);
        } else {
            gl.uniform1f(this._locMesh.wireframe, 0);
            this._drawMeshChunked(gl);
        }
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
        // Slope-scaled depth bias: the Delaunay 2.5D mesh produces near-vertical
        // stripe triangles on cliffs that, with a constant bias only, self-shadow
        // the flat ground around them. Polygon offset pushes steep faces back
        // proportionally to their depth slope, so vertical stripes stop casting
        // spurious shadows while the smooth Poisson surface is unaffected.
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(6, 24);
        gl.useProgram(this._progShadow);
        gl.uniformMatrix4fv(this._locShadow.lightMatrix, false, this._lightMatrix);
        gl.bindVertexArray(this._vaoMesh);
        this._drawMeshChunked(gl);
        gl.polygonOffset(0, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
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

    /**
     * Depth-only pass into the {@link SharedLidarDepth} texture — completely
     * separate from MapLibre's own framebuffer/terrain. Used ONLY to arbitrate
     * occlusion between overlapping LiDAR clouds/meshes (see that class's doc
     * comment): the hardware LEQUAL test here means whichever cloud is truly
     * nearest ends up owning each pixel in the shared texture, regardless of
     * MapLibre's custom-layer draw order. Terrain is never involved, so LiDAR
     * still always renders on top of it, exactly as before this fix.
     */
    private _writeSharedDepth(gl: WebGL2RenderingContext, translatedMatrix: Float32Array, effectivePointSize: number): void {
        const canvas = gl.canvas as HTMLCanvasElement;
        sharedLidarDepth.beginLayer(gl, canvas.width, canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sharedLidarDepth.framebuffer);
        gl.viewport(0, 0, canvas.width, canvas.height);
        const prevRange = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
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

        // Resize depth texture (RG32F: x = linear EDL depth, y = hardware NDC depth)
        gl.bindTexture(gl.TEXTURE_2D, this._texDepth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, null);

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
            photoOpacityGround: gl.getUniformLocation(this._progPoints, 'u_photoOpacityGround'),
            photoOpacityNonGround: gl.getUniformLocation(this._progPoints, 'u_photoOpacityNonGround'),
            hasPhoto: gl.getUniformLocation(this._progPoints, 'u_hasPhoto'),
            vegEnhance: gl.getUniformLocation(this._progPoints, 'u_vegEnhance'),
            vegSizeBoost: gl.getUniformLocation(this._progPoints, 'u_vegSizeBoost'),
            vegNormalShade: gl.getUniformLocation(this._progPoints, 'u_vegNormalShade'),
            vegIntensity: gl.getUniformLocation(this._progPoints, 'u_vegIntensity'),
            vegHeightScale: gl.getUniformLocation(this._progPoints, 'u_vegHeightScale'),
            vegColorMode: gl.getUniformLocation(this._progPoints, 'u_vegColorMode'),
            forestGrouping: gl.getUniformLocation(this._progPoints, 'u_forestGrouping'),
            forestMixCellSize: gl.getUniformLocation(this._progPoints, 'u_forestMixCellSize'),
            forestSpeciesFilterOn: gl.getUniformLocation(this._progPoints, 'u_speciesFilterOn'),
            forestPalette: gl.getUniformLocation(this._progPoints, 'u_forestPalette[0]'),
            catGroup: gl.getUniformLocation(this._progPoints, 'u_catGroup[0]'),
            catSpecies: gl.getUniformLocation(this._progPoints, 'u_catSpecies[0]'),
            catMixBase: gl.getUniformLocation(this._progPoints, 'u_catMixBase[0]'),
            catMixCount: gl.getUniformLocation(this._progPoints, 'u_catMixCount[0]'),
            mixSpecies: gl.getUniformLocation(this._progPoints, 'u_mixSpecies[0]'),
            speciesMask: gl.getUniformLocation(this._progPoints, 'u_speciesMask[0]'),
        };
        this._initForestTables();

        // ─── Point buffers & VAO ───
        this._posBuf = gl.createBuffer();
        this._norBuf = gl.createBuffer();
        this._colBuf = gl.createBuffer();
        this._clsBuf = gl.createBuffer();
        this._hgtBuf = gl.createBuffer();
        this._tfvBuf = gl.createBuffer();
        this._seedBuf = gl.createBuffer();
        this._diagBuf = gl.createBuffer();

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
        // a_height: per-point height above local ground (m), pre-sanitized CPU-side.
        gl.bindBuffer(gl.ARRAY_BUFFER, this._hgtBuf);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
        // a_tfv: BD Forêt category (uint8, un-normalized 0..255 float in shader).
        gl.bindBuffer(gl.ARRAY_BUFFER, this._tfvBuf);
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        // a_treeSeed: per-tree seed (uint8, un-normalized 0..255 float in shader).
        gl.bindBuffer(gl.ARRAY_BUFFER, this._seedBuf);
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        // a_vegDiag: height-decision diagnostics RGBA (uint8, un-normalized 0..255
        // floats in shader): [blendW, cluster, flags, rough].
        gl.bindBuffer(gl.ARRAY_BUFFER, this._diagBuf);
        gl.enableVertexAttribArray(7);
        gl.vertexAttribPointer(7, 4, gl.UNSIGNED_BYTE, false, 0, 0);
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
            photoOpacityGround: gl.getUniformLocation(this._progMesh, 'u_photoOpacityGround'),
            hasPhoto: gl.getUniformLocation(this._progMesh, 'u_hasPhoto'),
            wireframe: gl.getUniformLocation(this._progMesh, 'u_wireframe'),
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
        this._meshBaseBuf = gl.createBuffer();
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
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshBaseBuf);
        gl.enableVertexAttribArray(3);
        // NOT normalized: the mask stores 0/1, so the ubyte value must reach the
        // shader as 0.0/1.0. Normalizing would map 1 → 1/255 ≈ 0.004 and the
        // `v_base > 0.5` test would never fire.
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._meshIdxBuf);
        gl.bindVertexArray(prevVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

        // ─── EDL shader ───
        this._progEdl = linkProgram(gl, VS_QUAD, FS_EDL);
        this._locEdl = {
            color: gl.getUniformLocation(this._progEdl, 'u_color'),
            depth: gl.getUniformLocation(this._progEdl, 'u_depth'),
            sharedDepth: gl.getUniformLocation(this._progEdl, 'u_sharedDepth'),
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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, 1, 0, gl.RG, gl.FLOAT, null);
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
        delBuf(this._hgtBuf); this._hgtBuf = null;
        delBuf(this._meshPosBuf); this._meshPosBuf = null;
        delBuf(this._meshNorBuf); this._meshNorBuf = null;
        delBuf(this._meshColBuf); this._meshColBuf = null;
        delBuf(this._meshBaseBuf); this._meshBaseBuf = null;
        delBuf(this._meshIdxBuf); this._meshIdxBuf = null;
        for (let i = 0; i < this._meshWireIdxBuf.length; i++) { delBuf(this._meshWireIdxBuf[i]); this._meshWireIdxBuf[i] = null; }
        delBuf(this._quadBuf); this._quadBuf = null;
        for (let i = 0; i < this._pointLodIdxBuf.length; i++) { delBuf(this._pointLodIdxBuf[i]); this._pointLodIdxBuf[i] = null; }
        for (let i = 0; i < this._meshLodIdxBuf.length; i++) { delBuf(this._meshLodIdxBuf[i]); this._meshLodIdxBuf[i] = null; }
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
