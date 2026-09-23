import { CollapseAllIcon, PanelRightIcon, ResetIcon } from '@/components/icons/LidarIcons';
import { StudioCloudList, useCloudsOnScreen } from '@/components/lidar/StudioClouds';
import { STUDIO_RENDER_SETTINGS } from '@/components/lidar/StudioRenderSettings';
import {
    SidePanel, SidePanelGroupLabel, SidePanelHandle, SidePanelIconButton, SidePanelSection,
} from '@/components/shell/SidePanel';
import { useMapStore } from '@/stores/mapStore';
import { useCallback, useEffect, type ReactElement } from 'react';
import { STUDIO_REVEAL_EVENT } from './tutorial/steps';

/** Panel width, the gap it keeps from the viewport edges, and the room it
 *  leaves the top bar below which it starts. */
const STUDIO_PANEL_WIDTH_PX = 344;
const STUDIO_PANEL_MARGIN_PX = 12;
const PANEL_TOP_PX = 60;

/** Horizontal strip the panel occupies, margins included. */
export const STUDIO_PANEL_STRIP_PX = STUDIO_PANEL_WIDTH_PX + 2 * STUDIO_PANEL_MARGIN_PX;

const CLOUDS_SECTION = 'clouds';

/**
 * What each `TutorialReveal` needs from the panel: the section to unfold (if
 * any) and the anchor to scroll into view, the panel having its own scrollbar.
 * `capture` is absent: the panel folds away for it (see `useTutorialReveal`).
 */
const REVEAL_TARGETS: Record<string, { section: string | null; anchor: string }> = {
    render: { section: null, anchor: 'render-settings' },
};

function LocateIcon({ className }: Readonly<{ className?: string }>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="4" />
            <path strokeLinecap="round" d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18" />
        </svg>
    );
}

/**
 * Keeps the map's usable area clear of the panel. The capture rectangle is
 * placed at the *padded* screen centre, so without this it would be born half
 * under the panel — and every `easeTo` would frame its target behind it.
 */
function useMapRightPadding(rightPx: number): void {
    const map = useMapStore((s) => s.mapInstance);
    useEffect(() => {
        map?.setPadding({ top: 0, right: rightPx, bottom: 0, left: 0 });
    }, [map, rightPx]);
    // The map outlives this panel (it is shared with the Itinéraire view), so
    // hand it back unpadded on the way out.
    useEffect(() => () => {
        useMapStore.getState().mapInstance?.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    }, []);
}

/**
 * The onboarding tutorial can't spotlight a control that is folded away, so it
 * announces the surface it needs through the `STUDIO_REVEAL_EVENT` event
 * and this unfolds it. Sections only ever open — folding the user's back on
 * every step would be gratuitous — but the whole panel folds for `capture`,
 * whose button only exists while it is folded.
 */
function useTutorialReveal(
    setSectionOpen: (id: string, open: boolean) => void,
    setCollapsed: (v: boolean) => void,
): void {
    useEffect(() => {
        const onReveal = (e: Event) => {
            const detail = (e as CustomEvent<string | null>).detail;
            if (detail === 'capture') {
                setCollapsed(true);
                return;
            }
            const target = REVEAL_TARGETS[detail ?? ''];
            if (!target) return;
            setCollapsed(false);
            if (target.section) setSectionOpen(target.section, true);
            requestAnimationFrame(() => {
                document.querySelector(`[data-tutorial="${target.anchor}"]`)
                    ?.scrollIntoView({ block: 'center' });
            });
        };
        globalThis.addEventListener(STUDIO_REVEAL_EVENT, onReveal);
        return () => globalThis.removeEventListener(STUDIO_REVEAL_EVENT, onReveal);
    }, [setSectionOpen, setCollapsed]);
}

/** Count badge, amber when at least one cloud sits outside the viewport. */
function CloudsBadge({ total, offScreen }: Readonly<{ total: number; offScreen: number }>) {
    if (total === 0) return null;
    const alert = offScreen > 0;
    return (
        <span
            title={alert ? `${offScreen} nuage(s) hors champ` : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${alert
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-black/5 text-slate-500 dark:bg-white/10 dark:text-slate-400'}`}
        >
            {alert && <LocateIcon className="h-3 w-3" />}
            {total}
        </span>
    );
}

/**
 * Desktop LiDAR Studio control surface: a right-hand accordion holding the
 * loaded-cloud list and the nine render settings.
 *
 * It replaces the former bottom pill bar + floating cloud pill. Those showed
 * one menu at a time and hid the rest, which made the studio's own depth
 * invisible; stacked disclosures keep the whole vocabulary on screen and let
 * the user keep e.g. « Lumière » and « Ombres » open side by side while
 * iterating on a render.
 *
 * It holds *rendering* only. Capture keeps its own floating green button and
 * the camera modes stay in the top bar: neither is an appearance setting, and
 * both are used while the panel is being read.
 *
 * Mobile keeps its own chrome (`StudioMobileShell`) untouched.
 */
export function StudioSidePanel(): ReactElement {
    const collapsed = useMapStore((s) => s.studioPanelCollapsed);
    const setCollapsed = useMapStore((s) => s.setStudioPanelCollapsed);
    const sections = useMapStore((s) => s.studioPanelSections);
    const setSections = useMapStore((s) => s.setStudioPanelSections);
    const resetRenderSettings = useMapStore((s) => s.resetLidarRenderSettings);
    const clouds = useMapStore((s) => s.lidarClouds);
    const onScreenById = useCloudsOnScreen(clouds);

    const toggle = (id: string) => {
        setSections(sections.includes(id) ? sections.filter((s) => s !== id) : [...sections, id]);
    };

    // Reads the live store rather than the render-time `sections`, so the
    // tutorial-event caller below stays stable and never fights a stale
    // closure.
    const setSectionOpen = useCallback((id: string, open: boolean) => {
        const cur = useMapStore.getState().studioPanelSections;
        if (cur.includes(id) === open) return;
        useMapStore.getState().setStudioPanelSections(
            open ? [...cur, id] : cur.filter((s) => s !== id),
        );
    }, []);

    useTutorialReveal(setSectionOpen, setCollapsed);
    useMapRightPadding(collapsed ? 0 : STUDIO_PANEL_STRIP_PX);

    if (collapsed) {
        return (
            <div className="absolute right-3 top-16 z-30">
                <SidePanelHandle label="Afficher le panneau de réglages" onClick={() => setCollapsed(false)}>
                    <PanelRightIcon className="h-5 w-5" />
                </SidePanelHandle>
            </div>
        );
    }

    const offScreen = clouds.filter((c) => onScreenById[c.id] === false).length;

    return (
        <div
            className="pointer-events-none absolute bottom-0 right-0 top-0 z-30 flex"
            style={{ padding: STUDIO_PANEL_MARGIN_PX, paddingTop: PANEL_TOP_PX }}
        >
            <SidePanel
                title="Studio LiDAR"
                widthPx={STUDIO_PANEL_WIDTH_PX}
                actions={
                    <>
                        <SidePanelIconButton label="Réinitialiser tous les réglages de rendu" onClick={() => resetRenderSettings()}>
                            <ResetIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                        <SidePanelIconButton label="Tout replier" onClick={() => setSections([])}>
                            <CollapseAllIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                        <SidePanelIconButton label="Masquer le panneau" onClick={() => setCollapsed(true)}>
                            <PanelRightIcon className="h-4 w-4" />
                        </SidePanelIconButton>
                    </>
                }
            >
                <SidePanelSection
                    label="Nuages"
                    Icon={LocateIcon}
                    badge={<CloudsBadge total={clouds.length} offScreen={offScreen} />}
                    open={sections.includes(CLOUDS_SECTION)}
                    onToggle={() => toggle(CLOUDS_SECTION)}
                >
                    <StudioCloudList clouds={clouds} onScreenById={onScreenById} />
                </SidePanelSection>

                <SidePanelGroupLabel label="Rendu" />

                <div data-tutorial="render-settings">
                    {STUDIO_RENDER_SETTINGS.map((setting) => (
                        <SidePanelSection
                            key={setting.id}
                            label={setting.label}
                            Icon={setting.Icon}
                            open={sections.includes(setting.id)}
                            onToggle={() => toggle(setting.id)}
                        >
                            {setting.render()}
                        </SidePanelSection>
                    ))}
                </div>
            </SidePanel>
        </div>
    );
}
