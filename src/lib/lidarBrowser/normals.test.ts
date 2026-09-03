import { computeNormalsKNN } from '@/lib/lidarBrowser/normals';
import { describe, expect, it } from 'vitest';

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

    it('produces byte-identical output across grid implementations (parity guard)', () => {
        // Deterministic pseudo-random point cloud (mulberry32), irregular enough
        // to exercise every k-NN/grid code path across many populated cells. This
        // snapshot is the parity contract for the CSR spatial-grid refactor
        // (bucket-per-cell Map<number, number[]> → counting-sorted typed arrays):
        // it must never change when only the grid's internal data structure
        // changes, since floating-point accumulation order (and thus exact
        // results) depends on the k-NN candidate iteration order being preserved.
        let seed = 42;
        const rand = () => {
            seed = seed + 0x6D2B79F5;
            let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
            t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const count = 500;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const x = rand() * 40;
            const y = rand() * 40;
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = Math.sin(x * 0.2) * Math.cos(y * 0.15) * 3 + rand() * 0.4;
        }
        const normals = computeNormalsKNN(positions, 12, 2, true);
        expect(Array.from(normals)).toMatchSnapshot();
    });
});

/**
 * A 90° roof ridge along y: the -x side rises at 45°, the +x side falls at 45°.
 * Every point sits exactly on one of the two facets, so the "true" normal is
 * known and the only ambiguity is which facet a near-ridge point belongs to.
 */
function ridgeCloud(halfWidth: number, length: number, spacing: number): Float32Array {
    const cols = Math.round((2 * halfWidth) / spacing) + 1;
    const rows = Math.round(length / spacing) + 1;
    const out = new Float32Array(cols * rows * 3);
    let p = 0;
    for (let c = 0; c < cols; c++) {
        const x = -halfWidth + c * spacing;
        for (let r = 0; r < rows; r++) {
            out[p++] = x;
            out[p++] = r * spacing;
            out[p++] = -Math.abs(x);
        }
    }
    return out;
}

describe('computeNormalsKNN robust refit (crease preservation)', () => {
    /** Angle (deg) between a point's normal and its facet's true normal. */
    function tiltFromFacet(normals: Float32Array, i: number, x: number): number {
        // z = -|x| ⇒ the x < 0 facet has normal (-1, 0, 1)/√2, the x > 0 one (1, 0, 1)/√2.
        const s = x < 0 ? -1 : 1;
        const tx = s * Math.SQRT1_2, tz = Math.SQRT1_2;
        const dot = Math.abs(normals[i * 3] * tx + normals[i * 3 + 2] * tz);
        return Math.acos(Math.min(1, dot)) * 180 / Math.PI;
    }

    it('keeps near-ridge normals on their own facet instead of the bisector', () => {
        const spacing = 0.5;
        const positions = ridgeCloud(4, 6, spacing);
        const n = positions.length / 3;
        const plain = computeNormalsKNN(positions, 12, 2, true);
        const robust = computeNormalsKNN(positions, 12, 2, true, undefined, 1);

        // Points off the ridge line but still inside their own k-neighbourhood of it.
        let plainTilt = 0, robustTilt = 0, sampled = 0;
        for (let i = 0; i < n; i++) {
            const x = positions[i * 3];
            const ax = Math.abs(x);
            if (ax < spacing * 0.5 || ax > spacing * 2.5) continue;
            plainTilt += tiltFromFacet(plain, i, x);
            robustTilt += tiltFromFacet(robust, i, x);
            sampled++;
        }
        expect(sampled).toBeGreaterThan(0);
        expect(robustTilt / sampled).toBeLessThan(plainTilt / sampled * 0.5);
    });

    it('leaves a flat plane untouched (rejection is self-limiting)', () => {
        const positions = flatGrid(8, 1, 0);
        const plain = computeNormalsKNN(positions, 12, 2, true);
        const robust = computeNormalsKNN(positions, 12, 2, true, undefined, 1);
        for (let i = 0; i < positions.length / 3; i++) {
            expect(robust[i * 3 + 2]).toBeCloseTo(plain[i * 3 + 2], 4);
        }
    });

    it('is a no-op at robust = 0', () => {
        const positions = ridgeCloud(4, 6, 0.5);
        const plain = computeNormalsKNN(positions, 12, 2, true);
        const off = computeNormalsKNN(positions, 12, 2, true, undefined, 0);
        expect(Array.from(off)).toEqual(Array.from(plain));
    });
});
