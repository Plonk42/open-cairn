/**
 * Gridded heightfield mesh (2.5D, single Z per (x,y)).
 *
 * Bins points into a regular XY grid (cell size = resolution slider), keeps
 * the *minimum* Z per cell (true ground when applied to ground+water input),
 * fills small holes by 3×3 mean of valid neighbours, and emits two indexed
 * triangles per filled quad. Vertex normals are computed from the local
 * height-grid gradient via central differences — cheap, deterministic, and
 * free of the dark-stripe self-shadow artefact that plagues 2.5D Delaunay,
 * where every noisy LiDAR return is its own vertex. The regular sampling acts
 * as a denoising filter, producing a smooth surface that lights cleanly.
 */
import type { MeshResult } from './mesh';
import { vertexColor, type ShaderPreset } from './slope';

const EMPTY: MeshResult = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Uint8Array(0),
    indices: new Uint32Array(0),
};

/**
 * Build a heightfield mesh from a point cloud.
 *
 * @param positions   Interleaved (dx, dy, z) meter-offset float32.
 * @param cellSize    Grid resolution in meters (default 1 m for IGN HD).
 * @param shader      Colour shader preset.
 * @param holeFill    Iterations of 3×3 mean-fill (default 2). Each pass
 *                    extends valid coverage by 1 cell. Large gaps stay empty.
 */
export function buildGridMesh(
    positions: Float32Array,
    cellSize = 1,
    shader: ShaderPreset = 'cliff',
    holeFill = 2,
): MeshResult {
    const n = positions.length / 3;
    if (n < 3) return EMPTY;

    // 1. Bounds.
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const W = Math.max(2, Math.ceil((maxX - minX) / cellSize) + 1);
    const H = Math.max(2, Math.ceil((maxY - minY) / cellSize) + 1);
    if (W * H > 16_000_000) return EMPTY; // hard cap

    // 2. Bin: min Z per cell.
    const z = new Float32Array(W * H);
    const has = new Uint8Array(W * H);
    z.fill(Infinity);
    const invCell = 1 / cellSize;
    for (let i = 0; i < n; i++) {
        const ix = Math.floor((positions[i * 3] - minX) * invCell);
        const iy = Math.floor((positions[i * 3 + 1] - minY) * invCell);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
        const cz = positions[i * 3 + 2];
        const k = iy * W + ix;
        if (cz < z[k]) z[k] = cz;
        has[k] = 1;
    }

    // 3. Hole-fill: 3×3 mean of valid neighbours, repeated `holeFill` times.
    //    Marks newly filled cells in `has` so subsequent passes can extend.
    if (holeFill > 0) {
        let cur = z;
        let curHas = has;
        for (let pass = 0; pass < holeFill; pass++) {
            const next = new Float32Array(cur);
            const nextHas = new Uint8Array(curHas);
            let changed = false;
            for (let iy = 0; iy < H; iy++) {
                for (let ix = 0; ix < W; ix++) {
                    const k = iy * W + ix;
                    if (curHas[k]) continue;
                    let sum = 0, cnt = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        const jy = iy + dy;
                        if (jy < 0 || jy >= H) continue;
                        for (let dx = -1; dx <= 1; dx++) {
                            const jx = ix + dx;
                            if (jx < 0 || jx >= W) continue;
                            const kk = jy * W + jx;
                            if (curHas[kk]) { sum += cur[kk]; cnt++; }
                        }
                    }
                    if (cnt >= 3) { // need at least 3 to interpolate reliably
                        next[k] = sum / cnt;
                        nextHas[k] = 1;
                        changed = true;
                    }
                }
            }
            cur = next;
            curHas = nextHas;
            if (!changed) break;
        }
        z.set(cur);
        has.set(curHas);
    }

    // 4. Build vertex list (one per valid cell). Remap (ix,iy)→vertex index.
    const vmap = new Int32Array(W * H);
    vmap.fill(-1);
    let vCount = 0;
    for (let k = 0; k < W * H; k++) if (has[k]) vmap[k] = vCount++;
    if (vCount < 3) return EMPTY;

    const outPos = new Float32Array(vCount * 3);
    for (let iy = 0; iy < H; iy++) {
        for (let ix = 0; ix < W; ix++) {
            const k = iy * W + ix;
            const v = vmap[k];
            if (v < 0) continue;
            outPos[v * 3] = minX + ix * cellSize;
            outPos[v * 3 + 1] = minY + iy * cellSize;
            outPos[v * 3 + 2] = z[k];
        }
    }

    // 5. Normals from height-grid gradient (central differences).
    const outNormals = new Float32Array(vCount * 3);
    for (let iy = 0; iy < H; iy++) {
        for (let ix = 0; ix < W; ix++) {
            const k = iy * W + ix;
            const v = vmap[k];
            if (v < 0) continue;
            const kxm = ix > 0 ? k - 1 : k;
            const kxp = ix < W - 1 ? k + 1 : k;
            const kym = iy > 0 ? k - W : k;
            const kyp = iy < H - 1 ? k + W : k;
            const zxm = has[kxm] ? z[kxm] : z[k];
            const zxp = has[kxp] ? z[kxp] : z[k];
            const zym = has[kym] ? z[kym] : z[k];
            const zyp = has[kyp] ? z[kyp] : z[k];
            const dzdx = (zxp - zxm) / (2 * cellSize);
            const dzdy = (zyp - zym) / (2 * cellSize);
            // Surface normal of z = f(x,y) is (-dzdx, -dzdy, 1) / |.|
            let nx = -dzdx, ny = -dzdy, nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;
            outNormals[v * 3] = nx;
            outNormals[v * 3 + 1] = ny;
            outNormals[v * 3 + 2] = nz;
        }
    }

    // 6. Colors from the shader palette (same as Delaunay for consistency).
    const outColors = new Uint8Array(vCount * 4);
    for (let v = 0; v < vCount; v++) {
        const [r, g, b] = vertexColor(
            outNormals[v * 3], outNormals[v * 3 + 1], outNormals[v * 3 + 2],
            outPos[v * 3 + 2], shader,
        );
        outColors[v * 4] = r;
        outColors[v * 4 + 1] = g;
        outColors[v * 4 + 2] = b;
        outColors[v * 4 + 3] = 255;
    }

    // 7. Emit two triangles per quad whose 4 corners are all valid AND whose
    //    Z-span is below a lax cutoff (keeps cliffs, drops bridges across
    //    deep canyons / no-data trenches).
    const maxQuadDz = Math.max(50, cellSize * 200);
    const idx: number[] = [];
    for (let iy = 0; iy < H - 1; iy++) {
        for (let ix = 0; ix < W - 1; ix++) {
            const k00 = iy * W + ix;
            const k10 = k00 + 1;
            const k01 = k00 + W;
            const k11 = k01 + 1;
            const v00 = vmap[k00], v10 = vmap[k10], v01 = vmap[k01], v11 = vmap[k11];
            if (v00 < 0 || v10 < 0 || v01 < 0 || v11 < 0) continue;
            const z00 = z[k00], z10 = z[k10], z01 = z[k01], z11 = z[k11];
            const zmin = Math.min(z00, z10, z01, z11);
            const zmax = Math.max(z00, z10, z01, z11);
            if (zmax - zmin > maxQuadDz) continue;
            idx.push(v00, v10, v11, v00, v11, v01);
        }
    }

    return {
        positions: outPos,
        normals: outNormals,
        colors: outColors,
        indices: new Uint32Array(idx),
    };
}
