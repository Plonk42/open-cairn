/**
 * IGN Géoplateforme endpoints and layer identifiers.
 *
 * Two endpoints are used:
 *  - public WMTS (`/wmts`) for layers in the "découverte" tier (Plan IGN,
 *    Orthophotos, LiDAR HD shadow, …) — anonymous.
 *  - private WMTS (`/private/wmts`) for SCAN 25 Tour, gated by an `apikey`
 *    parameter. The `ign_scan_ws` key used here is the public web-services
 *    key advertised on cartes.gouv.fr / geoportail.gouv.fr for SCAN access.
 *  - private WMS-r (`/private/wms-r/wms`) for the high-resolution TerrainRGB
 *    DEM (`Geoportail_App` key, used by the official `cartes-ign-app`).
 *
 * Docs:
 *   https://cartes.gouv.fr/aide/fr/guides-developpeur/
 *   https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/
 */

export const IGN_WMTS_PUBLIC = 'https://data.geopf.fr/wmts';
export const IGN_WMTS_PRIVATE = 'https://data.geopf.fr/private/wmts';
export const IGN_WMS_R_PRIVATE = 'https://data.geopf.fr/private/wms-r/wms';

/** Public web-services apikey for the SCAN family of layers. */
export const IGN_SCAN_APIKEY = 'ign_scan_ws';
/** Public web-services apikey for the high-res TerrainRGB DEM (wms-r). */
export const IGN_DEM_APIKEY = 'Geoportail_App';

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
    maxZoom: 16,
    label: 'SCAN 25 Tour',
    private: true,
    apikey: IGN_SCAN_APIKEY,
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
export function ignLayerUrl(layer: keyof typeof IGN_LAYERS): string {
  const def = IGN_LAYERS[layer];
  return ignWmtsUrl({
    layer: def.id,
    format: def.format,
    private: def.private,
    apikey: 'apikey' in def ? def.apikey : undefined,
  });
}

/**
 * IGN TerrainRGB DEM. Served as a WMS-r raster (private endpoint, requires the
 * `Geoportail_App` apikey, same as cartes-ign-app). MapLibre's `raster-dem`
 * source supports `{bbox-epsg-3857}` placeholders for WMS sources.
 */
export const IGN_TERRAIN_RGB_LAYER =
  'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.LINEAR';

export function ignTerrainRgbUrl(): string {
  const params = [
    `apikey=${encodeURIComponent(IGN_DEM_APIKEY)}`,
    'bbox={bbox-epsg-3857}',
    'format=image/png',
    'service=WMS',
    'version=1.3.0',
    'request=GetMap',
    'crs=EPSG:3857',
    'width=256',
    'height=256',
    'styles=terrainrgb0',
    `layers=${encodeURIComponent(IGN_TERRAIN_RGB_LAYER)}`,
  ].join('&');
  return `${IGN_WMS_R_PRIVATE}?${params}`;
}

/** IGN attribution text required by the Geoplateforme terms of use. */
export const IGN_ATTRIBUTION =
  '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> — Géoplateforme';
