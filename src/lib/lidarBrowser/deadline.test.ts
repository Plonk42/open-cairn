import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTimeout, withTimeout } from './deadline';

describe('withTimeout', () => {
    afterEach(() => vi.useRealTimers());

    it('aborts with a timeout once the deadline passes', async () => {
        vi.useFakeTimers();
        const signal = withTimeout(undefined, 1000);
        expect(signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(signal.aborted).toBe(true);
        expect(isTimeout(signal.reason)).toBe(true);
    });

    it('still follows the caller signal, which is not a timeout', () => {
        const caller = new AbortController();
        const signal = withTimeout(caller.signal, 60_000);
        caller.abort();
        expect(signal.aborted).toBe(true);
        expect(isTimeout(signal.reason)).toBe(false);
    });
});
