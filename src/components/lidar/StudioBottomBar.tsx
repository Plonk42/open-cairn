import { CaptureIcon, PopoverCloseIcon } from '@/components/icons/LidarIcons';
import {
    ResetSettingsButton,
    STUDIO_RENDER_SETTINGS,
    type StudioRenderSettingId,
} from '@/components/lidar/StudioRenderSettings';
import { BottomBar, BottomBarPill } from '@/components/shell/BottomBar';
import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

export type { StudioRenderSettingId } from '@/components/lidar/StudioRenderSettings';

/**
 * Bottom overlay toolbar for the LiDAR Studio: a row of small pills (one per
 * render setting), each toggling a compact popover above it. One open at a
 * time; clicking anywhere outside collapses it. Desktop only.
 *
 * Built on the shared, theme-aware `BottomBar`; wrapped in a `dark` element so
 * it keeps the studio's permanent dark look.
 */
export function StudioBottomBar() {
    const [active, setActive] = useState<StudioRenderSettingId | null>(null);

    const select = (id: StudioRenderSettingId) =>
        setActive((cur) => (cur === id ? null : id));

    return (
        <BottomBar active={active !== null} onDismiss={() => setActive(null)} dataTutorial="render-settings">
            {STUDIO_RENDER_SETTINGS.map((s) => (
                <BottomBarPill
                    key={s.id}
                    label={s.label}
                    Icon={s.Icon}
                    active={s.id === active}
                    onSelect={() => select(s.id)}
                >
                    {s.render()}
                </BottomBarPill>
            ))}
            <div className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/15" />
            <ResetSettingsButton />
        </BottomBar>
    );
}

/**
 * Capture entry point: a large round floating action button pinned to the
 * bottom-right. Pressing it opens the full capture controls (mode, zone
 * dimensions, density, load/clear, progress, stats) AND activates the on-map
 * preview footprint of the zone to load — the preview is hidden until it's
 * pressed. The menu stays open while panning so the zone can be positioned, and
 * only closes via the button or its close control.
 */
export function StudioCaptureButton({ anchorClassName = 'bottom-4 right-4' }: Readonly<{ anchorClassName?: string }>) {
    const [open, setOpen] = useState(false);
    const isMobile = useIsMobile();

    // The load-zone preview footprint is shown only while this menu is open.
    useEffect(() => {
        useMapStore.getState().setLidarPreviewVisible(open);
    }, [open]);
    useEffect(() => () => {
        useMapStore.getState().setLidarPreviewVisible(false);
    }, []);

    // The onboarding tutorial opens this menu (to present the capture modes)
    // and closes it again by dispatching the studio-reveal event.
    useEffect(() => {
        const onReveal = (e: Event) => {
            setOpen((e as CustomEvent<string | null>).detail === 'capture');
        };
        globalThis.addEventListener('open-cairn-studio-reveal', onReveal);
        return () => globalThis.removeEventListener('open-cairn-studio-reveal', onReveal);
    }, []);

    // Close the menu automatically when a LiDAR load completes successfully.
    const loading = useMapStore((s) => s.lidarCloudLoading);
    const loadingError = useMapStore((s) => s.lidarCloudError);
    const prevLoadingRef = useRef(false);
    useEffect(() => {
        if (prevLoadingRef.current && !loading && !loadingError) {
            setOpen(false);
        }
        prevLoadingRef.current = loading;
    }, [loading, loadingError]);

    // On mobile the capture menu floats over the map, so pad the map bottom
    // while it's open — the centred capture footprint + "Charger ici" load point
    // follow the padded screen centre, keeping them in the uncovered area.
    useEffect(() => {
        if (!isMobile) return;
        const map = useMapStore.getState().mapInstance;
        if (!map) return;
        const bottom = open ? Math.round(globalThis.innerHeight * 0.55) : 0;
        map.setPadding({ top: 0, right: 0, bottom, left: 0 });
    }, [open, isMobile]);
    useEffect(() => () => {
        useMapStore.getState().mapInstance?.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    }, []);

    return (
        <div className={`absolute z-30 flex flex-col items-end gap-3 ${anchorClassName}`}>
            {open && (
                <div className={`flex ${isMobile ? 'max-h-[58vh]' : 'max-h-[70vh]'} w-80 flex-col overflow-hidden rounded-xl border border-black/5 bg-white/95 text-slate-800 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:text-slate-100 dark:ring-white/10`}>
                    <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-3 py-2.5 dark:border-white/10">
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Capture</h2>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            title="Fermer"
                            aria-label="Fermer le panneau"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                            <PopoverCloseIcon />
                        </button>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col p-3">
                        <LidarCaptureControls />
                    </div>
                </div>
            )}
            {/* Hide the FAB while the menu is open on mobile so the menu can
                drop into its place — closing is then via the panel's × control. */}
            {!(open && isMobile) && (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        data-tutorial="capture"
                        onClick={() => setOpen((o) => !o)}
                        title="Capturer une zone LiDAR"
                        aria-label="Capturer une zone LiDAR"
                        aria-pressed={open}
                        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1 transition ${open
                            ? 'bg-emerald-400 text-emerald-950 ring-emerald-300'
                            : 'bg-emerald-500 text-white ring-emerald-400/60 hover:bg-emerald-400'}`}
                    >
                        <CaptureIcon className="h-7 w-7" />
                    </button>
                </div>
            )}
        </div>
    );
}
