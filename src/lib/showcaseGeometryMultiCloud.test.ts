import { describe, expect, it } from 'vitest';

import { decodeShowcaseGeometry, encodeShowcaseGeometry } from '@/lib/showcaseScene';
import type { LidarShadedCloudData } from '@/lib/lidarCloud';

/** Build a tiny synthetic shaded cloud so encode/decode has real buffers to round-trip. */
function makeShaded(seed: number, pointCount = 4): LidarShadedCloudData {
    const positions = new Float32Array(pointCount * 3);
    const normals = new Float32Array(pointCount * 3);
    const colors = new Uint8Array(pointCount * 4);
    const classifications = new Uint8Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
        positions[i * 3] = seed + i;
        positions[i * 3 + 1] = seed + i * 2;
        positions[i * 3 + 2] = seed + i * 3;
        normals[i * 3 + 2] = 1;
        colors[i * 4] = (seed * 10 + i) % 256;
        colors[i * 4 + 3] = 255;
        classifications[i] = 2;
    }
    return {
        kind: 'shaded',
        centerLng: 5.7 + seed,
        centerLat: 45.1 + seed,
        radius: 100,
        pointCount,
        positions,
        normals,
        colors,
        classifications,
    };
}

describe('showcase scene geometry — multi-cloud round trip', () => {
    it('round-trips a single-cloud scene with no extraClouds (backward-compat shape)', async () => {
        const shaded = makeShaded(1);
        const bytes = await encodeShowcaseGeometry({ shaded, mesh: null });
        const decoded = await decodeShowcaseGeometry(bytes.buffer as ArrayBuffer);
        expect(decoded.extraClouds).toBeUndefined();
        expect(decoded.shaded?.pointCount).toBe(shaded.pointCount);
        expect(Array.from(decoded.shaded!.positions)).toEqual(Array.from(shaded.positions));
    });

    it('round-trips a scene bundling several clouds (primary + extraClouds)', async () => {
        const primary = makeShaded(1);
        const extraA = makeShaded(2, 6);
        const extraB = makeShaded(3, 3);

        const bytes = await encodeShowcaseGeometry({
            shaded: primary,
            mesh: null,
            extraClouds: [
                { shaded: extraA, mesh: null },
                { shaded: extraB, mesh: null },
            ],
        });
        const decoded = await decodeShowcaseGeometry(bytes.buffer as ArrayBuffer);

        expect(decoded.shaded?.pointCount).toBe(primary.pointCount);
        expect(Array.from(decoded.shaded!.colors)).toEqual(Array.from(primary.colors));

        expect(decoded.extraClouds).toHaveLength(2);
        expect(decoded.extraClouds![0].shaded?.pointCount).toBe(extraA.pointCount);
        expect(Array.from(decoded.extraClouds![0].shaded!.positions)).toEqual(Array.from(extraA.positions));
        expect(decoded.extraClouds![1].shaded?.pointCount).toBe(extraB.pointCount);
        expect(Array.from(decoded.extraClouds![1].shaded!.positions)).toEqual(Array.from(extraB.positions));
    });
});
