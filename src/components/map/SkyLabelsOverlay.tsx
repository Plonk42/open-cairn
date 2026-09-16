/**
 * Every piece of text written over the sky: the hour a body clears the relief
 * and the hour it goes back behind it, plus the hour of each graduation along
 * the track — for the sun and for the moon.
 *
 * The sky-body layers already show *that* a track is cut by the terrain — they
 * depth-test it on the GPU and draw the hidden half dashed. That answer never
 * leaves the GPU though, so the crossing is solved a second time on the CPU
 * (`src/lib/skyline.ts`) to obtain a time and a direction.
 *
 * The observer is the CAMERA EYE, not the LiDAR site: that is the eye the
 * dashed/solid split is computed from, so the label lands exactly where the
 * track changes style. The ephemeris, on the other hand, is evaluated at the
 * same site as the track itself — otherwise the label would describe a
 * slightly different sun than the one drawn.
 *
 * The labels are positioned like the tracks, i.e. **at infinity**, with the
 * same pinhole model the layers' vertex shader uses. A `Marker` anchored to the
 * ridge's ground coordinates was tried first and is the wrong tool: MapLibre
 * lifts a marker onto the terrain, and a ridge 30 km away falls outside the
 * loaded DEM as soon as the map settles elsewhere — the label then drops to sea
 * level and shoots hundreds of pixels off. A direction has no such dependency.
 */

import { hourTicks, moonSampleAt, sampleSkyPath, sunSampleAt, type SkyPathTick, type SkySampleAt } from '@/lib/skyPath';
import {
    findSkyCrossings,
    formatCrossingTime,
    skylineAt,
    type SkylineObserver,
    type SkylinePoint,
} from '@/lib/skyline';
import { parseSunDate } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { LngLat, type Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Zoom the DEM is sampled at. Measured against the renderer's own
 * `queryTerrainElevation` over eight azimuths around Chamonix: z11 misses a
 * near ridge by up to 0.51° — two solar diameters — while z13 stays within
 * 0.07° everywhere for 0.76 ms a ray instead of 0.57 ms. Going finer buys
 * nothing and risks reading tiles the terrain cache never loaded for the far
 * field, which would come back as sea level.
 */
const SKYLINE_ZOOM = 13;

/** Recompute no more often than this — a full day's scan costs ~70 ms. */
const RECOMPUTE_DEBOUNCE_MS = 250;

const DEG = Math.PI / 180;

interface SkyLabel {
    /** Unit ENU directions to project; the label lands on the lowest one. */
    dirs: readonly [number, number, number][];
    /** How the box hangs off that point. */
    anchor: string;
    el: HTMLElement;
}

/** What tells one body's labels from the other's, in the UI's own language. */
interface LabelledBody {
    /** French, for the tooltip: « Lever DU SOLEIL à … ». */
    riseOf: string;
    setOf: string;
    /** French subject of the hour tooltip: « LE SOLEIL est ici à … ». */
    subject: string;
    /** Tailwind classes, matching the track's palette. */
    tone: string;
    /** Same palette, quieter: an hour label is read only when looked for. */
    hourTone: string;
}

const SUN_BODY: LabelledBody = {
    riseOf: 'du soleil',
    setOf: 'du soleil',
    subject: 'Le soleil',
    tone: 'text-amber-300 ring-amber-400/50',
    hourTone: 'text-amber-200/85',
};

const MOON_BODY: LabelledBody = {
    riseOf: 'de la lune',
    setOf: 'de la lune',
    subject: 'La lune',
    tone: 'text-sky-200 ring-sky-300/50',
    hourTone: 'text-sky-200/85',
};

function labelElement(body: LabelledBody, kind: 'rise' | 'set', minutesOfDay: number): HTMLElement {
    const el = document.createElement('div');
    const when = formatCrossingTime(minutesOfDay);
    el.className = 'absolute left-0 top-0 hidden rounded px-1.5 py-0.5 text-xs font-semibold '
        + `bg-black/65 ring-1 whitespace-nowrap will-change-transform ${body.tone}`;
    el.textContent = `${kind === 'rise' ? '↑' : '↓'} ${when}`;
    el.title = kind === 'rise'
        ? `Lever ${body.riseOf} sur l'horizon réel à ${when}`
        : `Coucher ${body.setOf} sur l'horizon réel à ${when}`;
    return el;
}

/** The hour of one graduation, written just under it — no box, no ring. */
function hourLabelElement(body: LabelledBody, tick: SkyPathTick): HTMLElement {
    const el = document.createElement('div');
    el.className = 'absolute left-0 top-0 hidden whitespace-nowrap text-[10px] font-medium '
        + `leading-none will-change-transform [text-shadow:0_1px_2px_rgb(0_0_0/0.85)] ${body.hourTone}`;
    el.textContent = `${tick.minutesOfDay / 60}h`;
    el.title = `${body.subject} est ici à ${formatCrossingTime(tick.minutesOfDay)}`;
    return el;
}

/** The camera eye — the same eye the track's hidden half is depth-tested from. */
function cameraObserver(map: MapLibreMap): SkylineObserver | null {
    const eye = map.transform.getCameraLngLat();
    const altitudeM = map.transform.getCameraAltitude();
    if (!eye || !Number.isFinite(altitudeM)) return null;
    return { lng: eye.lng, lat: eye.lat, altitudeM };
}

/**
 * Where a direction at infinity lands on screen, in CSS pixels.
 *
 * Same pinhole as MapLibre's own camera: the focal length in pixels is
 * `0.5·height/tan(fovY/2)`, which is exactly its `cameraToCenterDistance`.
 * Returns null when the direction is behind the camera.
 */
function projectDirection(map: MapLibreMap, dir: readonly number[]): { x: number; y: number } | null {
    const bearing = map.getBearing() * DEG;
    const pitch = map.getPitch() * DEG;
    const sinB = Math.sin(bearing);
    const cosB = Math.cos(bearing);
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    // ENU basis of the camera: pitch 0 looks straight down, 90 at the horizon.
    const forward = [sinB * sinP, cosB * sinP, -cosP];
    const up = [sinB * cosP, cosB * cosP, sinP];
    const right = [cosB, -sinB, 0];
    const dot = (v: number[]) => dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2];

    const depth = dot(forward);
    if (depth <= 1e-4) return null;
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const focal = (0.5 * height) / Math.tan((map.getVerticalFieldOfView() * DEG) / 2);
    return {
        x: width / 2 + (focal * dot(right)) / depth,
        y: height / 2 - (focal * dot(up)) / depth,
    };
}

export function SkyLabelsOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const enabled = useMapStore((s) => s.lidarSunPath);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    // Same site as the track (see `SunPathOverlay`), so both describe one sun.
    const lng = useMapStore((s) => s.lidarShaded?.centerLng ?? s.lidarMesh?.centerLng ?? s.view.longitude);
    const lat = useMapStore((s) => s.lidarShaded?.centerLat ?? s.lidarMesh?.centerLat ?? s.view.latitude);

    const hostRef = useRef<HTMLDivElement | null>(null);
    const labelsRef = useRef<SkyLabel[]>([]);
    /** Inputs the labels on screen were computed from, to skip idle no-ops. */
    const lastKeyRef = useRef('');

    const clearLabels = useCallback(() => {
        for (const label of labelsRef.current) label.el.remove();
        labelsRef.current = [];
    }, []);

    const place = useCallback(() => {
        const map = mapInstance;
        if (!map) return;
        for (const label of labelsRef.current) {
            // Lowest of the anchors on screen: an hour label then sits under
            // its graduation whatever the camera roll, without a second rule
            // for which end of the tick is the outer one.
            let at: { x: number; y: number } | null = null;
            for (const dir of label.dirs) {
                const point = projectDirection(map, dir);
                if (point && (!at || point.y > at.y)) at = point;
            }
            label.el.classList.toggle('hidden', !at);
            if (at) label.el.style.transform = `translate(${at.x}px, ${at.y}px) ${label.anchor}`;
        }
    }, [mapInstance]);

    /** Solve one body's two crossings, and label every hour of its track. */
    const addBodyLabels = useCallback((
        host: HTMLElement,
        body: LabelledBody,
        positionAt: SkySampleAt,
        skyline: (azimuthDeg: number) => SkylinePoint,
    ) => {
        const { rise, set } = findSkyCrossings(positionAt, skyline);
        for (const crossing of [rise, set]) {
            if (!crossing) continue;
            const el = labelElement(body, crossing.kind, crossing.minutesOfDay);
            host.appendChild(el);
            labelsRef.current.push({
                dirs: [positionAt(crossing.minutesOfDay).dir],
                anchor: 'translate(-50%, -110%)',
                el,
            });
        }
        // Only above the true horizon: the rest of the track runs through the
        // ground, where an hour would just float over the landscape.
        for (const tick of hourTicks(sampleSkyPath(positionAt))) {
            if (tick.elevationDeg <= 0) continue;
            const el = hourLabelElement(body, tick);
            host.appendChild(el);
            labelsRef.current.push({ dirs: [...tick.ends], anchor: 'translate(-50%, 3px)', el });
        }
    }, []);

    const recompute = useCallback(() => {
        const map = mapInstance;
        const terrain = map?.terrain;
        const host = hostRef.current;
        if (!map || !terrain || !host) return;
        const observer = cameraObserver(map);
        if (!observer) return;
        // The eye is what the skyline depends on, so a pure rotation or a zoom
        // that leaves it in place need not pay for a new scan.
        const key = [
            sunDate, lat.toFixed(4), lng.toFixed(4),
            observer.lng.toFixed(4), observer.lat.toFixed(4), observer.altitudeM.toFixed(0),
        ].join('|');
        if (key === lastKeyRef.current) return;
        lastKeyRef.current = key;

        // One cache for the whole pass, shared by both bodies: the bisection
        // re-asks for azimuths the coarse scan already solved, the moon walks
        // much the same band of sky as the sun, and a single ray is some 400
        // DEM lookups.
        const cache = new Map<number, SkylinePoint>();
        const skyline = (azimuthDeg: number): SkylinePoint => {
            const cacheKey = Math.round(azimuthDeg * 4);
            const hit = cache.get(cacheKey);
            if (hit) return hit;
            const point = skylineAt(observer, azimuthDeg, (sLng, sLat) =>
                terrain.getElevationForLngLatZoom(new LngLat(sLng, sLat), SKYLINE_ZOOM));
            cache.set(cacheKey, point);
            return point;
        };

        const { datePart } = parseSunDate(sunDate);
        clearLabels();
        addBodyLabels(host, SUN_BODY, (t) => sunSampleAt(datePart, t, lat, lng), skyline);
        addBodyLabels(host, MOON_BODY, (t) => moonSampleAt(datePart, t, lat, lng), skyline);
        place();
    }, [mapInstance, sunDate, lat, lng, clearLabels, place, addBodyLabels]);

    useEffect(() => {
        const map = mapInstance;
        if (!map || !enabled) return undefined;

        const host = document.createElement('div');
        host.className = 'pointer-events-none absolute inset-0 overflow-hidden';
        map.getContainer().appendChild(host);
        hostRef.current = host;

        let timer: number | undefined;
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(recompute, RECOMPUTE_DEBOUNCE_MS);
        };
        // `idle` rather than `moveend`: the DEM tiles the march reads are only
        // in place once the map has finished loading what the move asked for.
        map.on('idle', schedule);
        map.on('move', place);
        schedule();

        return () => {
            window.clearTimeout(timer);
            map.off('idle', schedule);
            map.off('move', place);
            clearLabels();
            lastKeyRef.current = '';
            host.remove();
            hostRef.current = null;
        };
    }, [mapInstance, enabled, recompute, place, clearLabels]);

    return null;
}
