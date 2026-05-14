/**
 * IGN Géoplateforme endpoints and layer identifiers.
 * All "discovery" layers are anonymous (no API key required).
 *
 * Docs:
 *   https://cartes.gouv.fr/aide/fr/guides-developpeur/
 *   https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/
 */

export const IGN_WMTS_BASE = 'https://data.geopf.fr/wmts';

/**
 * Build a WMTS GetTile URL template (placeholders {z}/{x}/{y}) for a layer.
 */
export function ignWmtsUrl(opts: {
  layer: string;
  format: 'image/png' | 'image/jpeg';
  style?: string;
  tilematrixset?: string;
}): string {
  const style = opts.style ?? 'normal';
  const tms = opts.tilematrixset ?? 'PM';
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: opts.layer,
    STYLE: style,
    TILEMATRIXSET: tms,
    TILEMATRIX: '{z}',
    TILECOL: '{x}',
    TILEROW: '{y}',
    FORMAT: opts.format,
  });
  return `${IGN_WMTS_BASE}?${params.toString()}`;
}

export const IGN_LAYERS = {
  scan25Tour: {
    id: 'GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR',
    format: 'image/jpeg' as const,
    minZoom: 6,
    maxZoom: 16,
    label: 'SCAN 25 Tour',
  },
  planIgn: {
    id: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
    format: 'image/png' as const,
    minZoom: 0,
    maxZoom: 19,
    label: 'Plan IGN',
  },
  ortho: {
    id: 'ORTHOIMAGERY.ORTHOPHOTOS',
    format: 'image/jpeg' as const,
    minZoom: 0,
    maxZoom: 19,
    label: 'Orthophotos',
  },
  lidarMnsShadow: {
    id: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    format: 'image/png' as const,
    minZoom: 0,
    maxZoom: 18,
    label: 'Ombrage LiDAR HD (MNS)',
  },
  lidarMntShadow: {
    id: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    format: 'image/png' as const,
    minZoom: 0,
    maxZoom: 18,
    label: 'Ombrage LiDAR HD (MNT)',
  },
  elevationShadow: {
    id: 'IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    format: 'image/png' as const,
    minZoom: 0,
    maxZoom: 17,
    label: 'Ombrage IGN (national)',
  },
} as const;

/**
 * IGN TerrainRGB DEM is exposed via the public WMTS endpoint as
 * `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` with style `normal` and PNG tiles.
 * MapLibre `raster-dem` source decodes Mapbox-style RGB DEM natively.
 */
export const IGN_TERRAIN_RGB_LAYER =
  'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';

export function ignTerrainRgbUrl(): string {
  return ignWmtsUrl({
    layer: IGN_TERRAIN_RGB_LAYER,
    format: 'image/png',
  });
}

/** IGN attribution text required by the Geoplateforme terms of use. */
export const IGN_ATTRIBUTION =
  '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> — Géoplateforme';
