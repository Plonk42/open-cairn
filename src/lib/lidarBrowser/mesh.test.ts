import { describe, expect, it } from 'vitest';
import { buildMesh } from '@/lib/lidarBrowser/mesh';
import { DEFAULT_SNOW_LINE } from '@/lib/lidarBrowser/slope';

describe('buildMesh', () => {
    it('returns empty arrays when there are fewer than 3 points', () => {
        const mesh = buildMesh(new Float32Array([0, 0, 0, 1, 0, 0]), 10, 'cliff', DEFAULT_SNOW_LINE);
        expect(mesh.positions).toHaveLength(0);
        expect(mesh.normals).toHaveLength(0);
        expect(mesh.colors).toHaveLength(0);
        expect(mesh.indices).toHaveLength(0);
    });

    it('triangulates a flat grid with upward-facing normals', () => {
        // 2×2 unit square → 2 triangles.
        const positions = new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            1, 1, 0,
        ]);
        const mesh = buildMesh(positions, 5, 'cliff', DEFAULT_SNOW_LINE);
        expect(mesh.positions).toBe(positions); // not duplicated
        expect(mesh.indices.length).toBe(6); // two triangles
        expect(mesh.colors).toHaveLength(4 * 4); // RGBA per vertex
        for (let i = 0; i < 4; i++) {
            expect(mesh.normals[i * 3 + 2]).toBeCloseTo(1, 5); // nz ≈ 1
            expect(mesh.colors[i * 4 + 3]).toBe(255); // opaque
        }
    });

    it('prunes triangles whose edges exceed maxEdge', () => {
        // Two clusters 100 m apart — no triangle should bridge the gap.
        const positions = new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            100, 0, 0,
            101, 0, 0,
            100, 1, 0,
        ]);
        const mesh = buildMesh(positions, 5, 'cliff', DEFAULT_SNOW_LINE);
        // Every kept triangle must have all vertices within one cluster.
        for (let t = 0; t < mesh.indices.length; t += 3) {
            const xs = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
                .map((vi) => positions[vi * 3]);
            const span = Math.max(...xs) - Math.min(...xs);
            expect(span).toBeLessThan(5);
        }
    });
});
