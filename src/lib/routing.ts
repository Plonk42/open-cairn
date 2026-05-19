import { dedupeAdjacentCoordinates, distanceMeters, lineDistanceMeters, type LngLatTuple } from './geo';

export interface RouteSegmentResult {
    coordinates: LngLatTuple[];
    distance: number;
    duration: number;
}

interface IgnRouteResponse {
    geometry?: {
        coordinates?: unknown;
    };
    distance?: number;
    duration?: number;
}

const WALKING_SPEED_METERS_PER_SECOND = 4 / 3.6;

export function buildStraightSegment(start: LngLatTuple, end: LngLatTuple): RouteSegmentResult {
    const distance = distanceMeters(start, end);
    return {
        coordinates: [start, end],
        distance,
        duration: distance / WALKING_SPEED_METERS_PER_SECOND,
    };
}

export function mergeSegments(segments: RouteSegmentResult[]): RouteSegmentResult {
    const coordinates = dedupeAdjacentCoordinates(segments.flatMap((segment) => segment.coordinates));
    return {
        coordinates,
        distance: segments.reduce((sum, segment) => sum + segment.distance, 0),
        duration: segments.reduce((sum, segment) => sum + segment.duration, 0),
    };
}

function parseCoordinates(value: unknown): LngLatTuple[] | null {
    if (!Array.isArray(value)) return null;
    const coordinates = value.filter((item): item is LngLatTuple => {
        return Array.isArray(item)
            && item.length >= 2
            && typeof item[0] === 'number'
            && typeof item[1] === 'number';
    }).map((item) => [item[0], item[1]] as LngLatTuple);
    return coordinates.length >= 2 ? coordinates : null;
}

export async function computeIgnWalkingSegment(start: LngLatTuple, end: LngLatTuple, signal?: AbortSignal): Promise<RouteSegmentResult> {
    const url = new URL('https://data.geopf.fr/navigation/itineraire');
    url.searchParams.set('resource', 'bdtopo-osrm');
    url.searchParams.set('getSteps', 'false');
    url.searchParams.set('timeUnit', 'second');
    url.searchParams.set('optimization', 'shortest');
    url.searchParams.set('profile', 'pedestrian');
    url.searchParams.set('start', `${start[0]},${start[1]}`);
    url.searchParams.set('end', `${end[0]},${end[1]}`);

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Route request failed: ${response.status}`);
    const json = await response.json() as IgnRouteResponse;
    const coordinates = parseCoordinates(json.geometry?.coordinates);
    if (!coordinates) throw new Error('Route response does not contain a LineString geometry');

    const distance = typeof json.distance === 'number' ? json.distance : lineDistanceMeters(coordinates);
    const duration = typeof json.duration === 'number' ? json.duration : distance / WALKING_SPEED_METERS_PER_SECOND;
    return { coordinates, distance, duration };
}