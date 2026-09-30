/**
 * The names of the summits one can actually see from a standpoint, written
 * along the ridge — the PeakFinder reading of a panorama.
 *
 * Only offered in « Point de vue », and that is not an arbitrary restriction:
 * the whole thing answers "what am I looking at from here", which only has an
 * answer once the eye has stopped moving. An orbiting camera would re-march
 * every ray on every frame for a question nobody is asking.
 *
 * Three things happen here, in this order and at three different rates:
 *
 *   - the summit list is LOADED once per session (`lib/peaks.ts`, a file built
 *     offline by `tools/build-peaks.mjs`), then sliced to the eye's box;
 *   - visibility is MARCHED once the camera has stopped and the DEM is loaded,
 *     whenever the eye or the DRAWN terrain changed (`lib/peakSightings.ts`),
 *     and only for summits on drawn tiles.
 *     The tile cache is no ground truth: outside what is drawn, MapLibre
 *     answers from whatever ancestor it still holds, down to z5, hundreds of
 *     metres low. A summit turned away from keeps its last verdict; turned
 *     back to, it is marched again on the tiles loaded for it;
 *   - the labels are PLACED on every frame, through MapLibre's own matrix, at
 *     the height the march read. Which summits get NAMED is decided here
 *     rather than in the march, so it follows the zoom as you turn the wheel:
 *     the march answers what is visible, the placement what fits.
 *
 * Drawn as one SVG over the canvas, not as MapLibre markers: a marker would be
 * lifted onto whatever terrain `Map.project` finds, and re-sampling ~300
 * summits per frame is what the height kept from the march avoids.
 */

import { loadPeaks as loadAllPeaks, PEAKS_RADIUS_M, peaksWithin, type Peak } from '@/lib/peaks';
import {
    LABEL_ANGLE_DEG,
    LABEL_FONT_PX,
    labelPriority,
    layoutPeakLabels,
    reachScaleForFov,
    sightPeaks,
    type PeakLabelSlot,
    type PeakSighting,
} from '@/lib/peakSightings';
import { cameraObserver, observerKey, renderedGroundSampler, screenProjector } from '@/lib/skyProjection';
import { useMapStore } from '@/stores/mapStore';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useRef } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Quiet time after the last camera move before a march. */
const RECOMPUTE_DEBOUNCE_MS = 250;

/** The summit list is reused while the eye stays inside this radius. */
const REFETCH_DISTANCE_KEY_DIGITS = 2;
/** Margin, in pixels, a label may sit outside the canvas before being culled. */
const CULL_MARGIN_PX = 80;

/** Gap between the end of the leader line and the first letter. */
const TEXT_GAP_PX = 4;

interface LabelStyle {
    fontPx: number;
    weight: string;
    fill: string;
    dotRadius: string;
}

const PLAIN_STYLE: LabelStyle = { fontPx: LABEL_FONT_PX, weight: '600', fill: '#f8fafc', dotRadius: '1.7' };

/**
 * Rank 1, rank 2, then the rest. Size alone did not tell a 13 px name from a
 * 12 px one on screen; the gap comes as much from lightening the minor names,
 * kept at full size so they stay readable over bright snow.
 */
const EMPHASIS_STYLES: readonly LabelStyle[] = [
    { fontPx: 14, weight: '800', fill: '#fde68a', dotRadius: '2.6' },
    { fontPx: 13, weight: '700', fill: '#ffffff', dotRadius: '2.1' },
    { fontPx: LABEL_FONT_PX, weight: '500', fill: '#e2e8f0', dotRadius: '1.7' },
];

function labelStyle(peak: Peak, emphasis: boolean): LabelStyle {
    return emphasis ? EMPHASIS_STYLES[Math.min(peak.importance, 3) - 1] : PLAIN_STYLE;
}

interface PeakNode {
    sighting: PeakSighting;
    group: SVGGElement;
    line: SVGLineElement;
    dot: SVGCircleElement;
    text: SVGTextElement;
    fontPx: number;
}

function applyStyle(node: PeakNode, emphasis: boolean): void {
    const style = labelStyle(node.sighting.peak, emphasis);
    node.fontPx = style.fontPx;
    node.dot.setAttribute('r', style.dotRadius);
    node.text.setAttribute('fill', style.fill);
    node.text.setAttribute('font-size', String(style.fontPx));
    node.text.setAttribute('font-weight', style.weight);
}

function createNode(sighting: PeakSighting, emphasis: boolean): PeakNode {
    const group = document.createElementNS(SVG_NS, 'g');
    group.style.display = 'none';

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', 'rgba(248,250,252,0.55)');
    line.setAttribute('stroke-width', '1');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('fill', 'rgba(248,250,252,0.9)');

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(TEXT_GAP_PX));
    // A panorama runs from bright sky to black rock across one label's length,
    // so the halo is what makes the name readable, not the fill.
    text.setAttribute('stroke', 'rgba(2,6,23,0.85)');
    text.setAttribute('stroke-width', '3.5');
    text.setAttribute('paint-order', 'stroke fill');
    text.setAttribute('dominant-baseline', 'middle');
    // No height rather than a wrong one: no source publishes one for every
    // summit, and a height RGE ALTI® contradicted was dropped when the data
    // file was built rather than printed (`lib/peaks.ts`).
    const { name, spotHeightM } = sighting.peak;
    text.textContent = spotHeightM === null ? name : `${name} · ${spotHeightM} m`;

    group.append(line, dot, text);
    const node = { sighting, group, line, dot, text, fontPx: LABEL_FONT_PX };
    applyStyle(node, emphasis);
    return node;
}

/** Every DEM tile the drawn terrain asked for has arrived: the march reads nothing else. */
function demLoaded(map: MapLibreMap): boolean {
    const source = map.getTerrain()?.source;
    return source !== undefined && map.getSource(source) !== undefined && map.isSourceLoaded(source);
}

export function PeakLabelsOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const viewpoint = useMapStore((s) => s.viewpoint);
    const peakLabels = useMapStore((s) => s.peakLabels);
    const emphasis = useMapStore((s) => s.peakLabelsEmphasis);
    const active = peakLabels && viewpoint !== null;

    const hostRef = useRef<SVGSVGElement | null>(null);
    const nodesRef = useRef(new Map<string, PeakNode>());
    /** The eye, drawn-tile set and reach stretch the labels on screen were solved for, to skip idle no-ops. */
    const solvedRef = useRef<{ eye: string; coverage: unknown; reachScale: number }>({ eye: '', coverage: null, reachScale: 1 });
    /** Summits already sliced out, and the rounded eye they were sliced around. */
    const peaksRef = useRef<{ key: string; peaks: Peak[] }>({ key: '', peaks: [] });
    const timerRef = useRef<number | undefined>(undefined);

    const clearNodes = useCallback(() => {
        for (const node of nodesRef.current.values()) node.group.remove();
        nodesRef.current.clear();
    }, []);

    const place = useCallback(() => {
        const map = mapInstance;
        if (!map) return;
        const { width, height } = map.painter.transform;
        const project = screenProjector(map);
        const slots: PeakLabelSlot[] = [];
        for (const node of nodesRef.current.values()) {
            node.group.style.display = 'none';
            const { peak, groundM } = node.sighting;
            const at = project(peak.lng, peak.lat, groundM);
            if (!at) continue;
            const off = at.x < -CULL_MARGIN_PX || at.x > width + CULL_MARGIN_PX
                || at.y < -CULL_MARGIN_PX || at.y > height + CULL_MARGIN_PX;
            if (off) continue;
            slots.push({
                key: peak.id,
                x: at.x,
                y: at.y,
                priority: labelPriority(node.sighting),
                fontPx: node.fontPx,
            });
        }
        for (const placed of layoutPeakLabels(slots)) {
            const node = nodesRef.current.get(placed.key);
            if (!node) continue;
            node.group.style.display = '';
            node.line.setAttribute('x1', placed.tipX.toFixed(1));
            node.line.setAttribute('y1', placed.tipY.toFixed(1));
            node.line.setAttribute('x2', placed.anchorX.toFixed(1));
            node.line.setAttribute('y2', placed.anchorY.toFixed(1));
            node.dot.setAttribute('cx', placed.tipX.toFixed(1));
            node.dot.setAttribute('cy', placed.tipY.toFixed(1));
            node.text.setAttribute(
                'transform',
                `translate(${placed.anchorX.toFixed(1)},${placed.anchorY.toFixed(1)}) rotate(${LABEL_ANGLE_DEG})`,
            );
        }
    }, [mapInstance]);

    /** Slice the summits around the eye, reusing the list while it barely moves. */
    const loadPeaks = useCallback(async (lng: number, lat: number): Promise<Peak[] | null> => {
        const key = `${lng.toFixed(REFETCH_DISTANCE_KEY_DIGITS)}|${lat.toFixed(REFETCH_DISTANCE_KEY_DIGITS)}`;
        if (peaksRef.current.key === key) return peaksRef.current.peaks;
        try {
            const peaks = peaksWithin(await loadAllPeaks(), lng, lat, PEAKS_RADIUS_M);
            peaksRef.current = { key, peaks };
            return peaks;
        } catch (err) {
            // No ErrorBoundary anywhere: a rejected fetch must never escape.
            console.warn('Peak labels: summit data failed to load', err);
            return null;
        }
    }, []);

    /**
     * Re-judge the summits standing on drawn terrain, keep the verdicts of the
     * others: they are off screen, and their tiles are no longer trustworthy.
     */
    const merge = useCallback((host: SVGSVGElement, seen: readonly PeakSighting[], sample: (lng: number, lat: number) => number) => {
        const nodes = nodesRef.current;
        const seenIds = new Set(seen.map((s) => s.peak.id));
        for (const [id, node] of nodes) {
            const { peak } = node.sighting;
            if (seenIds.has(id) || !Number.isFinite(sample(peak.lng, peak.lat))) continue;
            node.group.remove();
            nodes.delete(id);
        }
        for (const sighting of seen) {
            const node = nodes.get(sighting.peak.id);
            if (node) {
                node.sighting = sighting;
                continue;
            }
            const created = createNode(sighting, emphasis);
            host.appendChild(created.group);
            nodes.set(sighting.peak.id, created);
        }
    }, [emphasis]);

    const recompute = useCallback(async () => {
        const map = mapInstance;
        const terrain = map?.terrain;
        const host = hostRef.current;
        if (!map || !terrain || !host || !demLoaded(map)) return;
        const observer = cameraObserver(map);
        if (!observer) return;
        const eye = observerKey(observer);
        const coverage = terrain.getCoverageIndex();
        const reachScale = reachScaleForFov(map.painter.transform.fov);
        const solved = solvedRef.current;
        if (eye === solved.eye && coverage === solved.coverage && reachScale === solved.reachScale) return;
        const eyeMoved = eye !== solved.eye;
        const claim = { eye, coverage, reachScale };
        solvedRef.current = claim;

        const peaks = await loadPeaks(observer.lng, observer.lat);
        if (peaks === null) {
            // Let the next idle try again rather than stay silent for the session.
            solvedRef.current = { eye: '', coverage: null, reachScale: 1 };
            return;
        }
        // The download may have outlived the mode, or a newer pass taken over.
        if (hostRef.current !== host || solvedRef.current !== claim) return;

        if (eyeMoved) clearNodes();
        const sample = renderedGroundSampler(terrain);
        merge(host, sightPeaks(observer, peaks, sample, reachScale), sample);
        place();
    }, [mapInstance, loadPeaks, clearNodes, merge, place]);

    const recomputeRef = useRef(recompute);
    const schedule = useCallback(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = undefined;
            void recomputeRef.current();
        }, RECOMPUTE_DEBOUNCE_MS);
    }, []);

    useEffect(() => {
        recomputeRef.current = recompute;
    }, [recompute]);

    useEffect(() => {
        for (const node of nodesRef.current.values()) applyStyle(node, emphasis);
        place();
    }, [emphasis, place]);

    useEffect(() => {
        const map = mapInstance;
        if (!map || !active) return undefined;

        const host = document.createElementNS(SVG_NS, 'svg');
        host.setAttribute('class', 'pointer-events-none absolute inset-0 h-full w-full');
        map.getContainer().appendChild(host);
        hostRef.current = host;

        // Not `idle`: that also waits for the basemap and for MapLibre's drape refresh,
        // one terrain tile per frame — seconds after the DEM the march reads is in place.
        const onRender = () => {
            if (timerRef.current === undefined && demLoaded(map)) schedule();
        };
        const onMove = () => {
            place();
            if (timerRef.current !== undefined) schedule();
        };
        map.on('render', onRender);
        map.on('move', onMove);
        schedule();

        return () => {
            window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
            map.off('render', onRender);
            map.off('move', onMove);
            clearNodes();
            solvedRef.current = { eye: '', coverage: null, reachScale: 1 };
            host.remove();
            hostRef.current = null;
        };
    }, [mapInstance, active, schedule, place, clearNodes]);

    return null;
}
