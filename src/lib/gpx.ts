import { distanceMeters, lineDistanceMeters, type LngLatTuple } from '@/lib/geo';
import type { MapMarker, RouteSegment, RouteWaypoint } from '@/stores/routeStore';

function escapeXml(str: string): string {
    return str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export interface GpxImportResult {
    waypoints: RouteWaypoint[];
    /** Pre-computed segments from track data (preserves original geometry). */
    segments?: RouteSegment[];
    /** The file's `<wpt>`, unless they had to stand in as the route itself. */
    markers: MapMarker[];
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
    // <rte> is the route by definition; <wpt> are standalone points of interest and only a
    // fallback for files that carry none.
    const routePoints = parseRteElements(doc, ns);
    const wptPoints = parseWptElements(doc, ns);
    const waypoints = routePoints.length > 0 ? routePoints : wptPoints;
    const markers = routePoints.length > 0 ? toMarkers(wptPoints) : [];

    const trackCoords = parseTrackCoordinates(doc, ns);
    if (trackCoords.length >= 2) {
        const indices = waypoints.length >= 2 ? snapWaypointsToTrack(waypoints, trackCoords) : null;
        if (indices) return { waypoints, segments: buildSegmentsFromTrack(waypoints, trackCoords, indices), markers };
        // The points do not describe this track: sample it instead, and the <wpt> keep their
        // own identity as markers.
        return { ...buildFromTrackOnly(trackCoords, maxWaypoints), markers: toMarkers(wptPoints) };
    }

    return { waypoints, markers };
}

function toMarkers(wptPoints: RouteWaypoint[]): MapMarker[] {
    return wptPoints.map((wpt, index) => ({
        id: `mk-${index + 1}`,
        coordinate: wpt.coordinate,
        name: wpt.name,
    }));
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

/** Beyond this distance from the track, a point is a POI marker rather than a route waypoint. */
const TRACK_SNAP_TOLERANCE_M = 50;

function nearestTrackIndex(trackCoords: LngLatTuple[], target: LngLatTuple): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < trackCoords.length; i++) {
        const dx = trackCoords[i][0] - target[0];
        const dy = trackCoords[i][1] - target[1];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Snap each waypoint to its closest track point, and return the indices only if the
 * waypoints really describe the track: all on it, all in order. A GPX may otherwise
 * carry `<wpt>` that are standalone markers (ravitaillements, secours…) scattered
 * off-route and in arbitrary order — forcing those into an ordered route produces
 * phantom back-and-forth segments.
 */
function snapWaypointsToTrack(waypoints: RouteWaypoint[], trackCoords: LngLatTuple[]): number[] | null {
    const indices: number[] = [];
    let previous = -1;
    for (const wp of waypoints) {
        const idx = nearestTrackIndex(trackCoords, wp.coordinate);
        if (idx <= previous) return null;
        if (distanceMeters(trackCoords[idx], wp.coordinate) > TRACK_SNAP_TOLERANCE_M) return null;
        indices.push(idx);
        previous = idx;
    }
    return indices;
}

function buildSegmentsFromTrack(
    waypoints: RouteWaypoint[],
    trackCoords: LngLatTuple[],
    indices: number[],
): RouteSegment[] {
    const segments: RouteSegment[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const coords = trackCoords.slice(indices[i], indices[i + 1] + 1);
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
    return segments;
}

function buildFromTrackOnly(trackCoords: LngLatTuple[], maxWaypoints: number): { waypoints: RouteWaypoint[]; segments: RouteSegment[] } {
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

    // The waypoints the user placed: an ordered list of turn points, i.e. a <rte>.
    if (waypoints.length > 0) {
        gpx += `  <rte>\n`;
        gpx += `    <name>Itinéraire</name>\n`;
        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            const name = wp.name || `Point ${i + 1}`;
            gpx += `    <rtept lat="${wp.coordinate[1]}" lon="${wp.coordinate[0]}">\n`;
            gpx += `      <name>${escapeXml(name)}</name>\n`;
            gpx += `    </rtept>\n`;
        }
        gpx += `  </rte>\n`;
    }

    // The computed geometry between them: a <trk>.
    if (trackCoordinates.length > 0) {
        gpx += `  <trk>\n`;
        gpx += `    <name>Tracé</name>\n`;
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
