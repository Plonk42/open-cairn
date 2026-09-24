import { describe, expect, it } from 'vitest';
import { missingMembers, panoramaTileZoom } from './panoramaDetail';

/**
 * MapLibre's own rule, transcribed from `covering_tiles.ts`, to compare against.
 * `maxZoomLevelsOnScreen` / `tileCountMaxMinRatio` are its documented defaults.
 */
function defaultTileZoom(
    requestedCenterZoom: number,
    distanceToTile3D: number,
    distanceToCenter3D: number,
    fovDeg: number,
    tilePitchRad: number,
): number {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const pitchBehavior = 2 * ((9.314 - 1)
        / Math.log2(Math.cos(rad(89.25 - fovDeg)) / Math.cos(rad(89.25))) - 1);
    return requestedCenterZoom
        + Math.log2(distanceToCenter3D / distanceToTile3D / Math.max(0.5, Math.cos(rad(fovDeg / 2))))
        + (pitchBehavior * Math.log2(Math.cos(tilePitchRad))) / 2;
}

/** 4 km from the eye, where `VIEWPOINT_TARGET_DISTANCE_M` parks the centre. */
const CENTER_3D = 4000;

/**
 * Terrain centre zooms the app actually requests from that 4 km centre on a
 * 638 px canvas, at both ends of the lens range (`transform.zoom` minus the one
 * level MapLibre's 1024 px terrain tiles cost).
 */
const CENTER_ZOOM_AT_60 = 11.89;
const CENTER_ZOOM_AT_8 = 14.94;

describe('panoramaTileZoom', () => {
    it('never asks a tile for more detail than the centre gets', () => {
        const zoom = panoramaTileZoom(3);
        // A tile right under the eye: the inverse-distance term alone would ask
        // for +10 levels, and each extra level quadruples the tile count.
        expect(zoom(14, 4, 0, CENTER_3D, 8)).toBe(14);
    });

    it('halving the distance to a tile buys one zoom level', () => {
        const zoom = panoramaTileZoom(0);
        const far = zoom(14, 40000, 0, CENTER_3D, 30);
        const half = zoom(14, 20000, 0, CENTER_3D, 30);
        expect(half - far).toBeCloseTo(1, 10);
    });

    it('shifts the whole far field by the bias, level for level', () => {
        const at = (bias: number) => panoramaTileZoom(bias)(14, 40000, 0, CENTER_3D, 8);
        expect(at(2) - at(0)).toBeCloseTo(2, 10);
    });

    it('gains detail on a distant tile as the lens narrows, where MapLibre loses it', () => {
        // Narrowing the lens raises the centre zoom (`zoomForCenterDistance`),
        // so a telephoto should buy detail. MapLibre gives it back and more:
        // its grazing penalty gets HARSHER as the field of view shrinks.
        const tilePitch = (89 * Math.PI) / 180;
        const before = defaultTileZoom(CENTER_ZOOM_AT_60, 40000, CENTER_3D, 60, tilePitch);
        const after = defaultTileZoom(CENTER_ZOOM_AT_8, 40000, CENTER_3D, 8, tilePitch);
        expect(after).toBeLessThan(before - 2);

        const zoom = panoramaTileZoom(2);
        expect(zoom(CENTER_ZOOM_AT_8, 40000, 0, CENTER_3D, 8))
            .toBeGreaterThan(zoom(CENTER_ZOOM_AT_60, 40000, 0, CENTER_3D, 60) + 2);
    });

    it('measures the distance in 3D, not on the ground', () => {
        const zoom = panoramaTileZoom(0);
        const flat = zoom(14, 3000, 0, CENTER_3D, 30);
        const below = zoom(14, 3000, 4000, CENTER_3D, 30);
        expect(below).toBeLessThan(flat);
    });

    it('does not divide by zero on the tile the eye sits in', () => {
        expect(Number.isFinite(panoramaTileZoom(0)(14, 0, 0, CENTER_3D, 30))).toBe(true);
    });
});

describe('missingMembers', () => {
    class Transform {
        _helper = { _nearZ: 1 };
        _calcMatrices(): void {}
    }

    it('finds members on the prototype and through nested objects', () => {
        expect(missingMembers(new Transform(), [
            ['_calcMatrices', 'function'],
            ['_helper._nearZ', 'number'],
        ])).toEqual([]);
    });

    it('reports a renamed, retyped or nulled member by its path', () => {
        const root = { terrain: { meshSize: '128', tileManager: null } };
        expect(missingMembers(root, [
            ['terrain._meshCache', 'object'],
            ['terrain.meshSize', 'number'],
            ['terrain.tileManager', 'object'],
            ['terrain.tileManager.tileSize', 'number'],
        ])).toEqual(['terrain._meshCache', 'terrain.meshSize', 'terrain.tileManager', 'terrain.tileManager.tileSize']);
    });
});
