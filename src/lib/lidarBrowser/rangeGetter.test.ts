import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawGet = vi.fn<(begin: number, end: number) => Promise<Uint8Array>>();

vi.mock('copc', () => ({ Getter: { create: () => rawGet } }));
// The throttle is exercised by the real pipeline, not here: stubbing it keeps
// the backoff `sleep` as the only timer the fake clock has to drive.
vi.mock('./rateLimiter', () => ({
    acquireGlobal: vi.fn(async () => { }),
    releaseGlobal: vi.fn(),
    noteRateLimit: vi.fn(),
}));

const { createRangeGetter } = await import('./rangeGetter');

/** A `fetch` that drops the connection, as IGN does under load. */
async function connectionDropped(): Promise<Uint8Array> {
    throw new TypeError('Failed to fetch');
}

/** Run `p` while draining the exponential backoff sleeps it schedules. */
async function withBackoff<T>(p: Promise<T>): Promise<T> {
    vi.useFakeTimers();
    // Settle into a thunk right away: a rejection parked behind the fake clock
    // would otherwise surface as an unhandled rejection.
    const settled = p.then(
        (value) => () => value,
        (err: unknown) => () => { throw err; },
    );
    try {
        for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(60_000);
        return (await settled)();
    } finally {
        vi.useRealTimers();
    }
}

describe('createRangeGetter', () => {
    beforeEach(() => rawGet.mockReset());

    it('retries a rejected fetch instead of aborting the capture', async () => {
        rawGet
            .mockImplementationOnce(connectionDropped)
            .mockImplementationOnce(() => Promise.resolve(new Uint8Array(100)));

        const { get, stats } = createRangeGetter('https://example.test/t.copc.laz');
        const buf = await withBackoff(get(0, 100));

        expect(buf.byteLength).toBe(100);
        expect(rawGet).toHaveBeenCalledTimes(2);
        expect(stats).toEqual({ ranges: 1, bytes: 100 });
    });

    it('does not retry a body that is merely a few bytes short', async () => {
        rawGet.mockImplementation(() => Promise.resolve(new Uint8Array(99)));

        const { get } = createRangeGetter('https://example.test/t.copc.laz');
        const err = await withBackoff(get(0, 100)).catch((e: Error) => e);

        expect((err as Error).message).toMatch(/asked 100 B/);
        expect(rawGet).toHaveBeenCalledTimes(1);
    });
});
