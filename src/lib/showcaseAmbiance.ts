/**
 * Single source of truth for mapping the LiDAR "ambiance" (render settings)
 * between the live store and a serialized {@link ShowcaseAmbiance}.
 *
 * Both directions are exhaustive by type: adding a field to `ShowcaseAmbiance`
 * forces updating `extractAmbiance` (object-literal return type) AND
 * `AMBIANCE_SETTERS` (mapped type over every key), so a render setting can no
 * longer be silently forgotten on export or restore.
 */
import type { ShowcaseAmbiance } from '@/lib/showcaseScene';
import { type MapState, useMapStore } from '@/stores/mapStore';

/** Snapshot the current ambiance from the live store state. */
export function extractAmbiance(st: MapState): ShowcaseAmbiance {
    return {
        lidarMode: st.lidarMode,
        lidarShader: st.lidarShader,
        lidarSnowLine: st.lidarSnowLine,
        lidarSnowAmount: st.lidarSnowAmount,
        lidarRockType: st.lidarRockType,
        lidarSunDate: st.lidarSunDate,
        lidarSunEnabled: st.lidarSunEnabled,
        lidarShadows: st.lidarShadows,
        lidarShadowStrength: st.lidarShadowStrength,
        lidarVegEnhance: st.lidarVegEnhance,
        lidarVegColorMode: st.lidarVegColorMode,
        lidarVegHeightScale: st.lidarVegHeightScale,
        lidarVegIntensity: st.lidarVegIntensity,
        lidarVegNormalShade: st.lidarVegNormalShade,
        lidarVegSizeBoost: st.lidarVegSizeBoost,
        lidarVegGroundGap: st.lidarVegGroundGap,
        lidarVegGroundRough: st.lidarVegGroundRough,
        lidarForestGrouping: st.lidarForestGrouping,
        lidarForestMixCellSize: st.lidarForestMixCellSize,
        lidarForestEdgeBlend: st.lidarForestEdgeBlend,
        lidarForestEdgeBandM: st.lidarForestEdgeBandM,
        lidarForestTreetopSensitivity: st.lidarForestTreetopSensitivity,
        lidarForestHiddenLegend: st.lidarForestHiddenLegend,
        lidarForestSpeciesFilterOn: st.lidarForestSpeciesFilterOn,
        lidarCloudEdl: st.lidarCloudEdl,
        lidarCloudEdlStrength: st.lidarCloudEdlStrength,
        lidarCloudEdlRadius: st.lidarCloudEdlRadius,
        lidarCloudEdlFarPlane: st.lidarCloudEdlFarPlane,
        lidarCloudPointSize: st.lidarCloudPointSize,
        lidarCloudSizeCompensation: st.lidarCloudSizeCompensation,
        lidarCloudOpacity: st.lidarCloudOpacity,
        lidarCloudPhotoOpacity: st.lidarCloudPhotoOpacity,
        lidarCloudPhotoOpacityNonGround: st.lidarCloudPhotoOpacityNonGround,
        lidarCloudPhotoSource: st.lidarCloudPhotoSource,
        lidarCloudBasemapOpacity: st.lidarCloudBasemapOpacity,
        lidarCloudClasses: st.lidarCloudClasses,
        contourLinesEnabled: st.contourLinesEnabled,
        contourLinesOpacity: st.contourLinesOpacity,
    };
}

/** Setter for each ambiance field — exhaustive by construction. */
const AMBIANCE_SETTERS: { [K in keyof ShowcaseAmbiance]: (s: MapState, v: ShowcaseAmbiance[K]) => void } = {
    lidarMode: (s, v) => s.setLidarMode(v),
    lidarShader: (s, v) => s.setLidarShader(v),
    lidarSnowLine: (s, v) => s.setLidarSnowLine(v),
    lidarSnowAmount: (s, v) => s.setLidarSnowAmount(v),
    lidarRockType: (s, v) => s.setLidarRockType(v),
    lidarSunDate: (s, v) => s.setLidarSunDate(v),
    lidarSunEnabled: (s, v) => s.setLidarSunEnabled(v),
    lidarShadows: (s, v) => s.setLidarShadows(v),
    lidarShadowStrength: (s, v) => s.setLidarShadowStrength(v),
    lidarVegEnhance: (s, v) => s.setLidarVegEnhance(v),
    lidarVegColorMode: (s, v) => s.setLidarVegColorMode(v),
    lidarVegHeightScale: (s, v) => s.setLidarVegHeightScale(v),
    lidarVegIntensity: (s, v) => s.setLidarVegIntensity(v),
    lidarVegNormalShade: (s, v) => s.setLidarVegNormalShade(v),
    lidarVegSizeBoost: (s, v) => s.setLidarVegSizeBoost(v),
    lidarVegGroundGap: (s, v) => s.setLidarVegGroundGap(v),
    lidarVegGroundRough: (s, v) => s.setLidarVegGroundRough(v),
    lidarForestGrouping: (s, v) => s.setLidarForestGrouping(v),
    lidarForestMixCellSize: (s, v) => s.setLidarForestMixCellSize(v),
    lidarForestEdgeBlend: (s, v) => s.setLidarForestEdgeBlend(v),
    lidarForestEdgeBandM: (s, v) => s.setLidarForestEdgeBandM(v),
    lidarForestTreetopSensitivity: (s, v) => s.setLidarForestTreetopSensitivity(v),
    lidarForestHiddenLegend: (s, v) => s.setLidarForestHiddenLegend(v),
    lidarForestSpeciesFilterOn: (s, v) => s.setLidarForestSpeciesFilterOn(v),
    lidarCloudEdl: (s, v) => s.setLidarCloudEdl(v),
    lidarCloudEdlStrength: (s, v) => s.setLidarCloudEdlStrength(v),
    lidarCloudEdlRadius: (s, v) => s.setLidarCloudEdlRadius(v),
    lidarCloudEdlFarPlane: (s, v) => s.setLidarCloudEdlFarPlane(v),
    lidarCloudPointSize: (s, v) => s.setLidarCloudPointSize(v),
    lidarCloudSizeCompensation: (s, v) => s.setLidarCloudSizeCompensation(v),
    lidarCloudOpacity: (s, v) => s.setLidarCloudOpacity(v),
    lidarCloudPhotoOpacity: (s, v) => s.setLidarCloudPhotoOpacity(v),
    lidarCloudPhotoOpacityNonGround: (s, v) => s.setLidarCloudPhotoOpacityNonGround(v),
    lidarCloudPhotoSource: (s, v) => s.setLidarCloudPhotoSource(v),
    lidarCloudBasemapOpacity: (s, v) => s.setLidarCloudBasemapOpacity(v),
    lidarCloudClasses: (s, v) => s.setLidarCloudClasses(v),
    contourLinesEnabled: (s, v) => s.setContourLinesEnabled(v),
    contourLinesOpacity: (s, v) => s.setContourLinesOpacity(v),
};

function applyOne<K extends keyof ShowcaseAmbiance>(st: MapState, a: ShowcaseAmbiance, key: K): void {
    AMBIANCE_SETTERS[key](st, a[key]);
}

/** `lidarMode` décide de ce que fera la prochaine capture, pas de l'aspect des nuages déjà chargés. */
const NOT_STYLE: ReadonlySet<keyof ShowcaseAmbiance> = new Set(['lidarMode']);

function applyKeys(a: ShowcaseAmbiance, skip?: ReadonlySet<keyof ShowcaseAmbiance>): void {
    const st = useMapStore.getState();
    for (const key of Object.keys(AMBIANCE_SETTERS) as (keyof ShowcaseAmbiance)[]) {
        if (!skip?.has(key)) applyOne(st, a, key);
    }
}

/** Apply a saved ambiance to the live store (recolors the loaded geometry). */
export function applyAmbiance(a: ShowcaseAmbiance): void {
    applyKeys(a);
}

/**
 * Applique le seul aspect d'une scène aux nuages actuellement chargés, sans
 * toucher au mode. Le shader et le masque de classes étant globaux, cela
 * repeint toute la vue — il n'existe pas de style par nuage.
 */
export function applyAmbianceStyle(a: ShowcaseAmbiance): void {
    applyKeys(a, NOT_STYLE);
}
