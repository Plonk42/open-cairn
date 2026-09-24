/**
 * MapLibre's `hash: true` replays `#zoom/lat/lng/bearing/pitch` through `jumpTo` inside the
 * `Map` constructor, before `setTerrainCameraCollision` can run: a pitch above 90° (looking
 * up in the viewpoint mode) then throws "Invalid LngLat object: (NaN, NaN)" and blanks the page.
 *
 * @param hash - `location.hash`, including its leading `#`.
 * @param maxPitch - Ceiling to clamp a stored pitch down to.
 * @returns The hash with its pitch clamped; unchanged if not MapLibre's shape or already in bounds.
 */
export function clampHashPitch(hash: string, maxPitch: number): string {
    const raw = hash.replace(/^#/, '');
    const parts = raw.split('/');
    if (parts.length < 5) return hash;
    const pitch = Number(parts[4]);
    if (!Number.isFinite(pitch) || pitch <= maxPitch) return hash;
    parts[4] = String(maxPitch);
    return `#${parts.join('/')}`;
}
