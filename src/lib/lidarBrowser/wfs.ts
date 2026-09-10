/**
 * IGN Géoplateforme WFS query: find LiDAR HD COPC tiles intersecting a
 * WGS84 bbox.
 *
 * Confirmed CORS-OK from any origin (verified May 2026 against
 * `https://data.geopf.fr/wfs/ows` with `Origin: https://*.github.io`).
 */

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TYPENAME = 'IGNF_LIDAR-HD_METADONNEE:metadata';
const MAX_TILES = 64;

/** Lambert-93 footprint of a tile. */
export interface TileBboxL93 { minX: number; maxX: number; minY: number; maxY: number }

export interface LidarTileRef {
    /** Public download URL of the .copc.laz file (also on data.geopf.fr). */
    url: string;
    /** Tile name from the WFS (LHD_FXX_xxxx_yyyy_PTS_LAMB93_IGN69). */
    name: string;
    /** Footprint, or null when the WFS didn't expose a usable NW corner. */
    bboxL93: TileBboxL93 | null;
}

/** LiDAR HD tiles are 1 km squares keyed by their NW corner in km (`"0999-6542"`). */
const TILE_SIZE_M = 1000;

function bboxFromNwCorner(nw: unknown): TileBboxL93 | null {
    if (typeof nw !== 'string') return null;
    const m = /^(\d{3,4})-(\d{3,4})$/.exec(nw.trim());
    if (!m) return null;
    const minX = Number(m[1]) * 1000;
    const maxY = Number(m[2]) * 1000;
    return { minX, maxX: minX + TILE_SIZE_M, minY: maxY - TILE_SIZE_M, maxY };
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
        // `url_npl` = nuage de points LAZ; the sibling url_mnt/mns/mnh are raster WMS.
        const lazUrl = props.url_npl;
        if (typeof lazUrl !== 'string' || !/\.(copc\.)?laz$/i.test(lazUrl)) continue;
        tiles.push({
            url: lazUrl,
            name: lazUrl.substring(lazUrl.lastIndexOf('/') + 1),
            bboxL93: bboxFromNwCorner(props.coordonnees_nw),
        });
        if (tiles.length >= MAX_TILES) break;
    }
    return tiles;
}
