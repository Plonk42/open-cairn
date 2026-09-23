import { PinIcon, type IconProps } from '@/components/icons/LidarIcons';
import {
    BaseLayerSection,
    ContourSection,
    HillshadeSection,
    Terrain3DSection,
} from '@/components/ui/LayerSwitcher';
import {
    ApiKeysSection,
    RenderSection,
    ShadingBlendSection,
    TerrainDemSection,
} from '@/components/ui/SettingsPanel';
import { useMapStore } from '@/stores/mapStore';
import type { ReactElement } from 'react';

/** Thin divider between two stacked sections inside a single pill/sheet. */
export function SectionDivider() {
    return <div className="my-3 h-px bg-gray-200 dark:bg-slate-700" />;
}

export function LayersIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
            <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" strokeLinejoin="round" />
        </svg>
    );
}

export function MountainIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 16l4.5-8 3 5 2.5-4.5L18 16H2z" />
        </svg>
    );
}

export function AdvancedIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.6 2.5h2.8l.4 2.02c.5.17.96.42 1.38.71l1.94-.68 1.4 2.42-1.53 1.4a5.7 5.7 0 010 1.6l1.53 1.4-1.4 2.42-1.94-.68c-.42.29-.88.54-1.38.71l-.4 2.02H8.6l-.4-2.02a5.6 5.6 0 01-1.38-.71l-1.94.68-1.4-2.42 1.53-1.4a5.7 5.7 0 010-1.6L3.48 6.97l1.4-2.42 1.94.68c.42-.29.88-.54 1.38-.71l.4-2.02z" />
            <circle cx="10" cy="10" r="2.3" />
        </svg>
    );
}

/** Peaks under a sun: what the *Point de vue* mode lets you read off the skyline. */
export function PanoramaIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <circle cx="14" cy="5.5" r="2.2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M1.5 16.5l4.5-7 3 4.2 2.5-3.7 5 6.5H1.5z" />
        </svg>
    );
}

export function RouteIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 16c0-2 3-2 3-4S5 8 5 6a2 2 0 114 0M11 4c0 2 4 2 4 5s-4 3-4 5a2 2 0 104 0" />
            <circle cx="5" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
    );
}

/** One collapsible map-styling section (an accordion section on desktop, a sheet tab on mobile). */
export interface RouteSettingSection {
    id: string;
    label: string;
    Icon: (props: IconProps) => ReactElement;
    render: () => ReactElement;
}

/**
 * Meta-setting heading the « Fond »: whether it is shared by both views. It
 * governs the settings below rather than being one of them, hence its own look
 * (amber, dashed) instead of the green of ordinary controls.
 */
function FondPinToggle(): ReactElement {
    const pinned = useMapStore((s) => s.mapStylePinned);
    const setPinned = useMapStore((s) => s.setMapStylePinned);
    return (
        <button
            type="button"
            role="switch"
            aria-checked={pinned}
            onClick={() => setPinned(!pinned)}
            title={pinned
                ? 'Le fond est commun à l\'Itinéraire et au Studio. Cliquer pour que chaque vue garde le sien.'
                : 'Chaque vue garde son propre fond. Cliquer pour partager celui-ci avec l\'autre vue.'}
            className={`mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-left text-xs transition ${pinned
                ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-slate-300 text-slate-500 hover:bg-black/[0.03] dark:border-slate-600 dark:text-slate-400 dark:hover:bg-white/5'}`}
        >
            <PinIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
                {pinned ? 'Épinglé : même fond dans les deux vues' : 'Épingler : même fond dans les deux vues'}
            </span>
            <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${pinned ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${pinned ? 'left-3.5' : 'left-0.5'}`} />
            </span>
        </button>
    );
}

/** Header cue that the « Fond » is pinned, visible while its section is folded. */
export function FondPinnedBadge(): ReactElement | null {
    const pinned = useMapStore((s) => s.mapStylePinned);
    if (!pinned) return null;
    return (
        <span title="Fond épinglé : commun aux deux vues" className="text-amber-500">
            <PinIcon className="h-4 w-4" />
        </span>
    );
}

/**
 * Everything that makes up the map background: the basemap picker, the LiDAR
 * HD hillshade and its blend mode, and the contour lines. Shared verbatim by the
 * Itinéraire and Studio « Fond » sections — the one section both views have.
 */
export function MapBackgroundSection(): ReactElement {
    return (
        <>
            <FondPinToggle />
            <BaseLayerSection />
            <SectionDivider />
            <HillshadeSection />
            <SectionDivider />
            <ShadingBlendSection />
            <SectionDivider />
            <ContourSection />
        </>
    );
}

/**
 * Shared map-styling sections, composed identically into the desktop
 * `RouteSidePanel` (one accordion section each) and the mobile toolbar (one sheet
 * each) so the two shells stay a single source of truth.
 */
export const ROUTE_SETTING_SECTIONS: ReadonlyArray<RouteSettingSection> = [
    { id: 'fond', label: 'Fond', Icon: LayersIcon, render: () => <MapBackgroundSection /> },
    {
        id: 'terrain',
        label: 'Terrain',
        Icon: MountainIcon,
        render: () => (
            <>
                <Terrain3DSection />
                <SectionDivider />
                <TerrainDemSection />
            </>
        ),
    },
    {
        id: 'avance',
        label: 'Avancé',
        Icon: AdvancedIcon,
        render: () => (
            <>
                <RenderSection />
                <SectionDivider />
                <ApiKeysSection />
            </>
        ),
    },
];
