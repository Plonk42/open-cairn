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

interface IgnElevationPoint {
    lon: number;
    lat: number;
    z: number;
}

interface IgnElevationResponse {
    elevations?: IgnElevationPoint[];
}

const MAX_COORDINATES_PER_REQUEST = 1500;

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

export async function computeElevationProfile(coordinates: LngLatTuple[], signal?: AbortSignal): Promise<ElevationProfile> {
    if (coordinates.length < 2) return { samples: [], ascent: 0, descent: 0 };
    const totalDistance = lineDistanceMeters(coordinates);
    const responses = await Promise.all(chunkCoordinates(coordinates).map(async (chunk) => {
        const params = {
            lon: chunk.map((coordinate) => coordinate[0]).join('|'),
            lat: chunk.map((coordinate) => coordinate[1]).join('|'),
            indent: 'false',
            sampling: 200,
            resource: 'ign_rge_alti_wld',
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
        return response.json() as Promise<IgnElevationResponse>;
    }));

    const points = responses.flatMap((response) => response.elevations ?? []);
    if (points.length < 2) return { samples: [], ascent: 0, descent: 0 };
    return buildProfile(points, totalDistance);
}