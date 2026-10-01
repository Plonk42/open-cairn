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

    it('asks LiDAR HD first and re-reads its no-data samples on RGE ALTI', async () => {
        const byResource: Record<string, number[]> = {
            ign_lidar_hd_mnt_mono_wld: [1000, -99999, 1200],
            ign_rge_alti_wld: [990, 1090, 1190],
        };
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const { resource } = JSON.parse(init.body as string) as { resource: string };
            const z = byResource[resource];
            return {
                ok: true,
                status: 200,
                json: async () => ({ elevations: z.map((value, i) => ({ lon: 6.86 + i * 0.005, lat: 45.83, z: value })) }),
            } as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        const profile = await computeElevationProfile([[6.86, 45.83], [6.87, 45.83]]);
        expect(profile.samples.map((s) => s.elevation)).toEqual([1000, 1090, 1200]);
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string).resource))
            .toEqual(['ign_lidar_hd_mnt_mono_wld', 'ign_rge_alti_wld']);
    });

    it('asks only LiDAR HD when it covers the whole line', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ elevations: [{ lon: 6.86, lat: 45.83, z: 1000 }, { lon: 6.87, lat: 45.83, z: 1100 }] }),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        await computeElevationProfile([[6.86, 45.83], [6.87, 45.83]]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws when the elevation request fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as Response)));
        await expect(computeElevationProfile([[6.86, 45.83], [6.87, 45.84]])).rejects.toThrow(/500/);
    });
});
