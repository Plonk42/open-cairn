import { setTileCacheMaxSize } from '@/lib/compositeProtocol';
import type { StateCreator } from 'zustand';
import { persisted, type PersistedSettings } from '../persistence';
import type { MapState } from '../mapStore';

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

    /** IGN API key for SCAN 25 (private WMTS). */
    ignScanApiKey: string;
    setIgnScanApiKey: (v: string) => void;

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

    ignScanApiKey: persisted.ignScanApiKey ?? '',
    setIgnScanApiKey: (ignScanApiKey) => set({ ignScanApiKey }),

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
    | 'renderQuality'
    | 'tileCacheSize'
    | 'ignScanApiKey'
    | 'ignDemApiKey'
> {
    return {
        uiTheme: s.uiTheme,
        studioTutorialSeen: s.studioTutorialSeen,
        renderQuality: s.renderQuality,
        tileCacheSize: s.tileCacheSize,
        ignScanApiKey: s.ignScanApiKey,
        ignDemApiKey: s.ignDemApiKey,
    };
}
