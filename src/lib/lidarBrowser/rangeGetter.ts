/**
 * HTTP Range getter for IGN COPC tiles, with the defences the raw
 * `Getter.create` lacks: the global rate limiter, and a retry on both a short
 * body and a dropped connection.
 *
 * IGN intermittently answers a Range request with 200 (whole ~200 MB file) or
 * with an HTML 429 page. Either way the body length differs from the one asked,
 * which is the only reliable signal — so every response is length-checked
 * before being handed to the LAZ decoder, whose wasm heap a 200 would blow.
 *
 * Under load it also just drops the connection, and `fetch` then rejects with
 * `Failed to fetch`. A single such hiccup among the hundreds of ranges a
 * capture issues used to abort the whole capture, so it is retried too.
 *
 * Worse than a dropped connection is one that stays open and never answers:
 * `fetch` neither resolves nor rejects, the range keeps one of the four global
 * in-flight slots for good, and four of them freeze the whole capture with no
 * error, no log and a progress bar that never moves.
 *
 * So the body is read here as a stream rather than through `Getter.create`:
 * the deadline is on inactivity (a coalesced range can be 16 MB, which takes
 * minutes on a saturated IGN without being stalled), every chunk is reported
 * as it lands, and a non-partial answer is dropped after its first bytes
 * instead of pulling a whole tile.
 */
import { acquireGlobal, noteRateLimit, releaseGlobal } from './rateLimiter';

const MAX_ATTEMPTS = 5;

const RANGE_IDLE_TIMEOUT_MS = 60_000;

/** Byte-range reader handed to the `copc` package. */
export type RangeGet = (begin: number, end: number) => Promise<Uint8Array>;

/** {@link RangeGet} that can also report the bytes of this one read as they land. */
export type TrackedRangeGet = (
    begin: number, end: number, onBytes?: (bytes: number) => void,
) => Promise<Uint8Array>;

/** Bytes and range count fetched so far, for the pipeline's stage logs. */
export interface RangeStats { ranges: number; bytes: number }

type Outcome = { buf: Uint8Array } | { snippet: string; got: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetriable(snippet: string, got: number, expected: number): boolean {
    return /429|503|too many|throttl|unavailable/i.test(snippet) || got < expected / 8;
}

function snippetOf(buf: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: false })
            .decode(buf.slice(0, Math.min(buf.byteLength, 400)))
            .replace(/\s+/g, ' ')
            .trim();
    } catch {
        return '';
    }
}

/** Copy a streamed body into `buf`; returns the byte count, which exceeds `buf` on overflow. */
async function drainInto(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    buf: Uint8Array,
    onChunk: (bytes: number) => void,
): Promise<number> {
    let off = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return off;
        if (off + value.byteLength > buf.byteLength) {
            await reader.cancel();
            return off + value.byteLength;
        }
        buf.set(value, off);
        off += value.byteLength;
        onChunk(value.byteLength);
    }
}

/** Why a non-206 answer was refused: a 200 is the whole ~200 MB tile, never read past its head. */
async function refusal(res: Response, ctl: AbortController): Promise<Outcome> {
    const head = res.body ? (await res.body.getReader().read()).value : undefined;
    ctl.abort();
    const text = head ? snippetOf(head) : '';
    return { snippet: `HTTP ${res.status} ${text}`.trim(), got: 0 };
}

/** Stream `[begin, end)` of `url`, aborting once no byte has arrived for {@link RANGE_IDLE_TIMEOUT_MS}. */
async function streamRange(
    url: string, begin: number, end: number, onChunk: (bytes: number) => void,
): Promise<Outcome> {
    const ctl = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(
            () => ctl.abort(new Error(`aucune donnée reçue depuis ${RANGE_IDLE_TIMEOUT_MS / 1000} s`)),
            RANGE_IDLE_TIMEOUT_MS,
        );
    };
    arm();
    try {
        const res = await fetch(url, {
            headers: { Range: `bytes=${begin}-${end - 1}` },
            signal: ctl.signal,
        });
        if (res.status !== 206 || !res.body) return await refusal(res, ctl);
        const buf = new Uint8Array(end - begin);
        const got = await drainInto(res.body.getReader(), buf, (n) => { arm(); onChunk(n); });
        return got === buf.byteLength ? { buf } : { snippet: snippetOf(buf.subarray(0, got)), got };
    } finally {
        clearTimeout(idle);
    }
}

/** One throttled range read: the payload, or why it should be tried again. */
async function attemptRange(
    url: string,
    begin: number,
    end: number,
    onChunk: (bytes: number) => void,
): Promise<Outcome> {
    await acquireGlobal();
    try {
        return await streamRange(url, begin, end, onChunk);
    } catch (err) {
        // `fetch` rejects outright when IGN drops the connection under load
        // (HTTP/2 GOAWAY, reset): a hiccup to back off from, not a decoding
        // fault that should abort the capture.
        return { snippet: (err as Error)?.message ?? String(err), got: 0 };
    } finally {
        releaseGlobal();
    }
}

export function createRangeGetter(
    tileUrl: string,
): { get: TrackedRangeGet; stats: RangeStats } {
    const stats: RangeStats = { ranges: 0, bytes: 0 };
    const tileName = tileUrl.split('/').pop() ?? tileUrl;
    const get: TrackedRangeGet = async (begin, end, onBytes) => {
        const expected = end - begin;
        let lastSnippet = '';
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            let received = 0;
            const outcome = await attemptRange(tileUrl, begin, end, (n) => {
                received += n;
                onBytes?.(n);
            });
            if ('buf' in outcome) {
                stats.bytes += outcome.buf.byteLength;
                stats.ranges++;
                return outcome.buf;
            }
            // A failed attempt's bytes will be fetched again: take them back.
            if (received > 0) onBytes?.(-received);
            lastSnippet = outcome.snippet;
            if (!isRetriable(lastSnippet, outcome.got, expected) || attempt === MAX_ATTEMPTS - 1) break;
            const delay = 1000 * (2 ** attempt);
            // Park every other inflight/queued request for the same window.
            noteRateLimit(delay);
            // eslint-disable-next-line no-console
            console.warn('[lidarBrowser] retry', tileName, 'attempt', attempt + 1,
                'after', Math.round(delay), 'ms (server said:', lastSnippet.slice(0, 80), ')');
            await sleep(delay);
        }
        // eslint-disable-next-line no-console
        console.warn('[lidarBrowser] range mismatch', tileName,
            'asked', expected, 'body:', lastSnippet);
        throw new Error(
            `Lecture de la dalle ${tileName} impossible (plage de ${expected} octets). `
            + `Réponse du serveur : ${lastSnippet || '<binaire>'}`,
        );
    };
    return { get, stats };
}
