import { afterEach, describe, expect, it, vi } from 'vitest';

// The throttle is exercised by the real pipeline, not here: stubbing it keeps
// the backoff `sleep` and the idle deadline as the only timers to drive.
vi.mock('./rateLimiter', () => ({
    acquireGlobal: vi.fn(async () => { }),
    releaseGlobal: vi.fn(),
    noteRateLimit: vi.fn(),
}));

const { createRangeGetter } = await import('./rangeGetter');

const TILE_URL = 'https://example.test/t.copc.laz';

/** A body served chunk by chunk; `hang` keeps it open until the request is aborted. */
function body(chunks: number[], signal: AbortSignal, hang = false): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream<Uint8Array>({
        pull(ctl) {
            if (i < chunks.length) ctl.enqueue(new Uint8Array(chunks[i++]));
            else if (!hang) ctl.close();
            else return new Promise<void>(() => signal.addEventListener('abort', () => ctl.error(signal.reason)));
        },
    });
}

type Reply = (signal: AbortSignal) => Promise<Response>;

const partial = (chunks: number[], hang = false): Reply =>
    async (signal) => ({ status: 206, body: body(chunks, signal, hang) }) as unknown as Response;

/** Stub `fetch` with one reply per call, in order. */
function stubFetch(...replies: Reply[]) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const reply = replies.shift();
        if (!reply) throw new Error('unexpected fetch');
        return reply(init.signal as AbortSignal);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Run `p` while draining the backoff sleeps and idle deadlines it schedules. */
async function withTimers<T>(p: Promise<T>): Promise<T> {
    vi.useFakeTimers();
    // Settle into a thunk right away: a rejection parked behind the fake clock
    // would otherwise surface as an unhandled rejection.
    const settled = p.then(
        (value) => () => value,
        (err: unknown) => () => { throw err; },
    );
    try {
        for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(60_000);
        return (await settled)();
    } finally {
        vi.useRealTimers();
    }
}

describe('createRangeGetter', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('retries a rejected fetch instead of aborting the capture', async () => {
        const fetchMock = stubFetch(
            async () => { throw new TypeError('Failed to fetch'); },
            partial([100]),
        );
        const { get, stats } = createRangeGetter(TILE_URL);
        const buf = await withTimers(get(0, 100));

        expect(buf.byteLength).toBe(100);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(stats).toEqual({ ranges: 1, bytes: 100 });
    });

    it('does not retry a body that is merely a few bytes short', async () => {
        const fetchMock = stubFetch(partial([99]));
        const { get } = createRangeGetter(TILE_URL);
        const err = await withTimers(get(0, 100)).catch((e: Error) => e);

        expect((err as Error).message).toMatch(/plage de 100 octets/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports bytes as they stream in, and takes back those of a stalled attempt', async () => {
        const fetchMock = stubFetch(partial([40], true), partial([60, 40]));
        const reported: number[] = [];
        const { get } = createRangeGetter(TILE_URL);
        const buf = await withTimers(get(0, 100, (n) => reported.push(n)));

        expect(buf.byteLength).toBe(100);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(reported).toEqual([40, -40, 60, 40]);
    });

    it('retries a whole-file 200 without reading past its first bytes', async () => {
        let pulled = 0;
        const whole: Reply = async () => ({
            status: 200,
            body: new ReadableStream<Uint8Array>({
                pull(ctl) { pulled++; ctl.enqueue(new Uint8Array(1024)); },
            }),
        }) as unknown as Response;
        const fetchMock = stubFetch(whole, partial([100]));
        const { get } = createRangeGetter(TILE_URL);
        const buf = await withTimers(get(0, 100));

        expect(buf.byteLength).toBe(100);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(pulled).toBeLessThanOrEqual(2);
    });
});
