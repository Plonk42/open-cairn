import maplibregl from 'maplibre-gl';
import { compositeTileUrl, type BlendMode, type ShadowKind } from './compositeProtocol';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignLayerUrl, ignTerrainRgbUrl } from './ign';

export type BaseLayerId = 'scan25' | 'plan' | 'ortho';

const BASE_DEFS = {
    scan25: IGN_LAYERS.scan25Tour,
    plan: IGN_LAYERS.planIgn,
    ortho: IGN_LAYERS.ortho,
} as const;

const TILE_SIZE = 256;

const BASE_KEY: Record<BaseLayerId, keyof typeof IGN_LAYERS> = {
    scan25: 'scan25Tour',
    plan: 'planIgn',
    ortho: 'ortho',
};

export interface MapStyleOptions {
    base: BaseLayerId;
    /** When true, the base raster is replaced by `composite://` tiles that
     *  pre-blend the base with the LiDAR HD shadow. */
    hillshade: boolean;
    /** Which LiDAR HD product is used as the shadow source. */
    hillshadeSource: ShadowKind;
    /** Blend mode used when compositing shadow onto base. */
    hillshadeBlend: BlendMode;
    /** 0..1, only used when `hillshade` is true. */
    hillshadeIntensity: number;
}

/**
 * Build a MapLibre style. The base raster is either fetched directly from IGN
 * or — when hillshade is enabled — composited with the LiDAR HD shadow via
 * the custom `composite://` protocol so MapLibre can drape the result onto
 * the 3D terrain natively.
 */
export function buildMapStyle(opts: MapStyleOptions): maplibregl.StyleSpecification {
    const baseKey = BASE_KEY[opts.base];
    const baseDef = IGN_LAYERS[baseKey];
    const baseTileUrl = opts.hillshade
        ? compositeTileUrl(
            baseKey,
            opts.hillshadeSource,
            opts.hillshadeBlend,
            opts.hillshadeIntensity,
          )
        : ignLayerUrl(baseKey);

    return {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
            base: {
                type: 'raster',
                tiles: [baseTileUrl],
                tileSize: TILE_SIZE,
                minzoom: baseDef.minZoom,
                maxzoom: baseDef.maxZoom,
                attribution: IGN_ATTRIBUTION,
            },
            terrain: {
                type: 'raster-dem',
                tiles: [ignTerrainRgbUrl()],
                tileSize: TILE_SIZE,
                minzoom: 6,
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
