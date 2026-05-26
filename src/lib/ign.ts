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
        // Verified against the public SCAN25TOUR WMTS: z17/z18 can return 404
        // in mountain areas, while z16 is available. Higher map zooms overzoom
        // this parent tile through the composite protocol.
        maxZoom: 18,
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
    contourLines: {
        id: 'ELEVATION.CONTOUR.LINE',
        format: 'image/png' as const,
        minZoom: 0,
        maxZoom: 18,
        label: 'Courbes de niveau',
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
 * IGN TerrainRGB DEM (public WMS-r).
 * MapLibre's `raster-dem` source supports `{bbox-epsg-3857}` placeholders.
 */
export const IGN_TERRAIN_RGB_LAYER =
    'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export function ignTerrainRgbUrl(): string {
    const params = [
        'bbox={bbox-epsg-3857}',
        'format=image/png',
        'service=WMS',
        'version=1.3.0',
        'request=GetMap',
        'crs=EPSG:3857',
        'width=256',
        'height=256',
        'styles=terrainrgb',
        `layers=${encodeURIComponent(IGN_TERRAIN_RGB_LAYER)}`,
    ].join('&');
    return `${IGN_WMS_R_PUBLIC}?${params}`;
}

/** IGN attribution text required by the Geoplateforme terms of use. */
export const IGN_ATTRIBUTION =
    '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> — Géoplateforme';
