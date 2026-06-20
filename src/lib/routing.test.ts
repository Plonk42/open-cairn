import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStraightSegment, computeIgnWalkingSegment, mergeSegments } from '@/lib/routing';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('buildStraightSegment', () => {
    it('returns a two-point segment with distance and walking duration', () => {
        const seg = buildStraightSegment([6.86, 45.83], [6.87, 45.84]);
        expect(seg.coordinates).toHaveLength(2);
        expect(seg.distance).toBeGreaterThan(0);
        // duration = distance / (4/3.6 m/s)
        expect(seg.duration).toBeCloseTo(seg.distance / (4 / 3.6), 6);
    });
});

describe('mergeSegments', () => {
    it('concatenates coordinates (de-duping the shared joint) and sums totals', () => {
        const a = buildStraightSegment([6.86, 45.83], [6.87, 45.84]);
        const b = buildStraightSegment([6.87, 45.84], [6.88, 45.85]);
        const merged = mergeSegments([a, b]);
        // shared midpoint collapsed → 3 unique points
        expect(merged.coordinates).toHaveLength(3);
        expect(merged.distance).toBeCloseTo(a.distance + b.distance, 6);
        expect(merged.duration).toBeCloseTo(a.duration + b.duration, 6);
    });
});

function mockFetch(impl: (url: string) => { ok: boolean; status?: number; body?: unknown }) {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
        const url = input instanceof URL ? input.toString() : input;
        const r = impl(url);
        return {
            ok: r.ok,
            status: r.status ?? (r.ok ? 200 : 500),
            json: async () => r.body,
        } as Response;
    }));
}

describe('computeIgnWalkingSegment', () => {
    it('parses a LineString response into a route segment', async () => {
        mockFetch(() => ({
            ok: true,
            body: {
                geometry: { coordinates: [[6.86, 45.83], [6.865, 45.835], [6.87, 45.84]] },
                distance: 1234,
                duration: 900,
            },
        }));
        const seg = await computeIgnWalkingSegment([6.86, 45.83], [6.87, 45.84]);
        expect(seg.coordinates).toHaveLength(3);
        expect(seg.distance).toBe(1234);
        expect(seg.duration).toBe(900);
    });

    it('falls back to computed distance/duration when the API omits them', async () => {
        mockFetch(() => ({
            ok: true,
            body: { geometry: { coordinates: [[6.86, 45.83], [6.87, 45.84]] } },
        }));
        const seg = await computeIgnWalkingSegment([6.86, 45.83], [6.87, 45.84]);
        expect(seg.distance).toBeGreaterThan(0);
        expect(seg.duration).toBeCloseTo(seg.distance / (4 / 3.6), 6);
    });

    it('sends start and end coordinates in the request URL', async () => {
        const fetchSpy = vi.fn(async (_input: URL | string) => ({
            ok: true,
            status: 200,
            json: async () => ({ geometry: { coordinates: [[6.86, 45.83], [6.87, 45.84]] } }),
        } as Response));
        vi.stubGlobal('fetch', fetchSpy);
        await computeIgnWalkingSegment([6.86, 45.83], [6.87, 45.84]);
        const calledWith = fetchSpy.mock.calls[0][0] as URL;
        expect(calledWith.toString()).toContain('start=6.86%2C45.83');
        expect(calledWith.toString()).toContain('end=6.87%2C45.84');
        expect(calledWith.toString()).toContain('profile=pedestrian');
    });

    it('throws on a non-OK HTTP response', async () => {
        mockFetch(() => ({ ok: false, status: 503 }));
        await expect(computeIgnWalkingSegment([6.86, 45.83], [6.87, 45.84])).rejects.toThrow(/503/);
    });

    it('throws when the geometry is not a usable LineString', async () => {
        mockFetch(() => ({ ok: true, body: { geometry: { coordinates: [[6.86]] } } }));
        await expect(computeIgnWalkingSegment([6.86, 45.83], [6.87, 45.84])).rejects.toThrow(/LineString/);
    });
});
