import type { RenderQuality } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import { compositeTileUrl, type BlendMode, type CompositeBaseKey, type ShadowKind } from './compositeProtocol';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignLayerUrl, ignTerrainRgbUrl, OSM_ATTRIBUTION, OSM_TILE_URL } from './ign';

export type BaseLayerId = 'scan25' | 'plan' | 'ortho' | 'osm' | 'lidar';

const BASE_DEFS = {
    scan25: IGN_LAYERS.scan25Tour,
    plan: IGN_LAYERS.planIgn,
    ortho: IGN_LAYERS.ortho,
    osm: { label: 'OpenStreetMap' },
    lidar: { label: 'LiDAR' },
} as const;

const TERRAIN_TILE_SIZE = 256;

const BASE_KEY: Record<Exclude<BaseLayerId, 'lidar'>, CompositeBaseKey> = {
    scan25: 'scan25Tour',
    plan: 'planIgn',
    ortho: 'ortho',
    osm: 'osm',
};

const LIDAR_SOURCE_KEY: Record<ShadowKind, keyof typeof IGN_LAYERS> = {
    mns: 'lidarMnsShadow',
    mnt: 'lidarMntShadow',
    mnh: 'lidarMnhShadow',
};

interface ResolvedBaseLayer {
    key: CompositeBaseKey;
    minZoom: number;
    maxZoom: number;
    tileUrl: string;
    attribution: string;
}

function directBaseUrl(key: CompositeBaseKey): string {
    if (key === 'osm') return OSM_TILE_URL;
    return ignLayerUrl(key);
}

function resolveBaseLayer(opts: MapStyleOptions): ResolvedBaseLayer {
    const key = opts.base === 'lidar'
        ? LIDAR_SOURCE_KEY[opts.hillshadeSource]
        : BASE_KEY[opts.base];
    const isOsm = key === 'osm';
    const def = isOsm ? { minZoom: 0, maxZoom: 19 } : IGN_LAYERS[key];

    return {
        key,
        minZoom: def.minZoom,
        maxZoom: def.maxZoom,
        tileUrl: directBaseUrl(key),
        attribution: isOsm ? OSM_ATTRIBUTION : IGN_ATTRIBUTION,
    };
}

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
    /** Enable MapLibre terrain in the style. */
    terrain: boolean;
    /** Vertical exaggeration for MapLibre terrain. */
    terrainExaggeration: number;
    /** Raster detail/performance profile for pitched 3D views. */
    renderQuality: RenderQuality;
}

/**
 * Build a MapLibre style. The base raster is either fetched directly from IGN
 * or — when hillshade is enabled — composited with the LiDAR HD shadow via
 * the custom `composite://` protocol so MapLibre can drape the result onto
 * the 3D terrain natively.
 */
export function buildMapStyle(opts: MapStyleOptions): maplibregl.StyleSpecification {
    const isLidarBase = opts.base === 'lidar';
    const base = resolveBaseLayer(opts);
    const baseTileSize = opts.renderQuality === 'sharp' ? 128 : 256;
    const lidarDetailScale = opts.renderQuality === 'sharp' ? 2 : 1;
    let baseTileUrl = base.tileUrl;
    if (opts.hillshade && !isLidarBase) {
        baseTileUrl = compositeTileUrl(
            base.key,
            opts.hillshadeSource,
            opts.hillshadeBlend,
            opts.hillshadeIntensity,
            lidarDetailScale,
        );
    }

    const style: maplibregl.StyleSpecification = {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
            base: {
                type: 'raster',
                tiles: [baseTileUrl],
                tileSize: baseTileSize,
                minzoom: base.minZoom,
                maxzoom: base.maxZoom,
                attribution: base.attribution,
            },
            terrain: {
                type: 'raster-dem',
                tiles: [ignTerrainRgbUrl()],
                tileSize: TERRAIN_TILE_SIZE,
                minzoom: 6,
                maxzoom: 14,
                encoding: 'custom',
                redFactor: 6553.6,
                greenFactor: 25.6,
                blueFactor: 0.1,
                baseShift: 0,
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

    if (opts.terrain) {
        style.terrain = {
            source: 'terrain',
            exaggeration: opts.terrainExaggeration,
        };
    }

    return style;
}

export const BASE_LAYER_LABELS: Record<BaseLayerId, string> = {
    scan25: BASE_DEFS.scan25.label,
    plan: BASE_DEFS.plan.label,
    ortho: BASE_DEFS.ortho.label,
    osm: BASE_DEFS.osm.label,
    lidar: BASE_DEFS.lidar.label,
};
