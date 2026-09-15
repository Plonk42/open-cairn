/**
 * The app's basemaps, declared once.
 *
 * Every other basemap table derives from this object — the `BaseLayerId` union,
 * the picker order, the labels and hover hints, the tile source feeding the
 * `composite://` protocol, the drape picker of the LiDAR studio and the set of
 * layers needing an IGN key. Adding a basemap means adding one entry here.
 */

import type { CompositeBaseKey } from './compositeProtocol';
import { IGN_LAYERS } from './ign';

interface BaseLayerDef {
    /** Tile source, or `null` when it depends on another setting (LiDAR hillshade). */
    source: CompositeBaseKey | null;
    label: string;
    /** Shorter label, for the narrow drape picker of the LiDAR studio. */
    shortLabel: string;
    /** Hover hint describing what the layer is. */
    description: string;
}

/** Declaration order drives the pickers. */
export const BASE_LAYERS = {
    scan25: {
        source: 'scan25Tour',
        label: IGN_LAYERS.scan25Tour.label,
        shortLabel: 'SCAN 25',
        description: 'Carte topographique IGN au 1:25 000 — la référence en montagne',
    },
    plan: {
        source: 'planIgn',
        label: IGN_LAYERS.planIgn.label,
        shortLabel: 'Plan',
        description: 'Plan IGN v2 — cartographie générale, lisible à tous les zooms',
    },
    planhd: {
        source: 'planIgnHd',
        label: IGN_LAYERS.planIgnHd.label,
        shortLabel: 'Plan HD',
        description: 'Le Plan IGN redessiné à partir du LiDAR HD — très détaillé, sans toponymes',
    },
    ortho: {
        source: 'ortho',
        label: IGN_LAYERS.ortho.label,
        shortLabel: 'Photo',
        description: 'Orthophotos IGN (BD ORTHO) — imagerie aérienne',
    },
    cosia: {
        source: 'cosia',
        label: IGN_LAYERS.cosia.label,
        shortLabel: 'CoSIA',
        description: 'Couverture du sol prédite par IA depuis la BD ORTHO — 15 classes (sol nu, neige, pelouse, conifère…)',
    },
    osm: {
        source: 'osm',
        label: 'OpenStreetMap',
        shortLabel: 'OSM',
        description: 'OpenStreetMap — sentiers, refuges et points d’eau détaillés',
    },
    lidar: {
        source: null,
        label: 'LiDAR',
        shortLabel: 'LiDAR',
        description: 'Ombrage du relief calculé depuis le LiDAR HD, sans carte ni photo',
    },
} as const satisfies Record<string, BaseLayerDef>;

export type BaseLayerId = keyof typeof BASE_LAYERS;

export const BASE_LAYER_IDS = Object.keys(BASE_LAYERS) as BaseLayerId[];

/**
 * Basemaps that can be draped as a texture over the LiDAR mesh/points (see
 * `fetchDrapeMosaic`) — exactly those with a fixed tile source. The LiDAR
 * hillshade is excluded: it is already a relief rendering, draping it over 3D
 * relief would be meaningless.
 */
export type DrapeSource = {
    [K in BaseLayerId]: (typeof BASE_LAYERS)[K]['source'] extends null ? never : K
}[BaseLayerId];

export const DRAPE_SOURCES = BASE_LAYER_IDS.filter(
    (id): id is DrapeSource => BASE_LAYERS[id].source !== null,
);

/** Shown when a basemap served by the private IGN endpoint is picked without a key. */
export const IGN_KEY_REQUIRED_HINT = 'Nécessite une clé IGN (voir Réglages)';

export function requiresIgnKey(id: BaseLayerId): boolean {
    const source = BASE_LAYERS[id].source;
    return source !== null && source !== 'osm' && IGN_LAYERS[source].private;
}
