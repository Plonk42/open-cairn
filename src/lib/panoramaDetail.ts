// ─────────────────────────────────────────────────────────────────────────────
// Panorama detail — spend the terrain budget on the mesh, not on the drape.
//
// MapLibre picks a tile zoom per tile with a grazing-angle penalty whose weight
// GROWS as the lens narrows: its `pitchTileLoadingBehavior` goes from ~1.0 at a
// 37° field of view to ~2.7 at 8°. Reaching for the telephoto therefore
// coarsens the far field, which is the exact opposite of what it is for.
// Measured from a 2070 m standpoint over Belledonne, going from 60° to 8°:
//
//   - finest mesh spacing past 40 km: 213 m → 420 m;
//   - basemap served past 10 km: z11 → z9, i.e. 108 m/px where the lens asks
//     for ~6 m/px.
//
// Replacing that rule with a pure inverse-distance one fixes the far field but
// multiplies the tile count — and every terrain tile owns a render-to-texture
// drape costing `rttSize² · 4` bytes, which is 16.8 MB at MapLibre's default
// `qualityFactor = 2`. 359 tiles at that price lost the WebGL context.
//
// So the two moves only make sense together: quarter the drape (512² = 1 MB per
// tile) and spend what that frees on geometry. Same standpoint at 8°, measured:
// mesh spacing 7 m instead of 213–430 m out to 40 km, 200 tiles, 200 MB of RTT
// against 352 MB before. Finer relief for LESS memory — the drape was simply
// the wrong place to spend it, since a panorama is read through its ridge
// lines, not through its ground texture.
// ─────────────────────────────────────────────────────────────────────────────

import type { CalculateTileZoomFunction, Map as MapLibreMap } from 'maplibre-gl';

/** MapLibre does not export `Terrain`, and `map.terrain` is null while it is off. */
type TerrainLike = MapLibreMap['terrain'];

/** Drape side as a multiple of the 1024 px terrain tile; MapLibre defaults to 2. */
export const PANORAMA_QUALITY_FACTOR = 0.5;

/**
 * Quads per side of the terrain mesh; MapLibre defaults to 128.
 *
 * Capped at 252, not 256: MapLibre's terrain mesh (`Terrain.getTerrainMesh`) packs
 * indices into a fixed `Uint16` buffer, and the grid plus its four skirts add up to
 * `(meshSize+1) * (meshSize+7)` vertices — 256 gives 67 591, over the 65 536 limit.
 * The overflowing indices wrap modulo 65 536 and corrupt the skirts, which is what
 * hides the seam between neighbouring tiles at different zoom: the seam then shows
 * as a white gap cut clean through the terrain. 252 gives 65 527, just under.
 */
export const PANORAMA_MESH_SIZE = 252;

/**
 * Zoom levels added to the inverse-distance rule, per source. The terrain is
 * pushed up because the mesh is what carries a distant summit; the basemap is
 * pulled down because at these distances its texture is haze anyway, and it is
 * what pays for the tiles.
 */
const PANORAMA_SOURCE_BIAS: ReadonlyArray<readonly [string, number]> = [
    ['terrain', 2],
    ['base', -2],
];

/**
 * Tile zoom from distance alone, without MapLibre's grazing-angle penalty.
 *
 * Dropping the penalty is safe here because the cap at `requestedCenterZoom`
 * takes over its job: no tile is ever asked for more detail than the centre
 * gets, so a near-horizontal view cannot explode the tile count. MapLibre's own
 * guard is what degenerates instead — at pitch 90° and a 8° lens its default
 * parameters ask for 86 831 mesh tiles.
 *
 * @param bias - Zoom levels added before the cap; positive means finer.
 */
export function panoramaTileZoom(bias: number): CalculateTileZoomFunction {
    return (requestedCenterZoom, distanceToTile2D, distanceToTileZ, distanceToCenter3D, cameraVerticalFOV) => {
        const distanceToTile3D = Math.max(Math.hypot(distanceToTile2D, distanceToTileZ), 1e-6);
        // Same widening factor MapLibre applies: the edges of the frame are
        // further away than the centre, and a wide lens must not starve them.
        const fovSpread = Math.max(0.5, Math.cos((cameraVerticalFOV * Math.PI) / 360));
        const desired = requestedCenterZoom
            + Math.log2(distanceToCenter3D / distanceToTile3D / fovSpread)
            + bias;
        return Math.min(desired, requestedCenterZoom);
    };
}

/** What `applyPanoramaDetail` has to put back, captured per Terrain instance. */
interface TerrainDetailBackup {
    terrain: TerrainLike;
    qualityFactor: number;
    meshSize: number;
    rttSize: number;
}

/**
 * `rttSize` is derived once in RenderToTexture's constructor and is absent from
 * the public interface, so changing `qualityFactor` alone changes nothing.
 */
type RttSizeHolder = { rttSize: number };

function rttSizeHolder(map: MapLibreMap): RttSizeHolder {
    return map.painter.renderToTexture as unknown as RttSizeHolder;
}

type ElevationRange = ReturnType<TerrainLike['getMinMaxElevation']>;

/**
 * Keeps each tile's elevation range once its own DEM has been seen. MapLibre bounds a
 * tile whose DEM left its 60-tile cache by `[0, centre elevation]`, and this mode's
 * centre floats 4 km up the gaze: the tile turned visible, reloaded, was culled on its
 * real heights and evicted again — ~250 DEM requests a second, and never an `idle`.
 */
function rememberTileElevations(terrain: TerrainLike): void {
    const proto = Object.getPrototypeOf(terrain) as TerrainLike;
    const known = new Map<string, ElevationRange>();
    terrain.getMinMaxElevation = function (this: TerrainLike, tileID) {
        const range = proto.getMinMaxElevation.call(this, tileID);
        if (this.tileManager.getSourceTile(tileID, false)?.dem) {
            known.set(tileID.key, range);
            return range;
        }
        return known.get(tileID.key) ?? range;
    };
}

function patchTerrain(map: MapLibreMap, terrain: TerrainLike): TerrainDetailBackup {
    const rtt = rttSizeHolder(map);
    const backup: TerrainDetailBackup = {
        terrain,
        qualityFactor: terrain.qualityFactor,
        meshSize: terrain.meshSize,
        rttSize: rtt.rttSize,
    };
    terrain.qualityFactor = PANORAMA_QUALITY_FACTOR;
    rtt.rttSize = terrain.tileManager.tileSize * PANORAMA_QUALITY_FACTOR;
    terrain.meshSize = PANORAMA_MESH_SIZE;
    // Both caches hold objects built for the old sizes, and neither is keyed by
    // them: the drape keeps its 2048² texture and the mesh its 128 quads.
    terrain.tileManager.releaseAllRTT();
    for (const key of Object.keys(terrain._meshCache)) delete terrain._meshCache[key];
    rememberTileElevations(terrain);
    return backup;
}

function unpatchTerrain(map: MapLibreMap, backup: TerrainDetailBackup): void {
    delete (backup.terrain as Partial<Pick<TerrainLike, 'getMinMaxElevation'>>).getMinMaxElevation;
    backup.terrain.qualityFactor = backup.qualityFactor;
    backup.terrain.meshSize = backup.meshSize;
    rttSizeHolder(map).rttSize = backup.rttSize;
    backup.terrain.tileManager.releaseAllRTT();
    for (const key of Object.keys(backup.terrain._meshCache)) delete backup.terrain._meshCache[key];
}

/**
 * Turns the panorama tiling on until the returned function is called.
 *
 * Re-applied on `styledata` because a basemap or hillshade change rebuilds the
 * style: the sources carrying our LOD hook are replaced, and so is the terrain.
 */
export function applyPanoramaDetail(map: MapLibreMap): () => void {
    let patched: TerrainDetailBackup | null = null;

    const apply = () => {
        for (const [sourceId, bias] of PANORAMA_SOURCE_BIAS) {
            const source = map.getSource(sourceId);
            if (source) source.calculateTileZoom = panoramaTileZoom(bias);
        }
        const terrain = map.terrain;
        // A rebuilt style brings a fresh Terrain at MapLibre's defaults; the
        // same instance means `styledata` fired for something else, and
        // re-capturing would back up our own values.
        if (terrain && terrain !== patched?.terrain) patched = patchTerrain(map, terrain);
        map.triggerRepaint();
    };

    apply();
    map.on('styledata', apply);

    return () => {
        map.off('styledata', apply);
        for (const [sourceId] of PANORAMA_SOURCE_BIAS) {
            const source = map.getSource(sourceId);
            if (source) source.calculateTileZoom = undefined;
        }
        const backup = patched;
        patched = null;
        if (backup?.terrain === map.terrain) unpatchTerrain(map, backup);
        map.triggerRepaint();
    };
}

/**
 * Near clipping plane of the viewpoint mode, in metres. MapLibre's `height / 50` px is
 * `160 · tan(fov/2)` m with the eye 4 km from the centre — 53 m at 37° — which clipped
 * the ground at the observer's feet. 0.5 m leaves ridges 100 km off pixel-identical;
 * 0.05 m makes the tile skirts z-fight from 30 km.
 */
export const VIEWPOINT_NEAR_PLANE_M = 0.5;

/** A terrain tile as MapLibre hands it to `calculateFogMatrix`. */
interface UnwrappedTile {
    wrap: number;
    canonical: { x: number; y: number; z: number };
}

/** The private members of MapLibre's `MercatorTransform` the near plane goes through. */
interface NearPlaneTransform {
    _calculateNearFarZ(...args: unknown[]): void;
    _calcMatrices(): void;
    calculateFogMatrix(tile: UnwrappedTile): Float32Array;
    getCameraLngLat(): { lng: number; lat: number };
    _helper: { _nearZ: number; _pixelPerMeter: number };
}

/** Puts every vertex at fog depth −1, under any `fog-ground-blend`. */
const NO_FOG_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, -3, 1]);

/** Tile fraction around the eye whose triangles can straddle it: a few mesh cells. */
const STRADDLE_MARGIN = 0.02;

function eyeNearTile(eye: { lng: number; lat: number }, tile: UnwrappedTile): boolean {
    const scale = 2 ** tile.canonical.z;
    const x = ((eye.lng + 180) / 360 - tile.wrap) * scale - tile.canonical.x;
    const sinLat = Math.sin((eye.lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale - tile.canonical.y;
    return x > -STRADDLE_MARGIN && x < 1 + STRADDLE_MARGIN && y > -STRADDLE_MARGIN && y < 1 + STRADDLE_MARGIN;
}

/**
 * The terrain shader divides its fog depth per vertex, which is garbage for a vertex
 * behind the eye; the default near plane clipped every triangle that has one, ours
 * does not, and the ground at the observer's feet blew up to white. The fog only
 * starts past twice the eye-to-sea-level distance, so the tiles around the eye lose
 * next to nothing by going without.
 */
function patchTransform(transform: NearPlaneTransform): void {
    const proto = Object.getPrototypeOf(transform) as NearPlaneTransform;
    transform._calculateNearFarZ = function (this: NearPlaneTransform, ...args: unknown[]) {
        proto._calculateNearFarZ.apply(this, args);
        this._helper._nearZ = Math.min(this._helper._nearZ, VIEWPOINT_NEAR_PLANE_M * this._helper._pixelPerMeter);
    };
    transform.calculateFogMatrix = function (this: NearPlaneTransform, tile: UnwrappedTile) {
        return eyeNearTile(this.getCameraLngLat(), tile) ? NO_FOG_MATRIX : proto.calculateFogMatrix.call(this, tile);
    };
    transform._calcMatrices();
}

function unpatchTransform(transform: NearPlaneTransform): void {
    const own = transform as Partial<NearPlaneTransform>;
    delete own._calculateNearFarZ;
    delete own.calculateFogMatrix;
    transform._calcMatrices();
}

/**
 * Pulls the near clipping plane in to {@link VIEWPOINT_NEAR_PLANE_M} until the
 * returned function is called. Re-applied on `styledata`: loading a style migrates
 * the projection, which hands the painter a fresh transform.
 */
export function applyViewpointNearPlane(map: MapLibreMap): () => void {
    let patched: NearPlaneTransform | null = null;

    const apply = () => {
        const transform = map.painter.transform as unknown as NearPlaneTransform;
        if (transform === patched) return;
        patchTransform(transform);
        patched = transform;
        map.triggerRepaint();
    };

    apply();
    map.on('styledata', apply);

    return () => {
        map.off('styledata', apply);
        if (patched) unpatchTransform(patched);
        patched = null;
        map.triggerRepaint();
    };
}
