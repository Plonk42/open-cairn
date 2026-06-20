import { describe, expect, it } from 'vitest';
import { computeNormalsKNN } from '@/lib/lidarBrowser/normals';

/** Build an N×N grid of points at constant elevation. */
function flatGrid(size: number, spacing = 1, z = 0): Float32Array {
    const out = new Float32Array(size * size * 3);
    let p = 0;
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            out[p++] = i * spacing;
            out[p++] = j * spacing;
            out[p++] = z;
        }
    }
    return out;
}

describe('computeNormalsKNN', () => {
    it('returns upward normals for degenerate clouds (n < 4)', () => {
        const normals = computeNormalsKNN(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
        expect(normals).toHaveLength(9);
        for (let i = 0; i < 3; i++) {
            expect(normals[i * 3]).toBe(0);
            expect(normals[i * 3 + 1]).toBe(0);
            expect(normals[i * 3 + 2]).toBe(1);
        }
    });

    it('computes near-vertical normals for a flat horizontal plane', () => {
        const positions = flatGrid(6, 1, 0);
        const normals = computeNormalsKNN(positions, 12, 2, true);
        const n = positions.length / 3;
        for (let i = 0; i < n; i++) {
            const nz = normals[i * 3 + 2];
            expect(Math.abs(nz)).toBeCloseTo(1, 4);
        }
    });

    it('forces normals upward when forceUpward is true', () => {
        const positions = flatGrid(6, 1, 0);
        const normals = computeNormalsKNN(positions, 12, 2, true);
        const n = positions.length / 3;
        for (let i = 0; i < n; i++) {
            expect(normals[i * 3 + 2]).toBeGreaterThan(0);
        }
    });

    it('produces unit-length normals', () => {
        const positions = flatGrid(6, 1, 0);
        const normals = computeNormalsKNN(positions);
        const n = positions.length / 3;
        for (let i = 0; i < n; i++) {
            const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
            expect(len).toBeCloseTo(1, 4);
        }
    });
});
