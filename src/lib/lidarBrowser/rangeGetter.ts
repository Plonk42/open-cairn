/**
 * HTTP Range getter for IGN COPC tiles, with the two defences the raw
 * `Getter.create` lacks: the global rate limiter, and a retry on a short body.
 *
 * IGN intermittently answers a Range request with 200 (whole ~200 MB file) or
 * with an HTML 429 page. Either way the body length differs from the one asked,
 * which is the only reliable signal — so every response is length-checked
 * before being handed to the LAZ decoder, whose wasm heap a 200 would blow.
 */
import { Getter } from 'copc';
import { acquireGlobal, noteRateLimit, releaseGlobal } from './rateLimiter';

const MAX_ATTEMPTS = 5;

/** Byte-range reader handed to the `copc` package. */
export type RangeGet = ReturnType<typeof Getter.create>;

/** Bytes and range count fetched so far, for the pipeline's stage logs. */
export interface RangeStats { ranges: number; bytes: number }

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

export function createRangeGetter(
    tileUrl: string,
): { get: RangeGet; stats: RangeStats } {
    const rawGet = Getter.create(tileUrl);
    const stats: RangeStats = { ranges: 0, bytes: 0 };
    const tileName = tileUrl.split('/').pop() ?? tileUrl;
    const get: typeof rawGet = async (begin: number, end: number) => {
        const expected = end - begin;
        let lastSnippet = '';
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await acquireGlobal();
            let buf: Uint8Array;
            try {
                buf = await rawGet(begin, end);
            } finally {
                releaseGlobal();
            }
            if (buf.byteLength === expected) {
                stats.bytes += buf.byteLength;
                stats.ranges++;
                return buf;
            }
            lastSnippet = snippetOf(buf);
            if (!isRetriable(lastSnippet, buf.byteLength, expected) || attempt === MAX_ATTEMPTS - 1) break;
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
            `Range request failed on ${tileName} (asked ${expected} B). `
            + `Server response: ${lastSnippet || '<binary>'}`,
        );
    };
    return { get, stats };
}
