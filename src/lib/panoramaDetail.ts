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
//
// The terrain is sized in screen pixels, not capped at the centre's zoom: the
// cap left the ground under the eye at 27 m a quad at 37°. +1 (2–4 px a quad)
// is kept over +2: +2 counted 81 disagreements with PeakFinder's verdicts on
// 2 992 summits at a 60° lens against 181, but on screen it changed 1.5–3.7 % of
// the pixels, blurred the drape slightly and doubled the tiles. It was offered
// as a setting and dropped: no visible gain.
// ─────────────────────────────────────────────────────────────────────────────

import type { CalculateTileZoomFunction, CoveringTilesOptions, Map as MapLibreMap, OverscaledTileID } from 'maplibre-gl';

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
 * Zoom levels added to the inverse-distance rule for the terrain's render tiles:
 * one 1024 px tile per 512 screen px, i.e. 2–4 px per quad of a 252 mesh.
 */
const TERRAIN_BIAS = 1;

/**
 * The basemap is the drape, and the drape is what a far ridge is read through:
 * −1 serves its 256 px tiles at 2 screen px a texel. −2 left 4–8 and blurred
 * every summit past 20 km; 0 triples the tiles again (140 → 418 at 8°).
 */
const BASE_BIAS = -1;

/**
 * Tile zoom from distance alone, without MapLibre's grazing-angle penalty.
 *
 * Dropping the penalty cannot explode the tile count: the distance is 3D and the
 * eye sits hundreds of metres above the centre, so the zoom under the eye stays
 * a few levels above the centre's, and `capAtCentre` or the source's `maxzoom`
 * bounds it. MapLibre's own guard is what degenerates instead — at pitch 90° and
 * a 8° lens its default parameters ask for 86 831 mesh tiles.
 *
 * @param bias - Zoom levels added before the cap; positive means finer.
 * @param capAtCentre - Never ask a tile for more detail than the centre gets.
 */
export function panoramaTileZoom(bias: number, capAtCentre: boolean): CalculateTileZoomFunction {
    return (requestedCenterZoom, distanceToTile2D, distanceToTileZ, distanceToCenter3D, cameraVerticalFOV) => {
        const distanceToTile3D = Math.max(Math.hypot(distanceToTile2D, distanceToTileZ), 1e-6);
        // Same widening factor MapLibre applies: the edges of the frame are
        // further away than the centre, and a wide lens must not starve them.
        const fovSpread = Math.max(0.5, Math.cos((cameraVerticalFOV * Math.PI) / 360));
        const desired = requestedCenterZoom
            + Math.log2(distanceToCenter3D / distanceToTile3D / fovSpread)
            + bias;
        return capAtCentre ? Math.min(desired, requestedCenterZoom) : desired;
    };
}

/** What `applyPanoramaDetail` has to put back, captured per Terrain instance. */
interface TerrainDetailBackup {
    terrain: TerrainLike;
    qualityFactor: number;
    meshSize: number;
    rttSize: number;
    renderMaxzoom: number;
}

type TerrainTileManager = TerrainLike['tileManager'];
type RenderTile = TerrainTileManager['_tiles'][string];
type RenderTileClass = new (tileID: OverscaledTileID, size: number) => RenderTile;

/** `mat4.ortho(0, EXTENT, EXTENT, 0, 0, 1)` at MapLibre's 8192 extent: a render tile's own drape. */
const RTT_POS_MATRIX = [2 / 8192, 0, 0, 0, 0, -2 / 8192, 0, 0, 0, 0, -2, 0, -1, 1, -1, 1];

/**
 * `rttSize` is derived once in RenderToTexture's constructor and is absent from
 * the public interface, so changing `qualityFactor` alone changes nothing.
 */
type RttSizeHolder = { rttSize: number };

function rttSizeHolder(map: MapLibreMap): RttSizeHolder {
    return map.painter.renderToTexture as unknown as RttSizeHolder;
}

type ElevationRange = ReturnType<TerrainLike['getMinMaxElevation']>;

type MemberSpec = readonly [path: string, type: 'function' | 'number' | 'object'];

/**
 * Dotted paths of `specs` absent from `root` or of another type. The patches below go
 * through MapLibre members that are not public: an upgrade can rename one without any
 * type error, and the mode would quietly fall back to default quality — or throw.
 */
export function missingMembers(root: object, specs: readonly MemberSpec[]): string[] {
    return specs
        .filter(([path, type]) => {
            const value = path.split('.').reduce<unknown>(
                (node, key) => (node as Record<string, unknown> | null | undefined)?.[key],
                root,
            );
            return typeof value !== type || value === null;
        })
        .map(([path]) => path);
}

const reportedPatches = new Set<string>();

/** Logs (once per patch) and returns false when MapLibre no longer has what a patch needs. */
function hasMembers(patch: string, root: object, specs: readonly MemberSpec[]): boolean {
    const missing = missingMembers(root, specs);
    if (missing.length > 0 && !reportedPatches.has(patch)) {
        reportedPatches.add(patch);
        console.error(`${patch} skipped: MapLibre no longer has ${missing.join(', ')}`);
    }
    return missing.length === 0;
}

const PANORAMA_DETAIL_MEMBERS: readonly MemberSpec[] = [
    ['painter.renderToTexture.rttSize', 'number'],
    ['terrain.qualityFactor', 'number'],
    ['terrain.meshSize', 'number'],
    ['terrain._meshCache', 'object'],
    ['terrain.getMinMaxElevation', 'function'],
    ['terrain.tileManager.tileSize', 'number'],
    ['terrain.tileManager.getSourceTile', 'function'],
    ['terrain.tileManager.releaseAllRTT', 'function'],
    ['terrain.tileManager.update', 'function'],
    ['terrain.tileManager.getSource', 'function'],
    ['terrain.tileManager._tiles', 'object'],
    ['terrain.tileManager._renderableTilesKeys', 'object'],
    ['terrain.tileManager.maxzoom', 'number'],
    ['terrain.tileManager.deltaZoom', 'number'],
    ['terrain.tileManager.tileManager.update', 'function'],
    ['terrain.tileManager.tileManager.getIds', 'function'],
    ['coveringTiles', 'function'],
];

const NEAR_PLANE_MEMBERS: readonly MemberSpec[] = [
    ['_calculateNearFarZ', 'function'],
    ['_calcMatrices', 'function'],
    ['calculateFogMatrix', 'function'],
    ['getCameraLngLat', 'function'],
    ['_helper._nearZ', 'number'],
    ['_helper._pixelPerMeter', 'number'],
];

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

function firstTileClass(manager: TerrainTileManager): RenderTileClass | undefined {
    const [renderTile] = Object.values(manager._tiles);
    const [demId] = manager.tileManager.getIds();
    const tile = renderTile ?? (demId === undefined ? undefined : manager.tileManager.getTileByID(demId));
    return tile?.constructor as RenderTileClass | undefined;
}

/**
 * MapLibre 6.11 stopped handing the DEM source's `calculateTileZoom` to the
 * terrain's render tiles (#8048). They fell back to the grazing-angle rule while
 * the DEM followed ours, and a render tile whose DEM parent was never requested
 * sampled a z5 one: the far field went flat. This is `TerrainTileManager.update`
 * with the hook put back; `Tile` is not exported, hence the borrowed class.
 */
function patchRenderTileZoom(map: MapLibreMap, manager: TerrainTileManager, calculateTileZoom: CalculateTileZoomFunction): void {
    const proto = Object.getPrototypeOf(manager) as TerrainTileManager;
    manager.update = function (this: TerrainTileManager, transform, terrain) {
        const TileClass = firstTileClass(this);
        if (!TileClass) return proto.update.call(this, transform, terrain);
        this.tileManager.update(transform, terrain);
        this._renderableTilesKeys = [];
        const kept = new Set<string>();
        let changed = false;
        // `map.coveringTiles` reads the same camera transform MapLibre passes in, and
        // forwards the two internal options its public type omits.
        const options: CoveringTilesOptions & { terrain: TerrainLike; calculateTileZoom: CalculateTileZoomFunction } = {
            tileSize: this.tileSize, minzoom: this.minzoom, maxzoom: this.maxzoom,
            terrain, calculateTileZoom,
        };
        for (const tileID of map.coveringTiles(options)) {
            kept.add(tileID.key);
            this._renderableTilesKeys.push(tileID.key);
            if (this._tiles[tileID.key]) continue;
            tileID.terrainRttPosMatrix32f = new Float32Array(RTT_POS_MATRIX);
            this._tiles[tileID.key] = new TileClass(tileID, this.tileSize);
            this._lastTilesetChange = performance.now();
            changed = true;
        }
        for (const key of Object.keys(this._tiles)) {
            if (kept.has(key)) continue;
            this._tiles[key].releaseRTT(map.painter);
            delete this._tiles[key];
            changed = true;
        }
        return changed;
    };
}

function patchTerrain(map: MapLibreMap, terrain: TerrainLike, renderTileZoom: CalculateTileZoomFunction): TerrainDetailBackup {
    const rtt = rttSizeHolder(map);
    const manager = terrain.tileManager;
    const backup: TerrainDetailBackup = {
        terrain,
        qualityFactor: terrain.qualityFactor,
        meshSize: terrain.meshSize,
        rttSize: rtt.rttSize,
        renderMaxzoom: manager.maxzoom,
    };
    terrain.qualityFactor = PANORAMA_QUALITY_FACTOR;
    rtt.rttSize = manager.tileSize * PANORAMA_QUALITY_FACTOR;
    terrain.meshSize = PANORAMA_MESH_SIZE;
    // Past this zoom a render tile would only split its DEM's pixels further.
    manager.maxzoom = manager.getSource().maxzoom + manager.deltaZoom;
    patchRenderTileZoom(map, manager, renderTileZoom);
    // Both caches hold objects built for the old sizes, and neither is keyed by
    // them: the drape keeps its 2048² texture and the mesh its 128 quads.
    manager.releaseAllRTT();
    for (const key of Object.keys(terrain._meshCache)) delete terrain._meshCache[key];
    rememberTileElevations(terrain);
    return backup;
}

function unpatchTerrain(map: MapLibreMap, backup: TerrainDetailBackup): void {
    delete (backup.terrain as Partial<Pick<TerrainLike, 'getMinMaxElevation'>>).getMinMaxElevation;
    delete (backup.terrain.tileManager as Partial<Pick<TerrainTileManager, 'update'>>).update;
    backup.terrain.tileManager.maxzoom = backup.renderMaxzoom;
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
    const renderTileZoom = panoramaTileZoom(TERRAIN_BIAS, false);
    // The DEM sits one level under the render tiles, each of which samples its
    // parent (MapLibre's `deltaZoom`); the render tiles' `maxzoom` bounds it.
    const sourceZoom: ReadonlyArray<readonly [string, CalculateTileZoomFunction]> = [
        ['terrain', panoramaTileZoom(TERRAIN_BIAS - 1, false)],
        ['base', panoramaTileZoom(BASE_BIAS, true)],
    ];

    const apply = () => {
        for (const [sourceId, calculateTileZoom] of sourceZoom) {
            const source = map.getSource(sourceId);
            if (source) source.calculateTileZoom = calculateTileZoom;
        }
        const terrain = map.terrain;
        // A rebuilt style brings a fresh Terrain at MapLibre's defaults; the
        // same instance means `styledata` fired for something else, and
        // re-capturing would back up our own values.
        if (terrain && terrain !== patched?.terrain && hasMembers('Panorama detail', map, PANORAMA_DETAIL_MEMBERS)) {
            patched = patchTerrain(map, terrain, renderTileZoom);
        }
        map.triggerRepaint();
    };

    apply();
    map.on('styledata', apply);

    return () => {
        map.off('styledata', apply);
        for (const [sourceId] of sourceZoom) {
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
        if (!hasMembers('Viewpoint near plane', transform, NEAR_PLANE_MEMBERS)) return;
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
