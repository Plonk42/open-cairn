/**
 * IGN Géoplateforme endpoints and layer identifiers.
 *
 * Three endpoints are used:
 *  - public WMTS (`/wmts`) for layers in the "découverte" tier (Plan IGN,
 *    Orthophotos, LiDAR HD shadow, …).
 *  - private WMTS (`/private/wmts`) for SCAN 25 Tour, gated by an `apikey`
 *    parameter. Users must supply their own key (e.g. `ign_scan_ws` from
 *    cartes.gouv.fr / geoportail.gouv.fr for SCAN access).
 *  - public WMS-r (`/wms-r`) for the high-resolution TerrainRGB DEM.
 *
 * Docs:
 *   https://cartes.gouv.fr/aide/fr/guides-developpeur/
 *   https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/
 */

export const IGN_WMTS_PUBLIC = 'https://data.geopf.fr/wmts';
export const IGN_WMTS_PRIVATE = 'https://data.geopf.fr/private/wmts';
export const IGN_WMS_R_PUBLIC = 'https://data.geopf.fr/wms-r';
export const IGN_WMS_R_PRIVATE = 'https://data.geopf.fr/private/wms-r/wms';

/**
 * Build a WMTS GetTile URL template (placeholders {z}/{x}/{y}) for a layer.
 *
 * NOTE: we cannot use `URLSearchParams` here because it would percent-encode
 * the `{z}/{x}/{y}` placeholders, preventing MapLibre from substituting them.
 */
export function ignWmtsUrl(opts: {
    layer: string;
    format: 'image/png' | 'image/jpeg';
    style?: string;
    tilematrixset?: string;
    /** Use the private endpoint (requires `apikey`). */
    private?: boolean;
    apikey?: string;
}): string {
    const style = opts.style ?? 'normal';
    const tms = opts.tilematrixset ?? 'PM';
    const base = opts.private ? IGN_WMTS_PRIVATE : IGN_WMTS_PUBLIC;
    const params = [
        opts.apikey ? `apikey=${encodeURIComponent(opts.apikey)}` : null,
        'SERVICE=WMTS',
        'REQUEST=GetTile',
        'VERSION=1.0.0',
        `LAYER=${encodeURIComponent(opts.layer)}`,
        `STYLE=${encodeURIComponent(style)}`,
        `TILEMATRIXSET=${encodeURIComponent(tms)}`,
        'TILEMATRIX={z}',
        'TILECOL={x}',
        'TILEROW={y}',
        `FORMAT=${encodeURIComponent(opts.format)}`,
    ]
        .filter(Boolean)
        .join('&');
    return `${base}?${params}`;
}

export const IGN_LAYERS = {
    scan25Tour: {
        id: 'GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR',
        format: 'image/jpeg' as const,
        minZoom: 6,
        // Verified against the public SCAN25TOUR WMTS: z17/z18 return 404 in
        // mountain areas, while z16 is available everywhere. Cap the source at
        // z16 so MapLibre overzooms this parent tile for deeper map zooms
        // instead of requesting non-existent z17/z18 tiles (which flood the
        // console with 404s).
        maxZoom: 16,
        label: 'SCAN 25 Tour',
        private: true,
    },
    planIgn: {
        id: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 19,
        label: 'Plan IGN',
        private: false,
    },
    ortho: {
        id: 'ORTHOIMAGERY.ORTHOPHOTOS',
        format: 'image/jpeg' as const,
        minZoom: 0,
        maxZoom: 19,
        label: 'Orthophotos',
        private: false,
    },
    lidarMnsShadow: {
        id: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 18,
        label: 'Ombrage LiDAR HD (MNS)',
        private: false,
    },
    lidarMntShadow: {
        id: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 18,
        label: 'Ombrage LiDAR HD (MNT)',
        private: false,
    },
    lidarMnhShadow: {
        // MNH = Modèle Numérique de Hauteur (canopy / above-ground height).
        // Less commonly published than MNT/MNS; if IGN returns 404 the
        // composite protocol falls back to no shadow gracefully.
        id: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 18,
        label: 'Ombrage LiDAR HD (MNH)',
        private: false,
    },
    elevationShadow: {
        id: 'IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 17,
        label: 'Ombrage IGN (national)',
        private: false,
    },
} as const;

/** Build a WMTS URL for one of the registered IGN layers. */
export function ignLayerUrl(layer: keyof typeof IGN_LAYERS, apikey?: string): string {
    const def = IGN_LAYERS[layer];
    return ignWmtsUrl({
        layer: def.id,
        format: def.format,
        private: def.private,
        apikey: def.private ? apikey : undefined,
    });
}

/**
 * IGN TerrainRGB DEM.
 * When an API key is provided, use the private WMS-r endpoint with
 * HIGHRES.LINEAR (bilinear interpolation → smooth terrain).
 * Without a key, fall back to the public endpoint (nearest-neighbor).
 */
export const IGN_TERRAIN_RGB_LAYER =
    'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
export const IGN_TERRAIN_RGB_LAYER_LINEAR =
    'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.LINEAR';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export function ignTerrainRgbUrl(apikey?: string): string {
    const usePrivate = !!apikey;
    const layer = usePrivate ? IGN_TERRAIN_RGB_LAYER_LINEAR : IGN_TERRAIN_RGB_LAYER;
    const base = usePrivate ? IGN_WMS_R_PRIVATE : IGN_WMS_R_PUBLIC;
    const params = [
        apikey ? `apikey=${encodeURIComponent(apikey)}` : null,
        'bbox={bbox-epsg-3857}',
        'format=image/png',
        'service=WMS',
        'version=1.3.0',
        'request=GetMap',
        'crs=EPSG:3857',
        'width=256',
        'height=256',
        'styles=terrainrgb',
        `layers=${encodeURIComponent(layer)}`,
    ].filter(Boolean).join('&');
    return `${base}?${params}`;
}

/**
 * Static Plan IGN preview for an area, as a single WMS GetMap image.
 *
 * Used for thumbnails (e.g. saved-cloud previews): given a center + ground
 * radius (m), returns a PNG URL framing roughly that area with surrounding
 * context. The bbox is built in Web Mercator (EPSG:3857), so the ground radius
 * is scaled by 1/cos(lat).
 */
export function ignStaticMapUrl(opts: {
    centerLng: number;
    centerLat: number;
    /** Ground radius in meters. */
    radius: number;
    width?: number;
    height?: number;
}): string {
    const { centerLng, centerLat, radius } = opts;
    const width = opts.width ?? 480;
    const height = opts.height ?? 300;
    const R = 6378137;
    const mx = R * (centerLng * Math.PI) / 180;
    const my = R * Math.log(Math.tan(Math.PI / 4 + (centerLat * Math.PI) / 360));
    // Zoom out for surrounding context. Web Mercator units per ground meter ≈ 1/cos(lat).
    const half = (radius * 2.5) / Math.cos((centerLat * Math.PI) / 180);
    const aspect = width / height;
    const halfX = half * Math.max(1, aspect);
    const halfY = half * Math.max(1, 1 / aspect);
    const bbox = `${mx - halfX},${my - halfY},${mx + halfX},${my + halfY}`;
    const params = [
        'SERVICE=WMS',
        'VERSION=1.3.0',
        'REQUEST=GetMap',
        `LAYERS=${encodeURIComponent(IGN_LAYERS.planIgn.id)}`,
        'STYLES=',
        'CRS=EPSG:3857',
        `BBOX=${bbox}`,
        `WIDTH=${width}`,
        `HEIGHT=${height}`,
        'FORMAT=image/png',
    ].join('&');
    return `${IGN_WMS_R_PUBLIC}?${params}`;
}

/** IGN attribution text required by the Geoplateforme terms of use. */
export const IGN_ATTRIBUTION =
    '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';
