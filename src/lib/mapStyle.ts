import type { RenderQuality, TerrainDemSource } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { compositeTileUrl, type BlendMode, type CompositeBaseKey, type ShadowKind } from './compositeProtocol';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignLayerUrl, ignTerrainRgbUrl, OSM_ATTRIBUTION, OSM_TILE_URL } from './ign';

/**
 * Mapterhorn global terrain tiles, used as the DEM for contour lines.
 *
 * Mapterhorn exposes a standard Web Mercator XYZ endpoint of Terrarium-encoded
 * WebP tiles (512 px), so `maplibre-contour` can consume it directly — no
 * custom tile manager or `{bbox}` translation needed. Coverage is global 30 m,
 * with France down to ~5 m country-wide (1 m in places). Licensed BSD-3.
 *
 * @see https://mapterhorn.com/data-access
 */
const MAPTERHORN_DEM_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const MAPTERHORN_ATTRIBUTION = '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>';

/**
 * Singleton `maplibre-contour` DEM source. It registers MapLibre protocols
 * (one shared raster-dem cache, one dynamic contour vector tiler) that compute
 * contour lines on the fly from the Mapterhorn DEM. Because the source is a
 * plain XYZ endpoint, contour computation runs in a web worker (`worker: true`)
 * via `dem.setupMaplibre`. The protocols are global and persist across
 * `setStyle` calls, so the source is created once.
 */
let contourDemSource: InstanceType<typeof mlcontour.DemSource> | null = null;

const CONTOUR_DEM_MAXZOOM = 14;

function getContourDemSource(): InstanceType<typeof mlcontour.DemSource> {
    if (!contourDemSource) {
        const dem = new mlcontour.DemSource({
            url: MAPTERHORN_DEM_URL,
            encoding: 'terrarium',
            maxzoom: CONTOUR_DEM_MAXZOOM,
            worker: true,
        });
        dem.setupMaplibre(maplibregl);
        contourDemSource = dem;
    }
    return contourDemSource;
}

export type BaseLayerId = 'scan25' | 'plan' | 'ortho' | 'osm' | 'lidar';

const BASE_DEFS = {
    scan25: IGN_LAYERS.scan25Tour,
    plan: IGN_LAYERS.planIgn,
    ortho: IGN_LAYERS.ortho,
    osm: { label: 'OpenStreetMap' },
    lidar: { label: 'LiDAR' },
} as const;

const TERRAIN_TILE_SIZE = 256;

/**
 * Build the `terrain` raster-dem source for the chosen DEM provider.
 *
 * `auto` resolves to IGN when a DEM API key is supplied, otherwise to
 * Mapterhorn — so users without an IGN key still get a working 3D mesh from
 * the same DEM that feeds the contour lines. IGN uses Mapbox-style `custom`
 * encoding; Mapterhorn uses `terrarium`.
 */
function resolveTerrainSource(
    source: TerrainDemSource,
    ignDemApiKey?: string,
): maplibregl.RasterDEMSourceSpecification {
    const useMapterhorn = source === 'mapterhorn' || (source === 'auto' && !ignDemApiKey);
    if (useMapterhorn) {
        return {
            type: 'raster-dem',
            tiles: [MAPTERHORN_DEM_URL],
            tileSize: 512,
            minzoom: 0,
            maxzoom: CONTOUR_DEM_MAXZOOM,
            encoding: 'terrarium',
            attribution: MAPTERHORN_ATTRIBUTION,
        };
    }
    return {
        type: 'raster-dem',
        tiles: [ignTerrainRgbUrl(ignDemApiKey)],
        tileSize: TERRAIN_TILE_SIZE,
        minzoom: 6,
        maxzoom: 14,
        encoding: 'custom',
        redFactor: 6553.6,
        greenFactor: 25.6,
        blueFactor: 0.1,
        baseShift: 10000,
        attribution: IGN_ATTRIBUTION,
    };
}

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

export function directBaseUrl(key: CompositeBaseKey, scanApiKey?: string): string {
    if (key === 'osm') return OSM_TILE_URL;
    return ignLayerUrl(key, IGN_LAYERS[key].private ? scanApiKey : undefined);
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
        tileUrl: directBaseUrl(key, opts.ignScanApiKey),
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
    /**
     * Add a dynamic, sun-driven MapLibre `hillshade` layer over the base,
     * shaded from the terrain DEM. Illumination is updated imperatively from
     * the selected sun date (see MapContainer).
     */
    sunHillshade: boolean;
    /** Enable MapLibre terrain in the style. */
    terrain: boolean;
    /** Vertical exaggeration for MapLibre terrain. */
    terrainExaggeration: number;
    /** Raster detail/performance profile for pitched 3D views. */
    renderQuality: RenderQuality;
    /** Enable transparent contour lines overlay. */
    contourLines: boolean;
    /** Opacity of the contour lines overlay (0..1). */
    contourLinesOpacity: number;
    /** IGN API key for SCAN 25 (private WMTS). */
    ignScanApiKey?: string;
    /** IGN API key for terrain DEM (private WMS-r, enables HIGHRES.LINEAR). */
    ignDemApiKey?: string;
    /** DEM provider for the 3D terrain mesh and sun hillshade. */
    terrainDemSource: TerrainDemSource;
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
            terrain: resolveTerrainSource(opts.terrainDemSource, opts.ignDemApiKey),
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

    if (opts.sunHillshade) {
        // Dynamic relief shading from the terrain DEM, drawn over the base.
        // Illumination direction/altitude/colour are set imperatively from the
        // selected sun date in MapContainer; these are just sane initial values.
        style.layers.push({
            id: 'sun-hillshade',
            type: 'hillshade',
            source: 'terrain',
            paint: {
                'hillshade-illumination-anchor': 'map',
                'hillshade-illumination-direction': 335,
                'hillshade-illumination-altitude': 45,
                'hillshade-exaggeration': 0.5,
            },
        });
    }

    if (opts.contourLines) {
        const dem = getContourDemSource();
        style.sources['contour-lines'] = {
            type: 'vector',
            tiles: [
                dem.contourProtocolUrl({
                    // zoom: [minor interval (m), major interval (m)]
                    thresholds: {
                        10: [200, 1000],
                        11: [100, 500],
                        12: [100, 500],
                        13: [50, 250],
                        14: [25, 125],
                        15: [10, 50],
                        16: [10, 50],
                    },
                    elevationKey: 'ele',
                    levelKey: 'level',
                    contourLayer: 'contours',
                    overzoom: 1,
                }),
            ],
            maxzoom: 16,
            attribution: MAPTERHORN_ATTRIBUTION,
        };
        style.layers.push(
            {
                id: 'contour-lines',
                type: 'line',
                source: 'contour-lines',
                'source-layer': 'contours',
                layout: {
                    'line-join': 'round',
                },
                paint: {
                    'line-color': '#8a5a2b',
                    'line-opacity': opts.contourLinesOpacity,
                    // "major" contours have level=1, "minor" have level=0
                    'line-width': ['match', ['get', 'level'], 1, 1.2, 0.6],
                },
            },
            {
                id: 'contour-labels',
                type: 'symbol',
                source: 'contour-lines',
                'source-layer': 'contours',
                filter: ['>', ['get', 'level'], 0],
                paint: {
                    'text-color': '#5a3a1a',
                    'text-halo-color': 'rgba(255, 255, 255, 0.9)',
                    'text-halo-width': 1,
                    'text-opacity': opts.contourLinesOpacity,
                },
                layout: {
                    'symbol-placement': 'line',
                    'text-size': 10,
                    'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
                    'text-font': ['Noto Sans Bold'],
                },
            },
        );
    }

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
