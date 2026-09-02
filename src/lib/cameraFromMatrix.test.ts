import { describe, it, expect } from 'vitest';
import { cameraFromMatrix } from './cameraFromMatrix';

/** Column-major 4×4 multiply: returns a ∘ b (i.e. apply `b` first). */
function mul(a: number[], b: number[]): number[] {
    const out = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
            out[c * 4 + r] = s;
        }
    }
    return out;
}

function perspective(fovy: number, aspect: number, near: number, far: number): number[] {
    const f = 1 / Math.tan(fovy / 2);
    return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
    ];
}

function translate(x: number, y: number, z: number): number[] {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function rotateX(a: number): number[] {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotateZ(a: number): number[] {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

describe('cameraFromMatrix', () => {
    it('recovers the eye of an axis-aligned perspective view', () => {
        const eye: [number, number, number] = [120, -45, 900];
        const m = mul(perspective(Math.PI / 3, 1.6, 1, 10000), translate(-eye[0], -eye[1], -eye[2]));
        const got = cameraFromMatrix(m)!;
        expect(got[0]).toBeCloseTo(eye[0], 3);
        expect(got[1]).toBeCloseTo(eye[1], 3);
        expect(got[2]).toBeCloseTo(eye[2], 3);
    });

    it('recovers the eye of a pitched + rotated view (MapLibre-like)', () => {
        const eye: [number, number, number] = [-3200.5, 8100.25, 2450];
        const view = mul(mul(rotateX(-Math.PI / 3), rotateZ(0.7)), translate(-eye[0], -eye[1], -eye[2]));
        const m = mul(perspective(0.6435, 2, 5, 50000), view);
        const got = cameraFromMatrix(m)!;
        expect(got[0]).toBeCloseTo(eye[0], 1);
        expect(got[1]).toBeCloseTo(eye[1], 1);
        expect(got[2]).toBeCloseTo(eye[2], 1);
    });

    it('stays accurate at the tiny Mercator scales the layer actually uses', () => {
        // 1 metre ≈ 3.53e-8 Mercator units at 45° N; a camera 2 km away.
        const mpu = 3.53e-8;
        const eye: [number, number, number] = [500 * mpu, -300 * mpu, 2000 * mpu];
        const m = mul(perspective(Math.PI / 4, 1.5, 1e-6, 1), translate(-eye[0], -eye[1], -eye[2]));
        const got = cameraFromMatrix(m)!;
        // Compare in metres: sub-millimetre agreement is plenty.
        expect(got[0] / mpu).toBeCloseTo(500, 2);
        expect(got[1] / mpu).toBeCloseTo(-300, 2);
        expect(got[2] / mpu).toBeCloseTo(2000, 2);
    });

    it('returns null for an orthographic matrix (no finite centre of projection)', () => {
        const ortho = [
            2 / 100, 0, 0, 0,
            0, 2 / 100, 0, 0,
            0, 0, -2 / 100, 0,
            0, 0, 0, 1,
        ];
        expect(cameraFromMatrix(ortho)).toBeNull();
    });
});
