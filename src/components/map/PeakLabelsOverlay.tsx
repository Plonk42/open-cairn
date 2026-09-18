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
 *   - the summit list is FETCHED once per kilometre of eye movement
 *     (`lib/peaks.ts`, IGN BD TOPO® over WFS);
 *   - visibility is MARCHED once per eye position — ~220 rays, ~130 ms, paid
 *     when the eye lands and never again while you turn (`lib/peakSightings.ts`);
 *   - the labels are PLACED on every frame, which is pure arithmetic on
 *     directions that were solved once.
 *
 * Drawn as one SVG over the canvas, not as MapLibre markers: a marker is lifted
 * onto the terrain, and a summit 40 km away sits outside the loaded DEM, so it
 * would drop to sea level and shoot off screen. A direction has no such
 * dependency — the same reason `SkyLabelsOverlay` positions its hours that way.
 */

import { fetchPeaks, PEAKS_RADIUS_M, type Peak } from '@/lib/peaks';
import {
    LABEL_ANGLE_DEG,
    layoutPeakLabels,
    sightPeaks,
    type PeakLabelSlot,
    type PeakSighting,
} from '@/lib/peakSightings';
import { cameraObserver, demSampler, observerKey, projectDirection } from '@/lib/skyProjection';
import { useMapStore } from '@/stores/mapStore';
import { useCallback, useEffect, useRef } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The eye settles on `idle` a frame or two after landing; wait it out. */
const RECOMPUTE_DEBOUNCE_MS = 250;

/** The summit list is reused while the eye stays inside this radius. */
const REFETCH_DISTANCE_KEY_DIGITS = 2;

/** Margin, in pixels, a label may sit outside the canvas before being culled. */
const CULL_MARGIN_PX = 80;

/** Gap between the end of the leader line and the first letter. */
const TEXT_GAP_PX = 4;

interface PeakNode {
    sighting: PeakSighting;
    group: SVGGElement;
    line: SVGLineElement;
    dot: SVGCircleElement;
    text: SVGTextElement;
}

function createNode(sighting: PeakSighting): PeakNode {
    const group = document.createElementNS(SVG_NS, 'g');
    group.style.display = 'none';

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', 'rgba(248,250,252,0.55)');
    line.setAttribute('stroke-width', '1');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '1.7');
    dot.setAttribute('fill', 'rgba(248,250,252,0.9)');

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(TEXT_GAP_PX));
    text.setAttribute('fill', '#f8fafc');
    // A panorama runs from bright sky to black rock across one label's length,
    // so the halo is what makes the name readable, not the fill.
    text.setAttribute('stroke', 'rgba(2,6,23,0.85)');
    text.setAttribute('stroke-width', '3.5');
    text.setAttribute('paint-order', 'stroke fill');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', '600');
    text.setAttribute('dominant-baseline', 'middle');
    // No height rather than a wrong one: IGN publishes a surveyed spot height
    // for about a third of its summits, and nothing else on the map is worth
    // trusting for the one number a walker plans on (`lib/peaks.ts`).
    const { name, spotHeightM } = sighting.peak;
    text.textContent = spotHeightM === null ? name : `${name} ${spotHeightM} m`;

    group.append(line, dot, text);
    return { sighting, group, line, dot, text };
}

export function PeakLabelsOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const viewpoint = useMapStore((s) => s.viewpoint);
    const peakLabels = useMapStore((s) => s.peakLabels);
    const active = peakLabels && viewpoint !== null;

    const hostRef = useRef<SVGSVGElement | null>(null);
    const nodesRef = useRef<PeakNode[]>([]);
    /** The eye the labels on screen were solved for, to skip idle no-ops. */
    const lastKeyRef = useRef('');
    /** Summits already downloaded, and the rounded eye they were asked around. */
    const peaksRef = useRef<{ key: string; peaks: Peak[] }>({ key: '', peaks: [] });
    const timerRef = useRef<number | undefined>(undefined);
    const abortRef = useRef<AbortController | null>(null);

    const clearNodes = useCallback(() => {
        for (const node of nodesRef.current) node.group.remove();
        nodesRef.current = [];
    }, []);

    const place = useCallback(() => {
        const map = mapInstance;
        if (!map) return;
        const { width, height } = map.getCanvas().getBoundingClientRect();
        const slots: PeakLabelSlot[] = [];
        const byKey = new Map<string, PeakNode>();
        for (const node of nodesRef.current) {
            node.group.style.display = 'none';
            const at = projectDirection(map, node.sighting.dir);
            if (!at) continue;
            const off = at.x < -CULL_MARGIN_PX || at.x > width + CULL_MARGIN_PX
                || at.y < -CULL_MARGIN_PX || at.y > height + CULL_MARGIN_PX;
            if (off) continue;
            slots.push({ key: node.sighting.peak.id, x: at.x, y: at.y });
            byKey.set(node.sighting.peak.id, node);
        }
        for (const placed of layoutPeakLabels(slots)) {
            const node = byKey.get(placed.key);
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

    /** Download the summits around the eye, reusing the list while it barely moves. */
    const loadPeaks = useCallback(async (lng: number, lat: number): Promise<Peak[] | null> => {
        const key = `${lng.toFixed(REFETCH_DISTANCE_KEY_DIGITS)}|${lat.toFixed(REFETCH_DISTANCE_KEY_DIGITS)}`;
        if (peaksRef.current.key === key) return peaksRef.current.peaks;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const peaks = await fetchPeaks(lng, lat, PEAKS_RADIUS_M, controller.signal);
            peaksRef.current = { key, peaks };
            return peaks;
        } catch (err) {
            if (controller.signal.aborted) return null;
            // No ErrorBoundary anywhere: a rejected fetch must never escape.
            console.warn('Peak labels: IGN summit query failed', err);
            return null;
        }
    }, []);

    const recompute = useCallback(async () => {
        const map = mapInstance;
        const terrain = map?.terrain;
        const host = hostRef.current;
        if (!map || !terrain || !host) return;
        const observer = cameraObserver(map);
        if (!observer) return;
        const key = observerKey(observer);
        if (key === lastKeyRef.current) return;
        lastKeyRef.current = key;

        const peaks = await loadPeaks(observer.lng, observer.lat);
        if (peaks === null) {
            // Let the next idle try again rather than stay silent for the session.
            lastKeyRef.current = '';
            return;
        }
        // The download may have outlived the mode, or the eye may have moved on.
        if (hostRef.current !== host || lastKeyRef.current !== key) return;

        clearNodes();
        for (const sighting of sightPeaks(observer, peaks, demSampler(terrain))) {
            const node = createNode(sighting);
            host.appendChild(node.group);
            nodesRef.current.push(node);
        }
        place();
    }, [mapInstance, loadPeaks, clearNodes, place]);

    const recomputeRef = useRef(recompute);
    const schedule = useCallback(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void recomputeRef.current(), RECOMPUTE_DEBOUNCE_MS);
    }, []);

    useEffect(() => {
        recomputeRef.current = recompute;
    }, [recompute]);

    useEffect(() => {
        const map = mapInstance;
        if (!map || !active) return undefined;

        const host = document.createElementNS(SVG_NS, 'svg');
        host.setAttribute('class', 'pointer-events-none absolute inset-0 h-full w-full');
        map.getContainer().appendChild(host);
        hostRef.current = host;

        // `idle` rather than `moveend`: the DEM tiles the marches read are only
        // in place once the map has finished loading what the move asked for.
        map.on('idle', schedule);
        map.on('move', place);
        schedule();

        return () => {
            window.clearTimeout(timerRef.current);
            abortRef.current?.abort();
            abortRef.current = null;
            map.off('idle', schedule);
            map.off('move', place);
            clearNodes();
            lastKeyRef.current = '';
            host.remove();
            hostRef.current = null;
        };
    }, [mapInstance, active, schedule, place, clearNodes]);

    return null;
}
