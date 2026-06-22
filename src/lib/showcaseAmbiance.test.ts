import { applyAmbiance, extractAmbiance } from '@/lib/showcaseAmbiance';
import { useMapStore } from '@/stores/mapStore';
import { describe, expect, it } from 'vitest';

describe('showcaseAmbiance', () => {
    it('round-trips every render setting through the store (extract → apply → extract)', () => {
        const st = useMapStore.getState();

        // Set a distinctive, non-default value for each ambiance field.
        st.setLidarMode('poisson');
        st.setLidarShader('winter');
        st.setLidarSunDate('2026-06-21T10:00');
        st.setLidarSunEnabled(true);
        st.setLidarShadows(false);
        st.setLidarShadowStrength(0.33);
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
