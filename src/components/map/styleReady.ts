import type maplibregl from 'maplibre-gl';

function pollingApply(map: maplibregl.Map, apply: (map: maplibregl.Map) => void) {
    let retry = 0;
    const run = () => {
        window.clearTimeout(retry);  // keeps a single poll chain alive
        try {
            apply(map);
        } catch {
            retry = window.setTimeout(run, 200);
        }
    };
    return { run, cancel: () => window.clearTimeout(retry) };
}

/**
 * Call `apply` until it goes through, retrying every 200 ms.
 *
 * `map.isStyleLoaded()` is not a usable readiness test: it also waits for every
 * source's tiles, and after a `Style is not done loading… Rebuilding the style
 * from scratch` it was observed staying false — and `idle` never firing again —
 * for the rest of the session, while `addSource`/`addLayer`/`setSky`/`setTerrain`
 * all worked. So the readiness test here is the call itself: MapLibre throws
 * while the style is genuinely not ready, and we retry until it is.
 *
 * Returns the cleanup to call on unmount.
 */
export function retryUntilStyleAccepts(
    map: maplibregl.Map, apply: (map: maplibregl.Map) => void,
): () => void {
    const { run, cancel } = pollingApply(map, apply);
    run();
    return cancel;
}

/**
 * Same as {@link retryUntilStyleAccepts}, plus a re-apply after every style
 * rebuild — `setStyle({diff:true})` drops custom sources and layers, and resets
 * the paint properties the new style spec does not carry.
 *
 * `apply` must therefore be idempotent, and must not change the style in a way
 * that fires `styledata` again, or it will loop. (MapLibre short-circuits a
 * `setPaintProperty` to the value already in place, which is what keeps the
 * relight and dimmer effects from looping. `setSky` does *not*: it must be
 * guarded by an explicit comparison.)
 */
export function applyWhenStyleReady(
    map: maplibregl.Map, apply: (map: maplibregl.Map) => void,
): () => void {
    const { run, cancel } = pollingApply(map, apply);
    run();
    map.on('styledata', run);
    return () => {
        cancel();
        map.off('styledata', run);
    };
}
