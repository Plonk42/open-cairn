import { lineDistanceMeters, type LngLatTuple } from '@/lib/geo';
import type { RouteSegment, RouteWaypoint } from '@/stores/routeStore';

function escapeXml(str: string): string {
    return str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export interface GpxImportResult {
    waypoints: RouteWaypoint[];
    /** Pre-computed segments from track data (preserves original geometry). */
    segments?: RouteSegment[];
}

let importWaypointId = 1000;

function importId(): string {
    const id = `wp-${importWaypointId}`;
    importWaypointId += 1;
    return id;
}

export function parseGpx(gpxString: string, maxWaypoints = 10): GpxImportResult {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxString, 'application/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Fichier GPX invalide');
    }

    const ns = 'http://www.topografix.com/GPX/1/1';
    let waypoints = parseWptElements(doc, ns);

    // If no waypoints found, try to extract from <rte> (route points)
    if (waypoints.length === 0) {
        waypoints = parseRteElements(doc, ns);
    }

    // If we have waypoints (from <wpt> or <rte>), also check for track to use as segments
    const trackCoords = parseTrackCoordinates(doc, ns);
    if (waypoints.length >= 2 && trackCoords.length >= 2) {
        const segments = buildSegmentsFromTrack(waypoints, trackCoords);
        if (segments) return { waypoints, segments };
    }

    // If no waypoints at all, sample from track
    if (waypoints.length === 0 && trackCoords.length >= 2) {
        return buildFromTrackOnly(trackCoords, maxWaypoints);
    }

    return { waypoints };
}

function parseWptElements(doc: Document, ns: string): RouteWaypoint[] {
    const wptElements = doc.getElementsByTagNameNS(ns, 'wpt');
    const wptEls = wptElements.length > 0 ? wptElements : doc.getElementsByTagName('wpt');
    return parsePointElements(wptEls);
}

function parseRteElements(doc: Document, ns: string): RouteWaypoint[] {
    const rteptElements = doc.getElementsByTagNameNS(ns, 'rtept');
    const rteptEls = rteptElements.length > 0 ? rteptElements : doc.getElementsByTagName('rtept');
    return parsePointElements(rteptEls);
}

function parsePointElements(els: HTMLCollectionOf<Element>): RouteWaypoint[] {
    const waypoints: RouteWaypoint[] = [];
    for (const el of Array.from(els)) {
        const lat = Number.parseFloat(el.getAttribute('lat') ?? '');
        const lon = Number.parseFloat(el.getAttribute('lon') ?? '');
        if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
        const nameEl = el.getElementsByTagName('name')[0];
        const name = nameEl?.textContent?.trim() || undefined;
        waypoints.push({
            id: importId(),
            coordinate: [lon, lat],
            modeFromPrevious: waypoints.length === 0 ? undefined : 'free',
            name,
        });
    }
    return waypoints;
}

function parseTrackCoordinates(doc: Document, ns: string): LngLatTuple[] {
    const trkptElements = doc.getElementsByTagNameNS(ns, 'trkpt');
    const trkptEls = trkptElements.length > 0 ? trkptElements : doc.getElementsByTagName('trkpt');
    const trackCoords: LngLatTuple[] = [];
    for (const el of Array.from(trkptEls)) {
        const lat = Number.parseFloat(el.getAttribute('lat') ?? '');
        const lon = Number.parseFloat(el.getAttribute('lon') ?? '');
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            trackCoords.push([lon, lat]);
        }
    }
    return trackCoords;
}

const WALKING_SPEED = 4 / 3.6; // m/s

function buildSegmentsFromTrack(waypoints: RouteWaypoint[], trackCoords: LngLatTuple[]): RouteSegment[] | null {
    // For each waypoint, find the closest track point index
    const indices = waypoints.map((wp) => {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < trackCoords.length; i++) {
            const dx = trackCoords[i][0] - wp.coordinate[0];
            const dy = trackCoords[i][1] - wp.coordinate[1];
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    });

    // Ensure indices are monotonically non-decreasing (snap to closest valid position)
    for (let i = 1; i < indices.length; i++) {
        if (indices[i] < indices[i - 1]) indices[i] = indices[i - 1];
    }

    const segments: RouteSegment[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const startIdx = indices[i];
        const endIdx = indices[i + 1];
        const coords = trackCoords.slice(startIdx, endIdx + 1);
        // Need at least 2 points for a valid segment
        const segCoords = coords.length >= 2 ? coords : [waypoints[i].coordinate, waypoints[i + 1].coordinate];
        const distance = lineDistanceMeters(segCoords);
        segments.push({
            id: `${waypoints[i].id}-${waypoints[i + 1].id}`,
            coordinates: segCoords,
            distance,
            duration: distance / WALKING_SPEED,
            mode: 'free',
            hasSnapStart: false,
            hasSnapEnd: false,
            computed: true,
        });
    }
    return segments;
}

function buildFromTrackOnly(trackCoords: LngLatTuple[], maxWaypoints: number): GpxImportResult {
    // Sample up to maxWaypoints waypoints evenly along the track
    const maxPoints = Math.min(maxWaypoints, trackCoords.length);
    const step = (trackCoords.length - 1) / (maxPoints - 1);
    const waypoints: RouteWaypoint[] = [];
    const waypointIndices: number[] = [];

    for (let i = 0; i < maxPoints; i++) {
        const idx = Math.round(i * step);
        waypointIndices.push(idx);
        let name: string | undefined;
        if (i === 0) name = 'Départ';
        else if (i === maxPoints - 1) name = 'Arrivée';
        waypoints.push({
            id: importId(),
            coordinate: trackCoords[idx],
            modeFromPrevious: i === 0 ? undefined : 'free',
            name,
        });
    }

    // Build segments using actual track data between sampled points
    const segments: RouteSegment[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const coords = trackCoords.slice(waypointIndices[i], waypointIndices[i + 1] + 1);
        const distance = lineDistanceMeters(coords);
        segments.push({
            id: `${waypoints[i].id}-${waypoints[i + 1].id}`,
            coordinates: coords,
            distance,
            duration: distance / WALKING_SPEED,
            mode: 'free',
            hasSnapStart: false,
            hasSnapEnd: false,
            computed: true,
        });
    }

    return { waypoints, segments };
}

export function importGpxFile(maxWaypoints = 10): Promise<GpxImportResult | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.gpx,application/gpx+xml';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            try {
                const text = await file.text();
                resolve(parseGpx(text, maxWaypoints));
            } catch {
                resolve(null);
            }
        };
        input.click();
    });
}

export function buildGpxString(waypoints: RouteWaypoint[], trackCoordinates: LngLatTuple[]): string {
    const timestamp = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    gpx += `<gpx version="1.1" creator="open-cairn"\n`;
    gpx += `  xmlns="http://www.topografix.com/GPX/1/1"\n`;
    gpx += `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
    gpx += `  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;
    gpx += `  <metadata><time>${timestamp}</time></metadata>\n`;

    // Waypoints
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const name = wp.name || `Point ${i + 1}`;
        gpx += `  <wpt lat="${wp.coordinate[1]}" lon="${wp.coordinate[0]}">\n`;
        gpx += `    <name>${escapeXml(name)}</name>\n`;
        gpx += `  </wpt>\n`;
    }

    // Track
    if (trackCoordinates.length > 0) {
        gpx += `  <trk>\n`;
        gpx += `    <name>Itinéraire</name>\n`;
        gpx += `    <trkseg>\n`;
        for (const coord of trackCoordinates) {
            gpx += `      <trkpt lat="${coord[1]}" lon="${coord[0]}"></trkpt>\n`;
        }
        gpx += `    </trkseg>\n`;
        gpx += `  </trk>\n`;
    }

    gpx += `</gpx>\n`;
    return gpx;
}

export function exportGpx(waypoints: RouteWaypoint[], trackCoordinates: LngLatTuple[]): void {
    const gpxString = buildGpxString(waypoints, trackCoordinates);
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'itineraire.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
