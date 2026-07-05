import { describe, expect, it } from 'vitest';

import { adaptiveDecimateGround, type AdaptiveDecimateOptions } from './adaptiveDecimate';
import type { ScanData } from './scanOrient';

const OPTS: AdaptiveDecimateOptions = {
    cellM: 1.5,
    flatStride: 4,
    sigmaTol: 0.05,
    residualTol: 0.3,
};

/** Build an interleaved (x,y,z) Float32Array from an nx×ny XY grid. */
function grid(nx: number, ny: number, spacing: number, zFn: (x: number, y: number) => number): Float32Array {
    const pts: number[] = [];
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const x = i * spacing;
            const y = j * spacing;
            pts.push(x, y, zFn(x, y));
        }
    }
    return new Float32Array(pts);
}

describe('adaptiveDecimateGround', () => {
    it('is a byte-identical passthrough when flatStride <= 1', () => {
        const pos = grid(20, 20, 0.15, () => 0);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, { ...OPTS, flatStride: 1 });
        expect(r.pos).toBe(pos);
        expect(r.count).toBe(n);
        expect(r.scan).toBeNull();
    });

    it('is a passthrough on an empty cloud', () => {
        const pos = new Float32Array(0);
        const r = adaptiveDecimateGround(pos, 0, null, OPTS);
        expect(r.pos).toBe(pos);
        expect(r.count).toBe(0);
    });

    it('thins a flat horizontal plane', () => {
        const pos = grid(20, 20, 0.15, () => 0);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBeLessThan(n / 3);
        expect(r.count).toBeGreaterThan(0);
    });

    it('thins a smooth inclined plane just like a flat one (orientation-invariant)', () => {
        // A 45° smooth slope must NOT be kept dense — a smooth cliff needs no
        // more points than a smooth field.
        const pos = grid(20, 20, 0.15, (x) => x);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBeLessThan(n / 3);
    });

    it('thins a smooth vertical cliff (x = const plane)', () => {
        // All points on the plane x=0, spanning y and z: still locally planar,
        // so it is thinned like flat ground.
        const pts: number[] = [];
        for (let j = 0; j < 20; j++) {
            for (let k = 0; k < 40; k++) {
                pts.push(0, j * 0.15, k * 0.25);
            }
        }
        const pos = new Float32Array(pts);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBeLessThan(n / 3);
    });

    it('keeps a rough patch at full density', () => {
        // Single cell, z alternating ±0.4 (> residualTol): real relief.
        const pts: number[] = [];
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
                pts.push(i * 0.14, j * 0.14, (i + j) % 2 === 0 ? 0.4 : -0.4);
            }
        }
        const pos = new Float32Array(pts);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBe(n);
    });

    it('keeps a cave / overhang (two stacked Z layers) at full density', () => {
        const pts: number[] = [];
        for (let i = 0; i < 7; i++) {
            for (let j = 0; j < 7; j++) {
                pts.push(i * 0.2, j * 0.2, 0, i * 0.2, j * 0.2, 4);
            }
        }
        const pos = new Float32Array(pts);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBe(n);
    });

    it('keeps a ridge crest / arête at full density', () => {
        const pts: number[] = [];
        for (let i = 0; i < 12; i++) {
            for (let j = 0; j < 8; j++) {
                const x = i * 0.12;
                pts.push(x, j * 0.12, Math.abs(x - 0.66) * 1.5);
            }
        }
        const pos = new Float32Array(pts);
        const n = pos.length / 3;
        const r = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(r.count).toBe(n);
    });

    it('carries scan channels aligned to the kept points', () => {
        const pos = grid(20, 20, 0.15, () => 0);
        const n = pos.length / 3;
        // Encode markers that let us verify alignment without replaying the
        // keep logic: scanAngle = x, gpsTime = z, sourceId = index.
        const scan: ScanData = {
            scanAngle: new Float32Array(n),
            sourceId: new Uint16Array(n),
            gpsTime: new Float64Array(n),
        };
        for (let i = 0; i < n; i++) {
            scan.scanAngle[i] = pos[i * 3];
            scan.sourceId[i] = i;
            scan.gpsTime[i] = pos[i * 3 + 2];
        }
        const r = adaptiveDecimateGround(pos, n, scan, OPTS);
        expect(r.count).toBeLessThan(n);
        const outScan = r.scan;
        expect(outScan).not.toBeNull();
        if (!outScan) return;
        expect(outScan.scanAngle.length).toBe(r.count);
        for (let k = 0; k < r.count; k++) {
            expect(outScan.scanAngle[k]).toBe(r.pos[k * 3]);
            expect(outScan.gpsTime[k]).toBe(r.pos[k * 3 + 2]);
        }
    });

    it('is deterministic', () => {
        const pos = grid(20, 20, 0.15, (x) => x * 0.3);
        const n = pos.length / 3;
        const a = adaptiveDecimateGround(pos, n, null, OPTS);
        const b = adaptiveDecimateGround(pos, n, null, OPTS);
        expect(a.count).toBe(b.count);
        expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    });

    it('thins relief less than flat ground but not entirely, at aggressive flatStride', () => {
        // Same rough single-cell patch (z = ±0.4, residual > residualTol) at two
        // compression levels, plus a flat cloud for comparison.
        const rough: number[] = [];
        const flat: number[] = [];
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
                rough.push(i * 0.14, j * 0.14, (i + j) % 2 === 0 ? 0.4 : -0.4);
                flat.push(i * 0.14, j * 0.14, 0);
            }
        }
        const roughPos = new Float32Array(rough);
        const flatPos = new Float32Array(flat);
        const n = roughPos.length / 3;

        // Gentle stride: relief stays fully intact.
        expect(adaptiveDecimateGround(roughPos, n, null, { ...OPTS, flatStride: 4 }).count).toBe(n);

        // Aggressive stride: relief is thinned a little, but far less than flat.
        const rough32 = adaptiveDecimateGround(roughPos, n, null, { ...OPTS, flatStride: 32 });
        const flat32 = adaptiveDecimateGround(flatPos, n, null, { ...OPTS, flatStride: 32 });
        expect(rough32.count).toBeLessThan(n); // not totally spared
        expect(rough32.count).toBeGreaterThan(flat32.count); // but far denser than flat
    });
});
