import { useLayoutEffect, useState } from 'react';

/**
 * Resolves a `data-tutorial` CSS selector to the live bounding rect of its
 * element, re-measuring whenever the selector changes, the window resizes, or
 * the document scrolls. Returns `null` when the target isn't in the DOM, which
 * lets the tutorial skip steps whose feature is absent (e.g. behind a closed
 * menu or removed entirely).
 *
 * `tick` is an arbitrary value the caller can bump to force a fresh measure
 * (e.g. right after opening the overlay, once layout has settled).
 */
export function useTargetRect(selector: string | null, tick = 0): DOMRect | null {
    const [rect, setRect] = useState<DOMRect | null>(null);

    useLayoutEffect(() => {
        if (!selector) {
            setRect(null);
            return;
        }

        let frame = 0;
        let attempts = 0;
        const measure = () => {
            const el = document.querySelector(selector);
            if (el) {
                setRect(el.getBoundingClientRect());
                return;
            }
            // Target not in the DOM yet (e.g. a menu the step just asked to
            // open). Retry for a short while before giving up so the spotlight
            // latches on once it appears.
            setRect(null);
            if (attempts++ < 20) frame = requestAnimationFrame(measure);
        };

        // Measure synchronously before paint so the card never flashes at the
        // previous step's position when advancing. Targets already in the DOM
        // (the common case) latch immediately; ones that appear a frame later
        // (e.g. a menu the step just opened) are picked up by the rAF retry.
        measure();

        globalThis.addEventListener('resize', measure);
        globalThis.addEventListener('scroll', measure, true);
        return () => {
            cancelAnimationFrame(frame);
            globalThis.removeEventListener('resize', measure);
            globalThis.removeEventListener('scroll', measure, true);
        };
    }, [selector, tick]);

    return rect;
}
