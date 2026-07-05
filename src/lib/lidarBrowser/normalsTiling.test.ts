import { computeNormalsKNN, computeNormalsTile } from '@/lib/lidarBrowser/normals';
import { planNormalsTiles } from '@/lib/lidarBrowser/normalsTiling';
import { describe, expect, it } from 'vitest';

/**
 * These tests are the Phase 2 correctness gate: jsdom (the vitest test
 * environment) has no real `Worker`, so the actual worker-pool code path can
 * never be exercised here. Instead we call `planNormalsTiles` +
 * `computeNormalsTile` directly (exactly what `normalsWorker.ts` will do
 * inside each worker, minus the postMessage plumbing) and check the
 * reassembled result against sequential `computeNormalsKNN` bit-for-bit.
 */

/** Deterministic pseudo-random point cloud (mulberry32), same generator as normals.test.ts's parity guard. */
function lcgCloud(count: number, seed = 42): Float32Array {
    let s = seed;
    const rand = () => {
        s = s + 0x6D2B79F5;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const x = rand() * 40;
        const y = rand() * 40;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = Math.sin(x * 0.2) * Math.cos(y * 0.15) * 3 + rand() * 0.4;
    }
    return positions;
}

/** Runs the tiled path synchronously (no Worker) and reassembles a full-cloud normals/quality array. */
function computeNormalsTiled(
    positions: Float32Array,
    tileCount: number,
    k: number,
    cellSize: number,
    forceUpward: boolean,
    wantQuality: boolean,
): { normals: Float32Array; quality?: Float32Array } {
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    const quality = wantQuality ? new Float32Array(n) : undefined;
    const tiles = planNormalsTiles(positions, tileCount, cellSize);
    for (const tile of tiles) {
        const result = computeNormalsTile(tile.localPositions, tile.queryLocalIndices, {
            k, cellSize, forceUpward, origin: tile.origin, wantQuality,
        });
        for (let q = 0; q < tile.queryLocalIndices.length; q++) {
            const gi = tile.localToGlobal[tile.queryLocalIndices[q]];
            normals[gi * 3] = result.normals[q * 3];
            normals[gi * 3 + 1] = result.normals[q * 3 + 1];
            normals[gi * 3 + 2] = result.normals[q * 3 + 2];
            if (quality && result.quality) quality[gi] = result.quality[q];
        }
    }
    return { normals, quality };
}

describe('planNormalsTiles + computeNormalsTile (Phase 2 parity)', () => {
    it('reproduces computeNormalsKNN output bit-for-bit across several tile counts', () => {
        const positions = lcgCloud(3000);
        const sequential = computeNormalsKNN(positions, 12, 2, true);
        for (const tileCount of [1, 2, 3, 4, 8]) {
            const { normals } = computeNormalsTiled(positions, tileCount, 12, 2, true, false);
            expect(Array.from(normals)).toEqual(Array.from(sequential));
        }
    });

    it('reproduces quality output bit-for-bit when requested (Poisson ground path)', () => {
        const positions = lcgCloud(2000, 7);
        const sequentialQuality = new Float32Array(positions.length / 3);
        const sequential = computeNormalsKNN(positions, 12, 2, false, sequentialQuality);
        const { normals, quality } = computeNormalsTiled(positions, 5, 12, 2, false, true);
        expect(Array.from(normals)).toEqual(Array.from(sequential));
        expect(quality && Array.from(quality)).toEqual(Array.from(sequentialQuality));
    });

    it('handles more tiles than points gracefully', () => {
        const positions = lcgCloud(3);
        const sequential = computeNormalsKNN(positions, 12, 2, true);
        const { normals } = computeNormalsTiled(positions, 8, 12, 2, true, false);
        expect(Array.from(normals)).toEqual(Array.from(sequential));
    });

    it('every point is covered exactly once across tiles', () => {
        const positions = lcgCloud(777, 99);
        const n = positions.length / 3;
        const tiles = planNormalsTiles(positions, 6, 2);
        const seen = new Int32Array(n);
        for (const tile of tiles) {
            for (const li of tile.queryLocalIndices) {
                seen[tile.localToGlobal[li]]++;
            }
        }
        for (let i = 0; i < n; i++) expect(seen[i]).toBe(1);
    });
});
