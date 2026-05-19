export type LngLatTuple = [number, number];

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export function distanceMeters(a: LngLatTuple, b: LngLatTuple): number {
    const lat1 = a[1] * DEG_TO_RAD;
    const lat2 = b[1] * DEG_TO_RAD;
    const deltaLat = (b[1] - a[1]) * DEG_TO_RAD;
    const deltaLng = (b[0] - a[0]) * DEG_TO_RAD;

    const sinLat = Math.sin(deltaLat / 2);
    const sinLng = Math.sin(deltaLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function lineDistanceMeters(coordinates: LngLatTuple[]): number {
    let distance = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        distance += distanceMeters(coordinates[i - 1], coordinates[i]);
    }
    return distance;
}

export function dedupeAdjacentCoordinates(coordinates: LngLatTuple[]): LngLatTuple[] {
    return coordinates.filter((coordinate, index) => {
        if (index === 0) return true;
        const previous = coordinates[index - 1];
        return previous[0] !== coordinate[0] || previous[1] !== coordinate[1];
    });
}

export function interpolateAlongLine(coordinates: LngLatTuple[], targetDistance: number): LngLatTuple | null {
    if (coordinates.length === 0) return null;
    if (coordinates.length === 1 || targetDistance <= 0) return coordinates[0];

    let travelled = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        const start = coordinates[i - 1];
        const end = coordinates[i];
        const segmentDistance = distanceMeters(start, end);
        if (travelled + segmentDistance >= targetDistance) {
            const ratio = segmentDistance === 0 ? 0 : (targetDistance - travelled) / segmentDistance;
            return [
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio,
            ];
        }
        travelled += segmentDistance;
    }

    return coordinates.at(-1) ?? coordinates[0];
}

export function sliceLineByDistance(coordinates: LngLatTuple[], startDistance: number, endDistance: number): LngLatTuple[] {
    if (coordinates.length < 2 || startDistance >= endDistance) return [];
    const result: LngLatTuple[] = [];
    let travelled = 0;
    let started = false;

    for (let i = 0; i < coordinates.length; i += 1) {
        if (i > 0) {
            const segLen = distanceMeters(coordinates[i - 1], coordinates[i]);
            const prevTravelled = travelled;
            travelled += segLen;

            if (!started && travelled >= startDistance) {
                const ratio = segLen === 0 ? 0 : (startDistance - prevTravelled) / segLen;
                result.push([
                    coordinates[i - 1][0] + (coordinates[i][0] - coordinates[i - 1][0]) * ratio,
                    coordinates[i - 1][1] + (coordinates[i][1] - coordinates[i - 1][1]) * ratio,
                ]);
                started = true;
            }

            if (started && travelled >= endDistance) {
                const ratio = segLen === 0 ? 0 : (endDistance - prevTravelled) / segLen;
                result.push([
                    coordinates[i - 1][0] + (coordinates[i][0] - coordinates[i - 1][0]) * ratio,
                    coordinates[i - 1][1] + (coordinates[i][1] - coordinates[i - 1][1]) * ratio,
                ]);
                break;
            }

            if (started) {
                result.push(coordinates[i]);
            }
        }
    }
    return result;
}

export function formatDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 1 : 2)} km`;
    return `${Math.round(meters)} m`;
}

export function formatElevation(meters: number): string {
    return `${Math.round(meters)} m`;
}