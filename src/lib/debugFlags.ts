/**
 * Hidden debug flags, opted into via the `?debug=` URL search param.
 *
 * These gate developer-only tuning panels (e.g. the vegetation-height
 * « Analyse hauteur » diagnostics) so they never clutter the normal UI.
 *
 * The param is a comma-separated list of tokens. A generic `?debug=true`
 * (also `1` / `all`) turns on every debug panel; specific tokens
 * (e.g. `?debug=hauteur`) turn on just that one — leaving room to add more
 * scoped debug flags later.
 */

/** Tokens that enable ALL debug panels at once. */
const DEBUG_ALL_TOKENS = new Set(['true', '1', 'all', 'on']);

/** Read the raw `?debug=` list from the current URL, lower-cased. */
function debugTokens(): ReadonlySet<string> {
    const raw = new URLSearchParams(globalThis.location.search).get('debug') ?? '';
    return new Set(
        raw
            .toLowerCase()
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
    );
}

/** True when any global debug token (`true`/`1`/`all`) is present. */
function debugAll(tokens: ReadonlySet<string>): boolean {
    for (const t of tokens) if (DEBUG_ALL_TOKENS.has(t)) return true;
    return false;
}

/**
 * True when the vegetation-height diagnostics menu should be shown.
 * Enabled by the generic `?debug=true` or the scoped `?debug=hauteur`
 * (also accepts the English `height`).
 */
export function isHeightDebugEnabled(): boolean {
    const tokens = debugTokens();
    return debugAll(tokens) || tokens.has('hauteur') || tokens.has('height');
}

/**
 * True when the distance-based LOD debug toggle should be shown (lets you
 * A/B the point/mesh decimation live). Enabled by the generic `?debug=true`
 * or the scoped `?debug=lod`.
 */
export function isLodDebugEnabled(): boolean {
    const tokens = debugTokens();
    return debugAll(tokens) || tokens.has('lod');
}

/**
 * True when the reconstructed ground mesh should be drawn as a plain wireframe
 * (no lighting, no texture) so the triangle density is directly visible.
 * Enabled by the generic `?debug=true` or the scoped `?debug=mesh` (also
 * accepts `wire` / `wireframe`).
 */
export function isMeshWireframeDebugEnabled(): boolean {
    const tokens = debugTokens();
    return debugAll(tokens) || tokens.has('mesh') || tokens.has('wire') || tokens.has('wireframe');
}
