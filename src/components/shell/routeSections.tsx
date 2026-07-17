import type { IconProps } from '@/components/icons/LidarIcons';
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

export function ShadingIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="6.5" />
            <path fill="currentColor" stroke="none" d="M10 3.5a6.5 6.5 0 000 13V3.5z" />
        </svg>
    );
}

export function ContourIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c2-3 5-4 8-4s6 1 8 4M4 15c2-2 4-3 6-3s4 1 6 3M7 8.5c1-1 2-1.5 3-1.5s2 .5 3 1.5" />
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

export function RouteIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 16c0-2 3-2 3-4S5 8 5 6a2 2 0 114 0M11 4c0 2 4 2 4 5s-4 3-4 5a2 2 0 104 0" />
            <circle cx="5" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="15" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function CliffIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 16l4-8 3 4 3-7 6 11" />
        </svg>
    );
}

/** One collapsible map-styling section (a pill on desktop, a sheet tab on mobile). */
export interface RouteSettingSection {
    id: string;
    label: string;
    Icon: (props: IconProps) => ReactElement;
    render: () => ReactElement;
}

/**
 * Shared map-styling sections, composed identically into the desktop
 * `RouteBottomBar` (one popover pill each) and the mobile toolbar (one sheet
 * each) so the two shells stay a single source of truth.
 */
export const ROUTE_SETTING_SECTIONS: ReadonlyArray<RouteSettingSection> = [
    { id: 'fond', label: 'Fond', Icon: LayersIcon, render: () => <BaseLayerSection /> },
    {
        id: 'ombrage',
        label: 'Ombrage',
        Icon: ShadingIcon,
        render: () => (
            <>
                <HillshadeSection />
                <SectionDivider />
                <ShadingBlendSection />
            </>
        ),
    },
    { id: 'courbes', label: 'Courbes', Icon: ContourIcon, render: () => <ContourSection /> },
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
