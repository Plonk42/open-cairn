import { applyAmbiance, extractAmbiance } from '@/lib/showcaseAmbiance';
import { useMapStore } from '@/stores/mapStore';
import { LIDAR_RENDER_DEFAULTS } from '@/stores/slices/lidarSlice';
import { describe, expect, it } from 'vitest';

/** Seul réglage de rendu volontairement hors ambiance : il pèse sur la VRAM de la machine qui affiche. */
const MACHINE_ONLY = new Set<string>(['lidarShadowMapSize']);

describe('showcaseAmbiance', () => {
    it('carries every LiDAR render setting', () => {
        const ambiance = extractAmbiance(useMapStore.getState());
        const missing = Object.keys(LIDAR_RENDER_DEFAULTS).filter((k) => !(k in ambiance) && !MACHINE_ONLY.has(k));
        expect(missing).toEqual([]);
    });

    it('round-trips every render setting through the store (extract → apply → extract)', () => {
        const st = useMapStore.getState();

        // Set a distinctive, non-default value for each ambiance field.
        st.setLidarMode('poisson');
        st.setLidarShader('slope');
        st.setLidarSunDate('2026-06-21T10:00');
        st.setLidarSunEnabled(true);
        st.setLidarShadows(false);
        st.setLidarShadowStrength(0.33);
        st.setLidarPhotoreal(false);
        st.setLidarExposure(1.8);
        st.setLidarAmbient(0.4);
        st.setLidarSunStrength(1.6);
        st.setLidarHaze(0.75);
        st.setLidarRockFacet(0.15);
        st.setLidarRockMicro(2);
        st.setLidarRockBreak(0.25);
        st.setLidarRockSpecular(0.9);
        st.setLidarAo(0.1);
        st.setLidarVegHeightAuto(false);
        st.setLidarCloudEdl(false);
        st.setLidarCloudEdlStrength(123);
        st.setLidarCloudEdlRadius(2.5);
        st.setLidarCloudEdlFarPlane(777);
        st.setLidarCloudPointSize(4);
        st.setLidarCloudSizeCompensation(false);
        st.setLidarCloudOpacity(0.6);
        st.setLidarCloudPhotoOpacity(0.4);
        st.setLidarCloudPhotoOpacityNonGround(0.7);
        st.setLidarCloudBasemapOpacity(0.2);
        st.setLidarCloudClasses([3, 4, 5]);
        st.setContourLinesEnabled(true);
        st.setContourLinesOpacity(0.9);

        const snapshot = extractAmbiance(useMapStore.getState());

        // Wipe the store back to its reset defaults, then restore the snapshot.
        useMapStore.getState().resetLidarRenderSettings();
        applyAmbiance(snapshot);

        // Every field must have been carried through both directions.
        expect(extractAmbiance(useMapStore.getState())).toEqual(snapshot);
    });
});
