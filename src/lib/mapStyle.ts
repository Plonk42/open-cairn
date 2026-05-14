import maplibregl from 'maplibre-gl';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignTerrainRgbUrl, ignWmtsUrl } from './ign';

export type BaseLayerId = 'scan25' | 'plan' | 'ortho';

const BASE_DEFS = {
  scan25: IGN_LAYERS.scan25Tour,
  plan: IGN_LAYERS.planIgn,
  ortho: IGN_LAYERS.ortho,
} as const;

const TILE_SIZE = 256;

function rasterSource(layer: keyof typeof IGN_LAYERS): maplibregl.RasterSourceSpecification {
  const def = IGN_LAYERS[layer];
  return {
    type: 'raster',
    tiles: [ignWmtsUrl({ layer: def.id, format: def.format })],
    tileSize: TILE_SIZE,
    minzoom: def.minZoom,
    maxzoom: def.maxZoom,
    attribution: IGN_ATTRIBUTION,
  };
}

/**
 * Build a MapLibre style with a base raster, the LiDAR HD shadow as a regular
 * raster source (the `MultiplyBlendLayer` will sample it via WebGL), and a
 * raster-dem source for the 3D terrain.
 */
export function buildMapStyle(base: BaseLayerId): maplibregl.StyleSpecification {
  const baseDef = BASE_DEFS[base];

  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      base: {
        type: 'raster',
        tiles: [ignWmtsUrl({ layer: baseDef.id, format: baseDef.format })],
        tileSize: TILE_SIZE,
        minzoom: baseDef.minZoom,
        maxzoom: baseDef.maxZoom,
        attribution: IGN_ATTRIBUTION,
      },
      'lidar-shadow': rasterSource('lidarMnsShadow'),
      terrain: {
        type: 'raster-dem',
        tiles: [ignTerrainRgbUrl()],
        tileSize: TILE_SIZE,
        minzoom: 0,
        maxzoom: 14,
        encoding: 'mapbox',
        attribution: IGN_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b1220' },
      },
      {
        id: 'base',
        type: 'raster',
        source: 'base',
        paint: {
          'raster-resampling': 'linear',
        },
      },
      // The multiply-blended LiDAR shadow is added imperatively by
      // `MultiplyBlendLayer.attach()` once the map style is loaded.
    ],
    sky: {
      'sky-color': '#1e293b',
      'horizon-color': '#94a3b8',
      'fog-color': '#0b1220',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.4,
      'sky-horizon-blend': 0.5,
      'atmosphere-blend': 0.6,
    },
  };
}

export const BASE_LAYER_LABELS: Record<BaseLayerId, string> = {
  scan25: BASE_DEFS.scan25.label,
  plan: BASE_DEFS.plan.label,
  ortho: BASE_DEFS.ortho.label,
};
