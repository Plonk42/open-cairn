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
        lidarSunDate: st.lidarSunDate,
        lidarSunEnabled: st.lidarSunEnabled,
        lidarShadows: st.lidarShadows,
        lidarShadowStrength: st.lidarShadowStrength,
        lidarCloudEdl: st.lidarCloudEdl,
        lidarCloudEdlStrength: st.lidarCloudEdlStrength,
        lidarCloudEdlRadius: st.lidarCloudEdlRadius,
        lidarCloudEdlFarPlane: st.lidarCloudEdlFarPlane,
        lidarCloudPointSize: st.lidarCloudPointSize,
        lidarCloudSizeCompensation: st.lidarCloudSizeCompensation,
        lidarCloudOpacity: st.lidarCloudOpacity,
        lidarCloudPhotoOpacity: st.lidarCloudPhotoOpacity,
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
    lidarSunDate: (s, v) => s.setLidarSunDate(v),
    lidarSunEnabled: (s, v) => s.setLidarSunEnabled(v),
    lidarShadows: (s, v) => s.setLidarShadows(v),
    lidarShadowStrength: (s, v) => s.setLidarShadowStrength(v),
    lidarCloudEdl: (s, v) => s.setLidarCloudEdl(v),
    lidarCloudEdlStrength: (s, v) => s.setLidarCloudEdlStrength(v),
    lidarCloudEdlRadius: (s, v) => s.setLidarCloudEdlRadius(v),
    lidarCloudEdlFarPlane: (s, v) => s.setLidarCloudEdlFarPlane(v),
    lidarCloudPointSize: (s, v) => s.setLidarCloudPointSize(v),
    lidarCloudSizeCompensation: (s, v) => s.setLidarCloudSizeCompensation(v),
    lidarCloudOpacity: (s, v) => s.setLidarCloudOpacity(v),
    lidarCloudPhotoOpacity: (s, v) => s.setLidarCloudPhotoOpacity(v),
    lidarCloudBasemapOpacity: (s, v) => s.setLidarCloudBasemapOpacity(v),
    lidarCloudClasses: (s, v) => s.setLidarCloudClasses(v),
    contourLinesEnabled: (s, v) => s.setContourLinesEnabled(v),
    contourLinesOpacity: (s, v) => s.setContourLinesOpacity(v),
};

function applyOne<K extends keyof ShowcaseAmbiance>(st: MapState, a: ShowcaseAmbiance, key: K): void {
    AMBIANCE_SETTERS[key](st, a[key]);
}

/** Apply a saved ambiance to the live store (recolors the loaded geometry). */
export function applyAmbiance(a: ShowcaseAmbiance): void {
    const st = useMapStore.getState();
    for (const key of Object.keys(AMBIANCE_SETTERS) as (keyof ShowcaseAmbiance)[]) {
        applyOne(st, a, key);
    }
}
