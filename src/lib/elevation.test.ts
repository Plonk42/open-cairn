import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeElevationProfile } from '@/lib/elevation';

afterEach(() => {
    vi.unstubAllGlobals();
});

function mockElevation(points: Array<{ lon: number; lat: number; z: number }>) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ elevations: points }),
    } as Response)));
}

describe('computeElevationProfile', () => {
    it('returns an empty profile for fewer than two coordinates', async () => {
        const profile = await computeElevationProfile([[6.86, 45.83]]);
        expect(profile.samples).toEqual([]);
        expect(profile.ascent).toBe(0);
        expect(profile.descent).toBe(0);
    });

    it('accumulates ascent and descent from the elevation samples', async () => {
        mockElevation([
            { lon: 6.86, lat: 45.83, z: 1000 },
            { lon: 6.865, lat: 45.835, z: 1100 },
            { lon: 6.87, lat: 45.84, z: 1050 },
        ]);
        const profile = await computeElevationProfile([[6.86, 45.83], [6.87, 45.84]]);
        expect(profile.samples).toHaveLength(3);
        expect(profile.ascent).toBe(100);
        expect(profile.descent).toBe(50);
    });

    it('treats sentinel no-data elevations (z <= -100) as zero', async () => {
        mockElevation([
            { lon: 6.86, lat: 45.83, z: -99999 },
            { lon: 6.87, lat: 45.84, z: 100 },
        ]);
        const profile = await computeElevationProfile([[6.86, 45.83], [6.87, 45.84]]);
        expect(profile.samples[0].elevation).toBe(0);
        expect(profile.samples[1].elevation).toBe(100);
        expect(profile.ascent).toBe(100);
    });

    it('returns an empty profile when the API yields fewer than two points', async () => {
        mockElevation([{ lon: 6.86, lat: 45.83, z: 1000 }]);
        const profile = await computeElevationProfile([[6.86, 45.83], [6.87, 45.84]]);
        expect(profile.samples).toEqual([]);
    });

    it('throws when the elevation request fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as Response)));
        await expect(computeElevationProfile([[6.86, 45.83], [6.87, 45.84]])).rejects.toThrow(/500/);
    });
});
