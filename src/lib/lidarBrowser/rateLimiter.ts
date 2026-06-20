]633;E;echo "/**";e6fd7438-80f4-4448-b030-4719ad0de016]633;C/**
 * Client-side throttle for HTTP Range requests against IGN's LiDAR HD COPC
 * service: a global in-flight cap + a proactive sliding-window rate limiter
 * with a reactive 429 cooldown safety net.
 */


// Global throttle for HTTP range requests against data.geopf.fr's LiDAR
// COPC service.
const MAX_INFLIGHT_GLOBAL = 4;
let globalInflight = 0;
const globalWaitQueue: Array<() => void> = [];

// Proactive sliding-window rate limiter. IGN's Kong gateway caps origins
// at ~8 req/s; rather than hammer the bucket and react to 429s, we keep
// the timestamps of the last RATE_WINDOW_MAX starts and, before each new
// request, sleep until the oldest one is older than RATE_WINDOW_MS.
const RATE_WINDOW_MS = 1000;
const RATE_WINDOW_MAX = 8;
const recentStarts: number[] = [];

// Reactive cooldown kept as a safety net in case the server's view of the
// rate budget drifts from ours (clock skew, shared origin, transient 429s).
let cooldownUntil = 0;

export function noteRateLimit(ms: number): void {
    const target = Date.now() + ms;
    if (target > cooldownUntil) cooldownUntil = target;
}

async function waitForRateBudget(): Promise<void> {
    // Loop because both the cooldown and the sliding window can advance
    // while we sleep, and other waiters may consume the freed slot first.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const now = Date.now();
        // Drop expired entries from the window.
        while (recentStarts.length > 0 && now - recentStarts[0] >= RATE_WINDOW_MS) {
            recentStarts.shift();
        }
        const cooldownRemaining = cooldownUntil - now;
        const windowRemaining = recentStarts.length >= RATE_WINDOW_MAX
            ? RATE_WINDOW_MS - (now - recentStarts[0])
            : 0;
        const wait = Math.max(cooldownRemaining, windowRemaining);
        if (wait <= 0) {
            recentStarts.push(now);
            return;
        }
        await new Promise((r) => setTimeout(r, wait));
    }
}

export async function acquireGlobal(): Promise<void> {
    if (globalInflight >= MAX_INFLIGHT_GLOBAL) {
        await new Promise<void>((resolve) => globalWaitQueue.push(resolve));
    }
    globalInflight++;
    await waitForRateBudget();
}

export function releaseGlobal(): void {
    globalInflight--;
    const next = globalWaitQueue.shift();
    if (next) next();
}
