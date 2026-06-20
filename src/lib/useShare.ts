import { useCallback, useState } from 'react';
import { buildShareUrl } from '@/lib/shareView';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';

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
            view: map.view,
            baseLayer: map.baseLayer,
            hillshadeEnabled: map.hillshadeEnabled,
            hillshadeSource: map.hillshadeSource,
            hillshadeBlend: map.hillshadeBlend,
            hillshadeIntensity: map.hillshadeIntensity,
            terrainEnabled: map.terrainEnabled,
            terrainExaggeration: map.terrainExaggeration,
            contourLinesEnabled: map.contourLinesEnabled,
            contourLinesOpacity: map.contourLinesOpacity,
            routeActive: route.active,
            routeMode: route.mode,
            colorElevationBySlope: route.colorElevationBySlope,
            waypoints: route.waypoints,
            selectionRange: route.selectionRange,
            cliffSlicePoints: map.cliffSlicePoints,
            cliffSliceCorridor: map.cliffSliceCorridor,
            cliffSliceClasses: map.cliffSliceClasses,
            cliffSliceColorClass: map.cliffSliceColorClass,
            cliffSliceColorDepth: map.cliffSliceColorDepth,
            cliffSliceRopeSafety: map.cliffSliceRopeSafety,
            cliffSliceStations: map.cliffSliceStations,
        });
        navigator.clipboard.writeText(url);
        setShareTooltip(true);
        setTimeout(() => setShareTooltip(false), 2000);
    }, []);

    return { shareTooltip, handleShare };
}
