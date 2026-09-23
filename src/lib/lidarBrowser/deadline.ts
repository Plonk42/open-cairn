/**
 * Deadlines for the pipeline's `fetch` calls. IGN sometimes leaves a
 * connection open without ever answering: without a deadline the stage waiting
 * on it hangs forever, with no error and no progress.
 */

/** `signal`, also aborted once `ms` have passed. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Whether `err` is the rejection of a {@link withTimeout} deadline. */
export function isTimeout(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'TimeoutError';
}
