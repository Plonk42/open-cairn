/**
 * Measures the actual COPC pyramid of a zone instead of assuming one.
 *
 * `lidarResolution` ships a table of densities per pyramid level, read off one
 * tile. That table is a median at best: probed on six tiles, level 3 alone
 * spans 2.2 → 14.7 pt/m², and two adjacent Vercors tiles differ by 1.8×. IGN
 * only specifies a floor (≥10 pulses/m², ≥5 above 3200 m) and the COPC spec
 * says nothing about how many points a level holds — so no constant can be
 * right everywhere.
 *
 * It does not have to be guessed either: the hierarchy carries `pointCount` per
 * node, which costs a handful of small range requests to read. This module
 * reads it and returns the profile the cost model should use for *this* zone.
 */
import type { CaptureRect } from '../lidarCaptureRect';
import { rectEnclosingRadiusM } from '../lidarCaptureRect';
import { RESOLUTION_STOPS_M, type PyramidProfile } from '../lidarResolution';
import { collectIntersectingNodes, type CopcHandle } from './hierarchy';
import { lngLatToL93 } from './proj';
import { createRangeGetter } from './rangeGetter';
import { findTiles, type LidarTileRef } from './wfs';

import { Copc } from 'copc';

/**
 * Tiles opened per probe. A 5 km zone spans 25+ of them; the pyramid varies
 * between neighbours but not wildly, so four tiles around the centre buy most
 * of the accuracy for a bounded number of requests.
 */
const MAX_PROBED_TILES = 4;

/** Deepest COPC level a stop maps to — stop index i is level i (see RESOLUTION_STOPS_M). */
const DEEPEST_LEVEL = RESOLUTION_STOPS_M.length - 2;

/** Whole-tile cumulative densities (pt/m²), one per resolution stop. */
async function probeTile(tile: LidarTileRef): Promise<number[]> {
    const { get } = createRangeGetter(tile.url);
    const copc = await Copc.create(get) as unknown as CopcHandle & { header: { pointCount: number } };
    const cube = copc.info.cube;
    const areaM2 = (cube[3] - cube[0]) * (cube[4] - cube[1]);
    // No bbox filter: we want the tile's own pyramid, not the slice the capture
    // would download, so the density is not biased by the overshoot of coarse
    // nodes (a level-0 node is the whole km²).
    const whole = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
    const nodes = await collectIntersectingNodes(get, copc, whole, DEEPEST_LEVEL);

    const perLevel = new Array<number>(DEEPEST_LEVEL + 1).fill(0);
    for (const { key, node } of nodes) {
        const level = Number(key.split('-')[0]);
        perLevel[level] += node.pointCount;
    }
    const cumulative: number[] = [];
    let running = 0;
    for (const count of perLevel) {
        running += count;
        cumulative.push(running / areaM2);
    }
    // Last stop is the native density: every level, including those below the
    // ones we walked.
    cumulative.push(copc.header.pointCount / areaM2);
    return cumulative;
}

/** The tiles whose centre is nearest the zone's, `MAX_PROBED_TILES` at most. */
function nearestTiles(tiles: LidarTileRef[], x0: number, y0: number): LidarTileRef[] {
    const distance = (t: LidarTileRef): number => {
        const b = t.bboxL93;
        if (!b) return Infinity;
        return Math.hypot((b.minX + b.maxX) / 2 - x0, (b.minY + b.maxY) / 2 - y0);
    };
    return [...tiles].sort((a, b) => distance(a) - distance(b)).slice(0, MAX_PROBED_TILES);
}

/**
 * Read the real pyramid of the tiles under `rect`. Returns null when no tile
 * covers the zone or every probe failed — the caller then keeps the table.
 */
export async function measureCapturePyramid(
    rect: CaptureRect, signal?: AbortSignal,
): Promise<PyramidProfile | null> {
    const radius = rectEnclosingRadiusM(rect.widthM, rect.lengthM);
    const [x0, y0] = lngLatToL93(rect.centerLng, rect.centerLat);
    const dLat = radius / 111_320;
    const dLng = radius / (111_320 * Math.cos((rect.centerLat * Math.PI) / 180));
    const tiles = await findTiles(
        rect.centerLng - dLng, rect.centerLat - dLat,
        rect.centerLng + dLng, rect.centerLat + dLat,
        signal,
    );
    if (tiles.length === 0) return null;

    const probes: number[][] = [];
    for (const tile of nearestTiles(tiles, x0, y0)) {
        if (signal?.aborted) return null;
        try {
            probes.push(await probeTile(tile));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[lidarBrowser] pyramid probe failed on', tile.name, e);
        }
    }
    if (probes.length === 0) return null;

    return probes[0].map(
        (_, stop) => probes.reduce((sum, p) => sum + p[stop], 0) / probes.length,
    );
}
