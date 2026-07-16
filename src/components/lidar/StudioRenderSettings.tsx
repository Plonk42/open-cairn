import {
    ClassesIcon,
    EffectsIcon,
    type IconProps,
    LightIcon,
    OpacityIcon,
    ResetIcon,
    ShaderIcon,
    ShadowIcon,
    SizeIcon,
    TreeIcon,
} from '@/components/icons/LidarIcons';
import {
    ClassFilterSection,
    OpacityControls,
    PointSizeControls,
    ShaderControls,
    VegetationControls,
} from '@/components/ui/lidar/LidarAppearanceControls';
import { LidarEffectsControls } from '@/components/ui/lidar/LidarEffectsControls';
import { BoundShadowControls, SunControls } from '@/components/ui/lidar/LidarLightingControls';
import { useMapStore } from '@/stores/mapStore';
import type { ReactElement, ReactNode } from 'react';

export type StudioRenderSettingId =
    | 'opacite'
    | 'classes'
    | 'points'
    | 'shader'
    | 'vegetation'
    | 'lumiere'
    | 'ombres'
    | 'edl';

interface StudioRenderSetting {
    id: StudioRenderSettingId;
    label: string;
    Icon: (props: IconProps) => ReactElement;
    render: () => ReactNode;
}

/** Single source of truth for the bottom-bar render settings (one per button). */
export const STUDIO_RENDER_SETTINGS: ReadonlyArray<StudioRenderSetting> = [
    { id: 'opacite', label: 'Opacité', Icon: OpacityIcon, render: () => <OpacityControls /> },
    { id: 'classes', label: 'Classes', Icon: ClassesIcon, render: () => <ClassFilterSection /> },
    { id: 'points', label: 'Points', Icon: SizeIcon, render: () => <PointSizeControls /> },
    { id: 'shader', label: 'Shader', Icon: ShaderIcon, render: () => <ShaderControls /> },
    { id: 'vegetation', label: 'Végétation', Icon: TreeIcon, render: () => <VegetationControls /> },
    { id: 'lumiere', label: 'Lumière', Icon: LightIcon, render: () => <SunControls /> },
    { id: 'ombres', label: 'Ombres', Icon: ShadowIcon, render: () => <BoundShadowControls /> },
    { id: 'edl', label: 'EDL', Icon: EffectsIcon, render: () => <LidarEffectsControls /> },
];

const BASEMAPS: ReadonlyArray<{ id: 'ortho' | 'plan'; label: string }> = [
    { id: 'ortho', label: 'Photo' },
    { id: 'plan', label: 'Plan' },
];

export function QuickBasemapSwitch(): ReactElement {
    const baseLayer = useMapStore((s) => s.baseLayer);
    const setBaseLayer = useMapStore((s) => s.setBaseLayer);

    return (
        <div className="flex items-center gap-1.5">
            {/* Basemap layer selector (Photo / Plan). */}
            <div className="inline-flex items-center overflow-hidden rounded-md ring-1 ring-white/15">
                <fieldset className="inline-flex">
                    {BASEMAPS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setBaseLayer(id)}
                            aria-pressed={baseLayer === id}
                            className={`px-2.5 py-1 text-xs transition ${baseLayer === id ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                        >
                            {label}
                        </button>
                    ))}
                </fieldset>
            </div>
        </div>
    );
}

/** Resets every LiDAR render setting (opacity, classes, shader, lighting…) to defaults. */
export function ResetSettingsButton(): ReactElement {
    const reset = useMapStore((s) => s.resetLidarRenderSettings);
    return (
        <button
            type="button"
            onClick={() => reset()}
            title="Réinitialiser tous les réglages de rendu"
            aria-label="Réinitialiser tous les réglages de rendu"
            className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10"
        >
            <ResetIcon className="h-4 w-4" />
            <span>Réinit.</span>
        </button>
    );
}
