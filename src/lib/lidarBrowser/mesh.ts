/**
 * 2.5D Delaunay mesh from a cropped point set, with edge-length pruning
 * to avoid spanning gaps (cliff occlusions, no-data zones). Port of
 * `services/lidar-cloud/server.mjs::buildMesh()`.
 */
import Delaunator from 'delaunator';
import { vertexColor, type PaletteSettings } from './slope';

export interface MeshResult {
    /** Same vertex array as input (positions are not duplicated). */
    positions: Float32Array;
    /** Interleaved (nx, ny, nz) per vertex, area-weighted average of adjacent triangles. */
    normals: Float32Array;
    /** RGBA per vertex, from the slope palette. */
    colors: Uint8Array;
    /** Triangle vertex indices, length = 3 × triangleCount. */
    indices: Uint32Array;
}

/**
 * Build a 2.5D Delaunay mesh and drop triangles whose longest edge exceeds
 * `maxEdge` meters. Vertex normals are the area-weighted average of the
 * normals of incident triangles, flipped so nz ≥ 0 (LiDAR is from above).
 */
export function buildMesh(
    positions: Float32Array,
    maxEdge: number,
    palette: PaletteSettings,
): MeshResult {
    const n = positions.length / 3;
    if (n < 3) {
        return {
            positions: new Float32Array(0),
            normals: new Float32Array(0),
            colors: new Uint8Array(0),
            indices: new Uint32Array(0),
        };
    }
    const xy = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        xy[i * 2] = positions[i * 3];
        xy[i * 2 + 1] = positions[i * 3 + 1];
    }
    const d = new Delaunator(xy);
    const tris = d.triangles; // Uint32Array
    const maxEdgeSq = maxEdge * maxEdge;

    const normals = new Float32Array(n * 3);
    const keep: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
        const ia = tris[t];
        const ib = tris[t + 1];
        const ic = tris[t + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const eABx = bx - ax, eABy = by - ay;
        const eBCx = cx - bx, eBCy = cy - by;
        const eCAx = ax - cx, eCAy = ay - cy;
        if (
            eABx * eABx + eABy * eABy > maxEdgeSq ||
            eBCx * eBCx + eBCy * eBCy > maxEdgeSq ||
            eCAx * eCAx + eCAy * eCAy > maxEdgeSq
        ) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const sign = nz < 0 ? -1 : 1;
        const nnx = nx * sign, nny = ny * sign, nnz = nz * sign;
        normals[ia * 3] += nnx; normals[ia * 3 + 1] += nny; normals[ia * 3 + 2] += nnz;
        normals[ib * 3] += nnx; normals[ib * 3 + 1] += nny; normals[ib * 3 + 2] += nnz;
        normals[ic * 3] += nnx; normals[ic * 3 + 1] += nny; normals[ic * 3 + 2] += nnz;
        keep.push(ia, ib, ic);
    }

    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            normals[i * 3 + 2] = 1;
        }
    }

    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const z = positions[i * 3 + 2];
        const [r, g, b] = vertexColor(nx, ny, nz, z, palette);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }

    return { positions, normals, colors, indices: new Uint32Array(keep) };
}
