import type { Map as MapLibreMap } from 'maplibre-gl';

// ─────────────────────────────────────────────────────────────────────────────
// Free camera — turns MapLibre's terrain camera collision off.
//
// On every transform update MapLibre runs `Camera._elevateCameraIfInsideTerrain`:
// if the camera eye ends up below the DEM surface it is pushed back out, and the
// correction is expressed as a NEW pitch *and* zoom (the eye keeps its ground
// position and is simply raised, which swings the look direction).
//
// That is fine when flying over a landscape, but it wrecks close-range
// inspection. Measured while orbiting a point at zoom 18 / pitch 85° on an
// alpine slope: the eye sits only ~17 m above the pivot and ~200 m away from it,
// so as the bearing sweeps a full turn the ground under the eye swings by ~245 m
// (1330 m → 1575 m). Between bearing 50° and 130° the eye is up to 93 m *inside*
// the hillside and MapLibre rewrites pitch 85° → 61° and zoom 18 → 17.81, then
// unwinds it again — a 24° view swing nobody asked for, in ~80° of rotation.
// Worse, `_requestedCameraState` is dropped on every `moveend`, so the corrected
// pitch is baked in at the end of each gesture: rotating back does not restore
// it, and the camera ratchets flatter drag after drag.
//
// Disabling the collision lets the eye pass through the ground. That is exactly
// what mesh/point-cloud inspection wants (and it is the same clamp that caps the
// studio's above-the-horizon pitch at ~96° instead of the configured maximum).
// It is deliberately NOT the default, because for ordinary map navigation the
// collision is what stops the basemap from filling the screen.
//
// Implementation note: MapLibre exposes no option for this, so we swap the one
// internal method that implements it. It is a single function with a narrow
// contract (`transform → { pitch?, zoom? }`), the original is kept and restored
// on the way out, and a missing method is treated as "nothing to do" so a
// MapLibre upgrade degrades to today's behaviour instead of throwing.
// ─────────────────────────────────────────────────────────────────────────────

type CollisionFix = Readonly<{ pitch?: number; zoom?: number }>;
type ElevateCameraFn = (transform: unknown) => CollisionFix;

interface CameraInternals {
    _elevateCameraIfInsideTerrain?: ElevateCameraFn;
}

const NO_COLLISION: ElevateCameraFn = () => ({});

/** Original method per map, kept only while the collision is disabled. */
const suspended = new WeakMap<MapLibreMap, ElevateCameraFn>();

/**
 * Enable or disable MapLibre's "push the camera out of the terrain" correction.
 *
 * @param map - Map instance to patch.
 * @param enabled - `true` restores MapLibre's default behaviour, `false` lets
 * the camera move freely through the terrain surface.
 */
export function setTerrainCameraCollision(map: MapLibreMap, enabled: boolean): void {
    const camera = map as unknown as CameraInternals;
    if (typeof camera._elevateCameraIfInsideTerrain !== 'function') return;

    if (enabled) {
        const original = suspended.get(map);
        if (!original) return;
        camera._elevateCameraIfInsideTerrain = original;
        suspended.delete(map);
        return;
    }

    if (suspended.has(map)) return;
    suspended.set(map, camera._elevateCameraIfInsideTerrain);
    camera._elevateCameraIfInsideTerrain = NO_COLLISION;
}

/** Whether the collision is currently suspended on this map (tests/debug). */
export function isTerrainCameraCollisionDisabled(map: MapLibreMap): boolean {
    return suspended.has(map);
}
