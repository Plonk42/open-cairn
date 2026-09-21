import { BottomBar, BottomBarButton, BottomBarPill } from '@/components/shell/BottomBar';
import { ROUTE_SETTING_SECTIONS, RouteIcon } from '@/components/shell/routeSections';
import { useMapStore } from '@/stores/mapStore';
import { useCallback, useState } from 'react';

type Popover = string | null;

/**
 * Itinéraire bottom bar (mirrors the Studio bottom bar): Couches + Réglages
 * popovers, then the Itinéraire pill that shows/hides the route dock docked
 * below the map (see `RouteDock`). Theme-aware — no `dark` wrapper, so it
 * follows `uiTheme`.
 */
export function RouteBottomBar() {
    const [popover, setPopover] = useState<Popover>(null);

    const bottomOpen = useMapStore((s) => s.bottomOpen);
    const setBottomOpen = useMapStore((s) => s.setBottomOpen);
    const setBottomCollapsed = useMapStore((s) => s.setBottomCollapsed);

    const togglePopover = (id: Exclude<Popover, null>) =>
        setPopover((cur) => (cur === id ? null : id));

    const handleOpenRoute = useCallback(() => {
        setPopover(null);
        // Re-opening from the pill always lands on the full panel — a dock that
        // came back collapsed would look like the click did nothing.
        if (!bottomOpen) setBottomCollapsed(false);
        setBottomOpen(!bottomOpen);
    }, [bottomOpen, setBottomOpen, setBottomCollapsed]);

    return (
        <BottomBar active={popover !== null} onDismiss={() => setPopover(null)}>
            {ROUTE_SETTING_SECTIONS.map((pill) => (
                <BottomBarPill
                    key={pill.id}
                    label={pill.label}
                    Icon={pill.Icon}
                    active={popover === pill.id}
                    onSelect={() => togglePopover(pill.id)}
                >
                    {pill.render()}
                </BottomBarPill>
            ))}
            <div className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/15" />
            <BottomBarButton
                label="Itinéraire"
                Icon={RouteIcon}
                active={bottomOpen}
                onSelect={handleOpenRoute}
            />
        </BottomBar>
    );
}
