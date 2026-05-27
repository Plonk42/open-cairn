/**
 * IGN Géoplateforme WFS query: find LiDAR HD COPC tiles intersecting a
 * WGS84 bbox.
 *
 * Confirmed CORS-OK from any origin (verified May 2026 against
 * `https://data.geopf.fr/wfs/ows` with `Origin: https://*.github.io`).
 */

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TYPENAME = 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle';
const MAX_TILES = 8;

export interface LidarTileRef {
    /** Public download URL of the .copc.laz file (also on data.geopf.fr). */
    url: string;
    /** Tile name from the WFS (LHD_FXX_xxxx_yyyy_PTS_O_LAMB93_IGN69). */
    name: string;
}

/**
 * Query the WFS for LiDAR HD tiles intersecting `[minLng, minLat, maxLng, maxLat]`.
 * Returns an empty array if no tile covers the area (typical when IGN has
 * not yet released the acquisition for that département).
 */
export async function findTiles(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    signal?: AbortSignal,
): Promise<LidarTileRef[]> {
    const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typenames: TYPENAME,
        srsname: 'EPSG:4326',
        // The IGN WFS uses lng,lat axis order in bbox regardless of srsname
        // (verified empirically against GetCapabilities + known-covered tiles).
        bbox: `${minLng},${minLat},${maxLng},${maxLat},EPSG:4326`,
        outputFormat: 'application/json',
        count: String(MAX_TILES + 5),
    });
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal,
    });
    if (!res.ok) {
        throw new Error(`WFS GetFeature failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json() as { features?: unknown[] };
    const features = Array.isArray(data.features) ? data.features : [];
    const tiles: LidarTileRef[] = [];
    for (const f of features) {
        const props = ((f as { properties?: Record<string, unknown> }).properties) ?? {};
        // The WFS schema has shifted over the years; accept the first value
        // that looks like a .laz/.copc.laz URL among the known property names.
        const candidates: unknown[] = [
            props.url, props.url_telech, props.name, ...Object.values(props),
        ];
        const lazUrl = candidates.find(
            (v): v is string =>
                typeof v === 'string' && /^https?:\/\/.+\.(copc\.)?laz$/i.test(v),
        );
        if (!lazUrl) continue;
        const name = typeof props.name === 'string' && props.name.length > 0
            ? props.name
            : lazUrl.substring(lazUrl.lastIndexOf('/') + 1);
        tiles.push({ url: lazUrl, name });
        if (tiles.length >= MAX_TILES) break;
    }
    return tiles;
}
