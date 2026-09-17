import { setTileCacheMaxSize } from '@/lib/compositeProtocol';
import type { Viewpoint } from '@/lib/viewpointCamera';
import type { StateCreator } from 'zustand';
import type { MapState } from '../mapStore';
import { persisted, type PersistedSettings } from '../persistence';

export type RenderQuality = 'balanced' | 'sharp';

export const RENDER_QUALITY_LABELS: Record<RenderQuality, string> = {
    balanced: 'Fluide',
    sharp: 'Net',
};

export type UiTheme = 'light' | 'dark';

export interface SettingsSlice {
    /** Raster and canvas quality used for pitched 3D views. */
    renderQuality: RenderQuality;
    setRenderQuality: (v: RenderQuality) => void;

    /** Maximum number of composite tiles kept in memory cache. */
    tileCacheSize: number;
    setTileCacheSize: (v: number) => void;

    /** Light or dark UI theme. */
    uiTheme: UiTheme;
    setUiTheme: (v: UiTheme) => void;

    /** Whether the user has seen (finished or skipped) the LiDAR Studio onboarding tutorial. */
    studioTutorialSeen: boolean;
    setStudioTutorialSeen: (v: boolean) => void;

    /**
     * Draw the sun's track across the sky for the selected day, with the disc at
     * its true angular size and a hidden-line pass so a ridge hides it. Needs the
     * 3D terrain: without it there is no relief to test the track against, and no
     * skyline to read the rise/set times from.
     */
    skySunPath: boolean;
    setSkySunPath: (v: boolean) => void;

    /** Same for the moon, which carries its phase. Independent of the sun's. */
    skyMoonPath: boolean;
    setSkyMoonPath: (v: boolean) => void;

    /**
     * Whether the dashed half of the tracks — what a ridge covers — is drawn.
     * One switch for both bodies: it answers "do I want to see through the
     * relief", which has nothing to do with which body is on.
     */
    skyHiddenPath: boolean;
    setSkyHiddenPath: (v: boolean) => void;

    /**
     * Map view only: paint the sky from the sun's position instead of the style's
     * neutral one. The Studio has its own switch for it (`lidarPhotoreal`), which
     * also re-exposes the basemap.
     */
    atmosphericSky: boolean;
    setAtmosphericSky: (v: boolean) => void;

    /**
     * Studio "caméra libre": lets the camera cross the terrain surface instead of
     * being pushed back out by MapLibre, and unpins its altitude from the terrain
     * so the arrow keys can climb. Session-only on purpose — it changes how
     * navigation feels, so it should not silently persist across reloads.
     */
    freeCamera: boolean;
    setFreeCamera: (v: boolean) => void;

    /**
     * Studio "point de vue": the eye is pinned to a spot on the ground and the
     * camera only rotates, as if standing there and looking around. `null` means
     * the mode is off. Session-only like `freeCamera` — it is a way of looking,
     * not a setting, and it would be disorienting to reload straight into it.
     */
    viewpoint: Viewpoint | null;
    setViewpoint: (v: Viewpoint | null) => void;

    /** Waiting for the click that picks the viewpoint on the map. */
    viewpointPicking: boolean;
    setViewpointPicking: (v: boolean) => void;

    /** IGN API key for the private WMTS layers (SCAN 25, Plan IGN HD). */
    ignApiKey: string;
    setIgnApiKey: (v: string) => void;

    /** IGN API key for terrain DEM (private WMS-r, HIGHRES.LINEAR). */
    ignDemApiKey: string;
    setIgnDemApiKey: (v: string) => void;
}

export const createSettingsSlice: StateCreator<MapState, [], [], SettingsSlice> = (set) => ({
    renderQuality: persisted.renderQuality ?? 'balanced',
    setRenderQuality: (renderQuality) => set({ renderQuality }),

    tileCacheSize: persisted.tileCacheSize ?? 256,
    setTileCacheSize: (tileCacheSize) => {
        setTileCacheMaxSize(tileCacheSize);
        set({ tileCacheSize });
    },

    uiTheme: persisted.uiTheme ?? 'light',
    setUiTheme: (uiTheme) => set({ uiTheme }),

    studioTutorialSeen: persisted.studioTutorialSeen ?? false,
    setStudioTutorialSeen: (studioTutorialSeen) => set({ studioTutorialSeen }),

    skySunPath: persisted.skySunPath ?? false,
    setSkySunPath: (skySunPath) => set({ skySunPath }),

    skyMoonPath: persisted.skyMoonPath ?? false,
    setSkyMoonPath: (skyMoonPath) => set({ skyMoonPath }),

    skyHiddenPath: persisted.skyHiddenPath ?? true,
    setSkyHiddenPath: (skyHiddenPath) => set({ skyHiddenPath }),

    atmosphericSky: persisted.atmosphericSky ?? false,
    setAtmosphericSky: (atmosphericSky) => set({ atmosphericSky }),

    freeCamera: false,
    setFreeCamera: (freeCamera) => set({ freeCamera }),

    viewpoint: null,
    setViewpoint: (viewpoint) => set({ viewpoint, viewpointPicking: false }),

    viewpointPicking: false,
    setViewpointPicking: (viewpointPicking) => set({ viewpointPicking }),

    ignApiKey: persisted.ignApiKey ?? '',
    setIgnApiKey: (ignApiKey) => set({ ignApiKey }),

    ignDemApiKey: persisted.ignDemApiKey ?? '',
    setIgnDemApiKey: (ignDemApiKey) => set({ ignDemApiKey }),
});

/** Persisted keys owned by the settings slice. */
export function selectSettingsPersisted(
    s: SettingsSlice,
): Pick<
    PersistedSettings,
    | 'uiTheme'
    | 'studioTutorialSeen'
    | 'skySunPath'
    | 'skyMoonPath'
    | 'skyHiddenPath'
    | 'atmosphericSky'
    | 'renderQuality'
    | 'tileCacheSize'
    | 'ignApiKey'
    | 'ignDemApiKey'
> {
    return {
        uiTheme: s.uiTheme,
        studioTutorialSeen: s.studioTutorialSeen,
        skySunPath: s.skySunPath,
        skyMoonPath: s.skyMoonPath,
        skyHiddenPath: s.skyHiddenPath,
        atmosphericSky: s.atmosphericSky,
        renderQuality: s.renderQuality,
        tileCacheSize: s.tileCacheSize,
        ignApiKey: s.ignApiKey,
        ignDemApiKey: s.ignDemApiKey,
    };
}
