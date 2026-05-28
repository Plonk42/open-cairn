/**
 * Client for the local LiDAR HD point cloud service
 * (`services/lidar-cloud/server.mjs`).
 *
 * Binary payload layout matches the server (see that file for details).
 */

export interface LidarCloudData {
    /** WGS84 longitude of the request center (origin for `positions`). */
    centerLng: number;
    /** WGS84 latitude of the request center. */
    centerLat: number;
    /**
     * Interleaved (dx_east_m, dy_north_m, alt_m) Float32, length = 3 * pointCount.
     * Compatible with deck.gl `COORDINATE_SYSTEM.METER_OFFSETS`.
     */
    positions: Float32Array;
    /** ASPRS LAS classification per point. */
    classifications: Uint8Array;
    pointCount: number;
    /** Radius used for the request, meters. */
    radius: number;
}

export interface FetchLidarCloudParams {
    lng: number;
    lat: number;
    /** Half-side of the bbox in meters (server clamps to MAX_RADIUS_M). */
    radius: number;
    /** 1 = full density, N = keep one in N points (after bbox filter). */
    stride: number;
    /** Optional LAS class whitelist (e.g. `[2]` for ground only). */
    classes?: number[];
    signal?: AbortSignal;
}

export interface LidarMeshData {
    kind: 'mesh';
    centerLng: number;
    centerLat: number;
    /** Interleaved (dx_east_m, dy_north_m, alt_m) Float32, length = 3 * vertexCount. */
    positions: Float32Array;
    /** Interleaved (nx, ny, nz) Float32, length = 3 * vertexCount. */
    normals: Float32Array;
    /** RGBA Uint8, length = 4 * vertexCount. */
    colors: Uint8Array;
    /** Triangle vertex indices, length = 3 * triangleCount. */
    indices: Uint32Array;
    vertexCount: number;
    triangleCount: number;
    radius: number;
}

export interface FetchLidarMeshParams extends FetchLidarCloudParams {
    /** Filter to these LAS classes. Default `[2]` (ground only). */
    classes?: number[];
    /** Mesh reconstruction algorithm. Service backend always uses Delaunay; accepted for API parity with the browser pipeline. */
    meshMethod?: 'delaunay' | 'grid' | 'voxel';
}

export interface LidarShadedCloudData {
    kind: 'shaded';
    centerLng: number;
    centerLat: number;
    /** Interleaved (dx_east_m, dy_north_m, alt_m) Float32. */
    positions: Float32Array;
    /** Interleaved (nx, ny, nz) Float32 per point. */
    normals: Float32Array;
    /** RGBA Uint8 per point (slope-based palette). */
    colors: Uint8Array;
    /** ASPRS LAS classification per point. */
    classifications: Uint8Array;
    pointCount: number;
    radius: number;
}

/**
 * Combined output for the "mixed" mode: ground (class 2) is reconstructed
 * as a Delaunay mesh, every other point is kept as a shaded cloud so the
 * user can toggle vegetation/buildings on/off via the existing class mask.
 */
export interface LidarMixedData {
    kind: 'mixed';
    centerLng: number;
    centerLat: number;
    radius: number;
    /** Ground-only triangulated surface. */
    mesh: LidarMeshData;
    /** All non-ground points with normals + colors, GPU-class-filterable. */
    shaded: LidarShadedCloudData;
}

const HEADER_BYTES = 24;
const LIDA_MAGIC = 0x4c494441;
const LIDM_MAGIC = 0x4c49444d;
const LIDS_MAGIC = 0x4c494453;

export class LidarCloudError extends Error {
    code: string;
    constructor(message: string, code = 'lidar_cloud_error') {
        super(message);
        this.code = code;
    }
}

/**
 * Fetch a LiDAR HD point cloud crop from the local service.
 */
export async function fetchLidarCloud(params: FetchLidarCloudParams): Promise<LidarCloudData> {
    const u = new URL('/api/lidar-cloud', globalThis.location.origin);
    u.searchParams.set('lng', String(params.lng));
    u.searchParams.set('lat', String(params.lat));
    u.searchParams.set('radius', String(Math.round(params.radius)));
    u.searchParams.set('stride', String(Math.max(1, Math.round(params.stride))));
    if (params.classes && params.classes.length > 0) {
        u.searchParams.set('class', params.classes.join(','));
    }

    let res: Response;
    try {
        res = await fetch(u.toString(), { signal: params.signal });
    } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        throw new LidarCloudError(
            "Impossible de joindre le service LiDAR HD local (lancez `npm run lidar`).",
            'service_unreachable',
        );
    }

    if (!res.ok) {
        let message = `Erreur ${res.status}`;
        let code = 'server_error';
        try {
            const body = await res.json();
            if (typeof body?.message === 'string') message = body.message;
            if (typeof body?.error === 'string') code = body.error;
        } catch { /* not json */ }
        throw new LidarCloudError(message, code);
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength < HEADER_BYTES) {
        throw new LidarCloudError('Réponse LiDAR HD vide ou tronquée.', 'bad_response');
    }
    const dv = new DataView(buf, 0, HEADER_BYTES);
    const magic = dv.getUint32(0, false);
    if (magic !== LIDA_MAGIC) {
        throw new LidarCloudError('Format de réponse LiDAR HD invalide.', 'bad_magic');
    }
    const pointCount = dv.getUint32(4, true);
    const centerLng = dv.getFloat64(8, true);
    const centerLat = dv.getFloat64(16, true);

    const posByteLen = pointCount * 3 * 4;
    const expectedLen = HEADER_BYTES + posByteLen + pointCount;
    if (buf.byteLength < expectedLen) {
        throw new LidarCloudError(
            `Charge utile incomplète (${buf.byteLength} < ${expectedLen}).`,
            'truncated',
        );
    }
    // Copy out of the response buffer into fresh typed arrays so the slice
    // backing them is aligned and independent of the response lifetime.
    const positions = new Float32Array(buf.slice(HEADER_BYTES, HEADER_BYTES + posByteLen));
    const classifications = new Uint8Array(
        buf.slice(HEADER_BYTES + posByteLen, HEADER_BYTES + posByteLen + pointCount),
    );

    return {
        centerLng,
        centerLat,
        positions,
        classifications,
        pointCount,
        radius: Math.round(Number(u.searchParams.get('radius') ?? '0')),
    };
}

/**
 * ASPRS LAS classification → RGB color lookup used to paint the point cloud.
 * Matches the conventions of the IGN LiDAR HD viewer.
 */
export const LAS_CLASS_COLORS: Record<number, [number, number, number]> = {
    0: [200, 200, 200],   // Created, never classified
    1: [200, 200, 200],   // Unclassified
    2: [120, 86, 56],     // Ground (sol) — brown
    3: [188, 220, 140],   // Low vegetation
    4: [128, 188, 100],   // Medium vegetation
    5: [60, 128, 60],     // High vegetation
    6: [200, 120, 110],   // Building
    7: [255, 80, 80],     // Low point (noise)
    9: [70, 140, 220],    // Water
    11: [120, 120, 120],  // Road surface
    17: [220, 160, 80],   // Bridge deck
    64: [180, 160, 200],  // Permanent above-ground (sursol pérenne)
    65: [255, 220, 120],  // Virtual point
    66: [220, 100, 200],  // Misc building (divers bâti)
};

export const LAS_CLASS_LABELS: Record<number, string> = {
    1: 'Non classé',
    2: 'Sol',
    3: 'Végétation basse',
    4: 'Végétation moyenne',
    5: 'Végétation haute',
    6: 'Bâtiment',
    9: 'Eau',
    17: 'Tablier de pont',
    64: 'Sursol pérenne',
    66: 'Divers bâti',
};

const DEFAULT_COLOR: [number, number, number] = [220, 220, 220];

export function colorForClass(c: number): [number, number, number] {
    return LAS_CLASS_COLORS[c] ?? DEFAULT_COLOR;
}

/**
 * Fetch a slope-shaded triangulated mesh of the LiDAR HD points around
 * the given center. Default class filter = ground only (2).
 */
export async function fetchLidarMesh(params: FetchLidarMeshParams): Promise<LidarMeshData> {
    const u = new URL('/api/lidar-cloud', globalThis.location.origin);
    u.searchParams.set('mode', 'mesh');
    u.searchParams.set('lng', String(params.lng));
    u.searchParams.set('lat', String(params.lat));
    u.searchParams.set('radius', String(Math.round(params.radius)));
    u.searchParams.set('stride', String(Math.max(1, Math.round(params.stride))));
    const classes = params.classes ?? [2];
    if (classes.length > 0) u.searchParams.set('class', classes.join(','));

    let res: Response;
    try {
        res = await fetch(u.toString(), { signal: params.signal });
    } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        throw new LidarCloudError(
            "Impossible de joindre le service LiDAR HD local (lancez `npm run lidar`).",
            'service_unreachable',
        );
    }
    if (!res.ok) {
        let message = `Erreur ${res.status}`;
        let code = 'server_error';
        try {
            const body = await res.json();
            if (typeof body?.message === 'string') message = body.message;
            if (typeof body?.error === 'string') code = body.error;
        } catch { /* not json */ }
        throw new LidarCloudError(message, code);
    }
    const buf = await res.arrayBuffer();
    const MESH_HEADER_BYTES = 28;
    if (buf.byteLength < MESH_HEADER_BYTES) {
        throw new LidarCloudError('Réponse LiDAR HD vide ou tronquée.', 'bad_response');
    }
    const dv = new DataView(buf, 0, MESH_HEADER_BYTES);
    const magic = dv.getUint32(0, false);
    if (magic !== LIDM_MAGIC) {
        throw new LidarCloudError('Format de mesh LiDAR HD invalide.', 'bad_magic');
    }
    const vertexCount = dv.getUint32(4, true);
    const triangleCount = dv.getUint32(8, true);
    const centerLng = dv.getFloat64(12, true);
    const centerLat = dv.getFloat64(20, true);

    const posByteLen = vertexCount * 3 * 4;
    const nrmByteLen = vertexCount * 3 * 4;
    const colByteLen = vertexCount * 4;
    const idxByteLen = triangleCount * 3 * 4;
    const expectedLen = MESH_HEADER_BYTES + posByteLen + nrmByteLen + colByteLen + idxByteLen;
    if (buf.byteLength < expectedLen) {
        throw new LidarCloudError(
            `Mesh incomplet (${buf.byteLength} < ${expectedLen}).`,
            'truncated',
        );
    }
    let o = MESH_HEADER_BYTES;
    const positions = new Float32Array(buf.slice(o, o + posByteLen)); o += posByteLen;
    const normals = new Float32Array(buf.slice(o, o + nrmByteLen)); o += nrmByteLen;
    const colors = new Uint8Array(buf.slice(o, o + colByteLen)); o += colByteLen;
    const indices = new Uint32Array(buf.slice(o, o + idxByteLen));

    return {
        kind: 'mesh',
        centerLng,
        centerLat,
        positions,
        normals,
        colors,
        indices,
        vertexCount,
        triangleCount,
        radius: Math.round(Number(u.searchParams.get('radius') ?? '0')),
    };
}

/**
 * Fetch a shaded LiDAR HD point cloud: positions + per-point normals
 * (k-NN PCA, computed server-side) + slope-based RGBA. Render with
 * `PointCloudLayer` + `LightingEffect` for a CloudCompare-style look that
 * handles cliffs and overhangs natively (each point is independent).
 */
export async function fetchLidarShaded(params: FetchLidarCloudParams): Promise<LidarShadedCloudData> {
    const u = new URL('/api/lidar-cloud', globalThis.location.origin);
    u.searchParams.set('mode', 'shaded');
    u.searchParams.set('lng', String(params.lng));
    u.searchParams.set('lat', String(params.lat));
    u.searchParams.set('radius', String(Math.round(params.radius)));
    u.searchParams.set('stride', String(Math.max(1, Math.round(params.stride))));
    if (params.classes && params.classes.length > 0) {
        u.searchParams.set('class', params.classes.join(','));
    }

    let res: Response;
    try {
        res = await fetch(u.toString(), { signal: params.signal });
    } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        throw new LidarCloudError(
            "Impossible de joindre le service LiDAR HD local (lancez `npm run lidar`).",
            'service_unreachable',
        );
    }
    if (!res.ok) {
        let message = `Erreur ${res.status}`;
        let code = 'server_error';
        try {
            const body = await res.json();
            if (typeof body?.message === 'string') message = body.message;
            if (typeof body?.error === 'string') code = body.error;
        } catch { /* not json */ }
        throw new LidarCloudError(message, code);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < HEADER_BYTES) {
        throw new LidarCloudError('Réponse LiDAR HD vide ou tronquée.', 'bad_response');
    }
    const dv = new DataView(buf, 0, HEADER_BYTES);
    const magic = dv.getUint32(0, false);
    if (magic !== LIDS_MAGIC) {
        throw new LidarCloudError('Format de nuage ombré invalide.', 'bad_magic');
    }
    const pointCount = dv.getUint32(4, true);
    const centerLng = dv.getFloat64(8, true);
    const centerLat = dv.getFloat64(16, true);

    const posByteLen = pointCount * 3 * 4;
    const nrmByteLen = pointCount * 3 * 4;
    const colByteLen = pointCount * 4;
    const clsByteLen = pointCount;
    const expectedLen = HEADER_BYTES + posByteLen + nrmByteLen + colByteLen + clsByteLen;
    if (buf.byteLength < expectedLen) {
        throw new LidarCloudError(
            `Nuage ombré incomplet (${buf.byteLength} < ${expectedLen}).`,
            'truncated',
        );
    }
    let o = HEADER_BYTES;
    const positions = new Float32Array(buf.slice(o, o + posByteLen)); o += posByteLen;
    const normals = new Float32Array(buf.slice(o, o + nrmByteLen)); o += nrmByteLen;
    const colors = new Uint8Array(buf.slice(o, o + colByteLen)); o += colByteLen;
    const classifications = new Uint8Array(buf.slice(o, o + clsByteLen));

    return {
        kind: 'shaded',
        centerLng,
        centerLat,
        positions,
        normals,
        colors,
        classifications,
        pointCount,
        radius: Math.round(Number(u.searchParams.get('radius') ?? '0')),
    };
}
