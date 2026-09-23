import { ChevronDownIcon, PanelRightIcon, type IconProps } from '@/components/icons/LidarIcons';
import { ViewSwitch } from '@/components/shell/ViewSwitch';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, type ReactElement, type ReactNode } from 'react';

/** Panel width, and the gap it keeps from the viewport edges. */
export const SIDE_PANEL_WIDTH_PX = 344;
export const SIDE_PANEL_MARGIN_PX = 12;

/** Horizontal strip the panel occupies, margins included. The top bars stop
 *  short of it, folded or not, so the panel can rise to the top. */
export const SIDE_PANEL_STRIP_PX = SIDE_PANEL_WIDTH_PX + 2 * SIDE_PANEL_MARGIN_PX;

/**
 * Keeps the map's usable area clear of the panel: every `easeTo` / `fitBounds`
 * frames the padded centre, and the Studio's capture rectangle is born there.
 */
export function useMapRightPadding(rightPx: number): void {
    const map = useMapStore((s) => s.mapInstance);
    useEffect(() => {
        map?.setPadding({ top: 0, right: rightPx, bottom: 0, left: 0 });
    }, [map, rightPx]);
    // The map outlives either view's panel, so hand it back unpadded on the way out.
    useEffect(() => () => {
        useMapStore.getState().mapInstance?.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    }, []);
}

/**
 * The panel docked right of the map, or — folded — its header alone, so the
 * view switch it carries stays reachable. Positioned against the map area, so
 * it never covers what sits below it (the route dock).
 */
export function DockedSidePanel({ collapsed, onExpand, bottomInsetPx, children }: Readonly<{
    collapsed: boolean;
    onExpand: () => void;
    /** Room left at the bottom for what floats there (the reduced route dock). */
    bottomInsetPx: number;
    children: ReactNode;
}>): ReactElement {
    useMapRightPadding(collapsed ? 0 : SIDE_PANEL_STRIP_PX);
    if (collapsed) {
        return (
            <div
                className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-2xl border border-black/5 bg-white/95 py-2 pl-3 pr-2 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10"
                style={{ top: SIDE_PANEL_MARGIN_PX, right: SIDE_PANEL_MARGIN_PX }}
            >
                <ViewSwitch />
                <SidePanelIconButton label="Afficher le panneau de réglages" onClick={onExpand}>
                    <PanelRightIcon className="h-4 w-4" />
                </SidePanelIconButton>
            </div>
        );
    }
    return (
        <div
            className="pointer-events-none absolute bottom-0 right-0 top-0 z-30 flex"
            style={{ padding: SIDE_PANEL_MARGIN_PX, paddingBottom: SIDE_PANEL_MARGIN_PX + bottomInsetPx }}
        >
            {children}
        </div>
    );
}

/**
 * Generic right-hand accordion panel: a full-height floating card holding a
 * title bar and a scrollable stack of collapsible sections. Several sections
 * can stay open at once — it is an accordion in the "stacked disclosures"
 * sense, not a one-at-a-time tab strip. Its title is the view switch.
 *
 * Theme-aware (light default + `dark:` variants).
 */
export function SidePanel({ actions, children }: Readonly<{
    actions?: ReactNode;
    children: ReactNode;
}>): ReactElement {
    return (
        <aside
            style={{ width: SIDE_PANEL_WIDTH_PX }}
            className="pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10"
        >
            <header className="flex shrink-0 items-center gap-0.5 border-b border-black/5 py-2 pl-3 pr-2 dark:border-white/10">
                <div className="mr-auto">
                    <ViewSwitch />
                </div>
                {actions}
            </header>
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </aside>
    );
}

/** Ghost icon button sized for the panel header (and section headers). */
export function SidePanelIconButton({ label, onClick, children }: Readonly<{
    label: string;
    onClick: () => void;
    children: ReactNode;
}>): ReactElement {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
        >
            {children}
        </button>
    );
}

/**
 * One collapsible section. `badge` is rendered just before the chevron, for a
 * count or an attention cue.
 *
 * The rule between two sections is inset rather than full-bleed, and the header
 * is deliberately tall: a dozen flush 13 px rows read as a list of options, not
 * as a dozen separate things one can open.
 */
export function SidePanelSection({ label, Icon, open, onToggle, badge, children }: Readonly<{
    label: string;
    Icon?: (props: IconProps) => ReactElement;
    open: boolean;
    onToggle: () => void;
    badge?: ReactNode;
    children: ReactNode;
}>): ReactElement {
    return (
        <section className="border-b border-black/[0.07] px-3 last:border-b-0 dark:border-white/[0.07]">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-3 text-left text-[15px] font-medium text-slate-900 transition hover:bg-black/[0.04] dark:text-white dark:hover:bg-white/5"
            >
                {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {badge}
                <ChevronDownIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div className="px-1 pb-3 text-slate-800 dark:text-slate-100">{children}</div>}
        </section>
    );
}

/** Small-caps rule separating two families of sections. */
export function SidePanelGroupLabel({ label }: Readonly<{ label: string }>): ReactElement {
    return (
        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
            <span className="h-px flex-1 bg-black/10 dark:bg-white/10" aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
            <span className="h-px flex-1 bg-black/10 dark:bg-white/10" aria-hidden="true" />
        </div>
    );
}
