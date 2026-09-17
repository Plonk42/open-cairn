import { buildShareUrl, type SharedViewpoint } from '@/lib/shareView';
import { useMapStore, type MapState } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import { useCallback, useState } from 'react';

/**
 * Standpoint to share, or `null` when the first-person mode is off.
 *
 * The look direction and the field of view are read off the map, not off the
 * store: `ViewpointController` keeps them in a closure on purpose (a store write
 * per frame is what made the orbit stutter), and the MapLibre camera is where
 * they are readable from the outside.
 */
function currentViewpoint(map: MapState): SharedViewpoint | null {
    if (!map.viewpoint || !map.mapInstance) return null;
    return {
        eye: map.viewpoint,
        framing: {
            bearing: map.mapInstance.getBearing(),
            pitch: map.mapInstance.getPitch(),
            fovDeg: map.mapInstance.getVerticalFieldOfView(),
        },
    };
}

/**
 * Builds a share URL from the current map + route state, copies it to the
 * clipboard, and exposes a transient "copied" tooltip flag.
 */
export function useShare(): { shareTooltip: boolean; handleShare: () => void } {
    const [shareTooltip, setShareTooltip] = useState(false);

    const handleShare = useCallback(() => {
        const map = useMapStore.getState();
        const route = useRouteStore.getState();
        const url = buildShareUrl({
            // In viewpoint mode this is the camera from BEFORE the mode was
            // entered (its own frames are untracked on purpose); it only serves
            // as the map's starting view, which the mode overrides on mount.
            view: map.view,
            viewpoint: currentViewpoint(map),
            baseLayer: map.baseLayer,
            hillshadeEnabled: map.hillshadeEnabled,
            hillshadeSource: map.hillshadeSource,
            hillshadeBlend: map.hillshadeBlend,
            hillshadeIntensity: map.hillshadeIntensity,
            terrainEnabled: map.terrainEnabled,
            terrainExaggeration: map.terrainExaggeration,
            terrainDemSource: map.terrainDemSource,
            contourLinesEnabled: map.contourLinesEnabled,
            contourLinesOpacity: map.contourLinesOpacity,
            sunDate: map.lidarSunDate,
            atmosphericSky: map.atmosphericSky,
            skySunPath: map.skySunPath,
            skyMoonPath: map.skyMoonPath,
            skyHiddenPath: map.skyHiddenPath,
            routeActive: route.active,
            routeMode: route.mode,
            colorElevationBySlope: route.colorElevationBySlope,
            waypoints: route.waypoints,
            selectionRange: route.selectionRange,
        });
        navigator.clipboard.writeText(url);
        setShareTooltip(true);
        setTimeout(() => setShareTooltip(false), 2000);
    }, []);

    return { shareTooltip, handleShare };
}
