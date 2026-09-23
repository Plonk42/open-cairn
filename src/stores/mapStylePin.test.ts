import { useMapStore } from '@/stores/mapStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('pinned « Fond »', () => {
    beforeEach(() => {
        const st = useMapStore.getState();
        st.setMapStylePinned(false);
        st.setAppView('map');
    });

    it('copies the current view\'s Fond into the other view when pinning', () => {
        const st = useMapStore.getState();
        st.setBaseLayer('osm');
        st.setContourLinesOpacity(0.7);
        st.setMapStylePinned(true);

        const lidar = useMapStore.getState().mapStyleByView.lidar;
        expect(lidar.baseLayer).toBe('osm');
        expect(lidar.contourLinesOpacity).toBe(0.7);
    });

    it('mirrors Fond edits into both views while pinned, but not terrain ones', () => {
        const st = useMapStore.getState();
        st.setMapStylePinned(true);
        st.setHillshadeIntensity(0.3);
        st.setTerrainExaggeration(2.5);

        const { map, lidar } = useMapStore.getState().mapStyleByView;
        expect(lidar.hillshadeIntensity).toBe(0.3);
        expect(map.terrainExaggeration).toBe(2.5);
        expect(lidar.terrainExaggeration).not.toBe(2.5);
    });

    it('keeps each view\'s copy apart when not pinned, and leaves the shared value on unpin', () => {
        const st = useMapStore.getState();
        st.setMapStylePinned(true);
        st.setBaseLayer('plan');
        st.setMapStylePinned(false);
        expect(useMapStore.getState().mapStyleByView.lidar.baseLayer).toBe('plan');

        st.setBaseLayer('osm');
        expect(useMapStore.getState().mapStyleByView.lidar.baseLayer).toBe('plan');
        st.setAppView('lidar');
        expect(useMapStore.getState().baseLayer).toBe('plan');
    });
});
