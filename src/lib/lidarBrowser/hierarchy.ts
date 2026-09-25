/**
 * COPC hierarchy walk, shared by the extractor and the pyramid probe.
 *
 * The hierarchy is the cheap, self-describing part of a COPC file: a few kB of
 * pages listing, per octree node, its level, its point count and its compressed
 * size. Reading it answers "what would a capture at this level download?"
 * exactly, without touching a single point.
 */
import { Copc, Key } from 'copc';
import type { RangeGet } from './rangeGetter';

export interface CopcNode {
    pointCount: number;
    pointDataOffset: number;
    pointDataLength: number;
}

export interface CopcHandle {
    info: { rootHierarchyPage: unknown; cube: number[]; spacing: number };
}
/** XY-only query box in Lambert-93. */
export interface QueryBboxL93 { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Oriented capture rectangle in Lambert-93: centre, unit length axis `(ux, uy)`
 * (the width axis is its left-perpendicular) and half-extents.
 */
export interface QueryRectL93 {
    x0: number;
    y0: number;
    ux: number;
    uy: number;
    halfWidthM: number;
    halfLengthM: number;
}

/** Whether an axis-aligned box meets the rectangle (separating axis test). */
export function boxMeetsRect(b: QueryBboxL93, r: QueryRectL93): boolean {
    const cx = (b.minX + b.maxX) / 2 - r.x0;
    const cy = (b.minY + b.maxY) / 2 - r.y0;
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    const ax = Math.abs(r.ux);
    const ay = Math.abs(r.uy);
    return Math.abs(cx) <= hx + r.halfLengthM * ax + r.halfWidthM * ay
        && Math.abs(cy) <= hy + r.halfLengthM * ay + r.halfWidthM * ax
        && Math.abs(cx * r.ux + cy * r.uy) <= r.halfLengthM + hx * ax + hy * ay
        && Math.abs(-cx * r.uy + cy * r.ux) <= r.halfWidthM + hx * ay + hy * ax;
}

/** 3D bounds of a COPC node from its octree key + the root cube. */
function nodeBounds(
    key: readonly [number, number, number, number],
    cube: number[],
): { minX: number; maxX: number; minY: number; maxY: number } {
    const [d, kx, ky] = key;
    const span = 1 << d;
    const sx = (cube[3] - cube[0]) / span;
    const sy = (cube[4] - cube[1]) / span;
    const minX = cube[0] + kx * sx;
    const minY = cube[1] + ky * sy;
    return { minX, minY, maxX: minX + sx, maxY: minY + sy };
}

function intersectsXY(
    key: readonly [number, number, number, number], cube: number[], bbox: QueryBboxL93,
    rect: QueryRectL93 | null,
): boolean {
    const nb = nodeBounds(key, cube);
    return nb.maxX >= bbox.minX && nb.minX <= bbox.maxX
        && nb.maxY >= bbox.minY && nb.minY <= bbox.maxY
        && (!rect || boxMeetsRect(nb, rect));
}

/** Entries of a hierarchy page that are in range and overlap the query box. */
function selectRelevant<T>(
    entries: Record<string, T | undefined>, cube: number[], bbox: QueryBboxL93,
    rect: QueryRectL93 | null, maxLevel: number,
): Array<[string, T]> {
    const out: Array<[string, T]> = [];
    for (const [keyStr, value] of Object.entries(entries)) {
        if (!value) continue;
        const k = Key.parse(keyStr);
        if (k[0] > maxLevel) continue;
        if (!intersectsXY(k, cube, bbox, rect)) continue;
        out.push([keyStr, value]);
    }
    return out;
}

/**
 * Walk the COPC hierarchy from the root page, descending only into branches
 * intersecting the XY query bbox — and the oriented `rect`, when given — and
 * no deeper than `maxLevel`. Sub-pages are loaded lazily.
 */
export async function collectIntersectingNodes(
    get: RangeGet,
    copc: CopcHandle,
    bbox: QueryBboxL93,
    maxLevel: number,
    rect: QueryRectL93 | null = null,
): Promise<Array<{ key: string; node: CopcNode }>> {
    const cube = copc.info.cube;
    const out: Array<{ key: string; node: CopcNode }> = [];
    const pageQueue: string[] = ['0-0-0-0'];
    const knownPages: Record<string, unknown> = {
        '0-0-0-0': copc.info.rootHierarchyPage,
    };
    while (pageQueue.length > 0) {
        const pageKey = pageQueue.shift();
        if (pageKey === undefined) break;
        const pageRef = knownPages[pageKey];
        if (!pageRef) continue;
        // `Copc.loadHierarchyPage` returns `{ nodes, pages }`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { nodes, pages } = await Copc.loadHierarchyPage(get, pageRef as any);
        for (const [keyStr, node] of selectRelevant(nodes, cube, bbox, rect, maxLevel)) {
            // Skip empty hierarchy entries — the getter would throw on 0-length range.
            if (!node.pointCount || !node.pointDataLength) continue;
            out.push({ key: keyStr, node });
        }
        for (const [keyStr, sub] of selectRelevant(pages, cube, bbox, rect, maxLevel)) {
            knownPages[keyStr] = sub;
            pageQueue.push(keyStr);
        }
    }
    return out;
}
