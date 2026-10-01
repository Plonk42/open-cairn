import { distanceMeters, lineDistanceMeters, type LngLatTuple } from './geo';

export interface ElevationSample {
    distance: number;
    elevation: number;
    coordinate: LngLatTuple;
    slope: number;
}

export interface ElevationProfile {
    samples: ElevationSample[];
    ascent: number;
    descent: number;
}

/** Slope palette shared by the elevation chart and the collapsed dock rail. */
export function slopeColor(slope: number): string {
    if (slope <= -12) return '#2563eb';
    if (slope <= -4) return '#38bdf8';
    if (slope < 4) return '#34d399';
    if (slope < 10) return '#facc15';
    if (slope < 18) return '#fb923c';
    return '#ef4444';
}

interface IgnElevationPoint {
    lon: number;
    lat: number;
    z: number;
}

interface IgnElevationResponse {
    elevations?: IgnElevationPoint[];
}

const MAX_COORDINATES_PER_REQUEST = 1500;

/**
 * Ground models asked in order. LiDAR HD is the survey the displayed relief comes from;
 * RGE ALTI® is radar in the mountains (Chamechaude 2073.5 m against 2076.8 m) but
 * covers what LiDAR HD does not, which answers `-99999` there (Martinique).
 */
const ELEVATION_RESOURCES = ['ign_lidar_hd_mnt_mono_wld', 'ign_rge_alti_wld'];

const isNoData = (point: IgnElevationPoint): boolean => point.z <= -100;

function chunkCoordinates(coordinates: LngLatTuple[]): LngLatTuple[][] {
    const chunks: LngLatTuple[][] = [];
    for (let i = 0; i < coordinates.length; i += MAX_COORDINATES_PER_REQUEST) {
        chunks.push(coordinates.slice(i, i + MAX_COORDINATES_PER_REQUEST));
    }
    return chunks;
}

function buildProfile(points: IgnElevationPoint[], totalDistance: number): ElevationProfile {
    let rawDistance = 0;
    let ascent = 0;
    let descent = 0;
    const intermediate = points.map((point, index) => {
        const coordinate: LngLatTuple = [point.lon, point.lat];
        const elevation = point.z <= -100 ? 0 : point.z;
        if (index > 0) {
            const previousPoint = points[index - 1];
            const previousCoordinate: LngLatTuple = [previousPoint.lon, previousPoint.lat];
            const previousElevation = previousPoint.z <= -100 ? 0 : previousPoint.z;
            rawDistance += distanceMeters(previousCoordinate, coordinate);
            const deltaElevation = elevation - previousElevation;
            if (deltaElevation > 0) ascent += deltaElevation;
            if (deltaElevation < 0) descent += Math.abs(deltaElevation);
        }
        return { distance: rawDistance, elevation, coordinate, slope: 0 };
    });

    const ratio = rawDistance > 0 && totalDistance > 0 ? totalDistance / rawDistance : 1;
    const samples = intermediate.map((sample, index) => {
        const previous = intermediate[Math.max(0, index - 1)];
        const distanceDelta = Math.max(1, (sample.distance - previous.distance) * ratio);
        const elevationDelta = sample.elevation - previous.elevation;
        return {
            ...sample,
            distance: sample.distance * ratio,
            slope: index === 0 ? 0 : (elevationDelta / distanceDelta) * 100,
        };
    });

    return {
        samples,
        ascent: Math.round(ascent),
        descent: Math.round(descent),
    };
}

async function fetchElevationLine(chunk: LngLatTuple[], resource: string, signal?: AbortSignal): Promise<IgnElevationPoint[]> {
    const params = {
        lon: chunk.map((coordinate) => coordinate[0]).join('|'),
        lat: chunk.map((coordinate) => coordinate[1]).join('|'),
        indent: 'false',
        sampling: 200,
        resource,
    };
    const response = await fetch('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json', {
        method: 'POST',
        signal,
        body: JSON.stringify(params),
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) throw new Error(`Elevation request failed: ${response.status}`);
    return ((await response.json()) as IgnElevationResponse).elevations ?? [];
}

/** One chunk's profile, its no-data samples re-read from the next model (same line, same sampling, same points). */
async function fetchChunk(chunk: LngLatTuple[], signal?: AbortSignal): Promise<IgnElevationPoint[]> {
    const [first, ...fallbacks] = ELEVATION_RESOURCES;
    let points = await fetchElevationLine(chunk, first, signal);
    for (const resource of fallbacks) {
        if (!points.some(isNoData)) break;
        const fallback = await fetchElevationLine(chunk, resource, signal);
        points = points.map((point, i) => (isNoData(point) ? fallback[i] ?? point : point));
    }
    return points;
}

export async function computeElevationProfile(coordinates: LngLatTuple[], signal?: AbortSignal): Promise<ElevationProfile> {
    if (coordinates.length < 2) return { samples: [], ascent: 0, descent: 0 };
    const totalDistance = lineDistanceMeters(coordinates);
    const chunks = await Promise.all(chunkCoordinates(coordinates).map((chunk) => fetchChunk(chunk, signal)));
    const points = chunks.flat();
    if (points.length < 2) return { samples: [], ascent: 0, descent: 0 };
    return buildProfile(points, totalDistance);
}