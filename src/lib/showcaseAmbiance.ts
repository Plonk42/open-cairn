/**
 * Single source of truth for mapping the LiDAR "ambiance" (render settings)
 * between the live store and a serialized {@link ShowcaseAmbiance}.
 *
 * Both directions are exhaustive by type: adding a field to `ShowcaseAmbiance`
 * forces updating `extractAmbiance` (object-literal return type) AND
 * `AMBIANCE_SETTERS` (mapped type over every key), so a render setting can no
 * longer be silently forgotten on export or restore.
 */
import type { CaptureParamEntry } from '@/lib/captureParams';
import { ROCK_LABELS, SHADER_LABELS } from '@/lib/lidarBrowser/slope';
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
        lidarSunAzimuth: st.lidarSunAzimuth,
        lidarSunElevation: st.lidarSunElevation,
        lidarSunWarmth: st.lidarSunWarmth,
        lidarSunIntensity: st.lidarSunIntensity,
        lidarSunEnabled: st.lidarSunEnabled,
        lidarShadows: st.lidarShadows,
        lidarShadowStrength: st.lidarShadowStrength,
        lidarPhotoreal: st.lidarPhotoreal,
        lidarExposure: st.lidarExposure,
        lidarAmbient: st.lidarAmbient,
        lidarSunStrength: st.lidarSunStrength,
        lidarHaze: st.lidarHaze,
        lidarRockFacet: st.lidarRockFacet,
        lidarRockMicro: st.lidarRockMicro,
        lidarRockBreak: st.lidarRockBreak,
        lidarRockSpecular: st.lidarRockSpecular,
        lidarAo: st.lidarAo,
        lidarVegEnhance: st.lidarVegEnhance,
        lidarVegColorMode: st.lidarVegColorMode,
        lidarVegHeightScale: st.lidarVegHeightScale,
        lidarVegHeightAuto: st.lidarVegHeightAuto,
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
        lidarCloudPhotoDetail: st.lidarCloudPhotoDetail,
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
    lidarSunAzimuth: (s, v) => s.setLidarSunAzimuth(v),
    lidarSunElevation: (s, v) => s.setLidarSunElevation(v),
    lidarSunWarmth: (s, v) => s.setLidarSunWarmth(v),
    lidarSunIntensity: (s, v) => s.setLidarSunIntensity(v),
    lidarSunEnabled: (s, v) => s.setLidarSunEnabled(v),
    lidarShadows: (s, v) => s.setLidarShadows(v),
    lidarShadowStrength: (s, v) => s.setLidarShadowStrength(v),
    lidarPhotoreal: (s, v) => s.setLidarPhotoreal(v),
    lidarExposure: (s, v) => s.setLidarExposure(v),
    lidarAmbient: (s, v) => s.setLidarAmbient(v),
    lidarSunStrength: (s, v) => s.setLidarSunStrength(v),
    lidarHaze: (s, v) => s.setLidarHaze(v),
    lidarRockFacet: (s, v) => s.setLidarRockFacet(v),
    lidarRockMicro: (s, v) => s.setLidarRockMicro(v),
    lidarRockBreak: (s, v) => s.setLidarRockBreak(v),
    lidarRockSpecular: (s, v) => s.setLidarRockSpecular(v),
    lidarAo: (s, v) => s.setLidarAo(v),
    lidarVegEnhance: (s, v) => s.setLidarVegEnhance(v),
    lidarVegColorMode: (s, v) => s.setLidarVegColorMode(v),
    lidarVegHeightScale: (s, v) => s.setLidarVegHeightScale(v),
    lidarVegHeightAuto: (s, v) => s.setLidarVegHeightAuto(v),
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
    lidarCloudPhotoDetail: (s, v) => s.setLidarCloudPhotoDetail(v),
    lidarCloudBasemapOpacity: (s, v) => s.setLidarCloudBasemapOpacity(v),
    lidarCloudClasses: (s, v) => s.setLidarCloudClasses(v),
    contourLinesEnabled: (s, v) => s.setContourLinesEnabled(v),
    contourLinesOpacity: (s, v) => s.setContourLinesOpacity(v),
};

function applyOne<K extends keyof ShowcaseAmbiance>(st: MapState, a: ShowcaseAmbiance, key: K): void {
    AMBIANCE_SETTERS[key](st, a[key]);
}

/** `lidarMode` decides what the next capture will do, not the look of the already-loaded clouds. */
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
 * Applies only the look of a scene to the currently loaded clouds, without
 * touching the mode. Since the shader and the class mask are global, this
 * repaints the whole view — there is no per-cloud style.
 */
export function applyAmbianceStyle(a: ShowcaseAmbiance): void {
    applyKeys(a, NOT_STYLE);
}

/**
 * Readable summary of an ambiance, for the « Détails » disclosure of a scene:
 * only what tells one view from another at a glance. The remaining fifty-odd
 * settings have no place on a tile.
 */
export function describeAmbiance(a: ShowcaseAmbiance): CaptureParamEntry[] {
    // Rock and snow line only paint the Terrain palette: showing them elsewhere
    // would pass an inert setting off as a characteristic of the view.
    const terrain: CaptureParamEntry[] = a.lidarShader === 'terrain'
        ? [
            { key: 'rock', label: 'Roche', text: ROCK_LABELS[a.lidarRockType] },
            { key: 'snow', label: 'Neige', text: `${Math.round(a.lidarSnowLine)} m · ${Math.round(a.lidarSnowAmount * 100)} %` },
        ]
        : [];
    return [
        { key: 'palette', label: 'Palette', text: SHADER_LABELS[a.lidarShader] },
        ...terrain,
        { key: 'render', label: 'Rendu', text: a.lidarPhotoreal ? 'photoréaliste' : 'simple' },
        {
            key: 'sun',
            label: 'Soleil',
            text: a.lidarSunEnabled
                ? `${Math.round(a.lidarSunAzimuth)}° · ${Math.round(a.lidarSunElevation)}° de hauteur`
                : 'éteint',
        },
    ];
}
