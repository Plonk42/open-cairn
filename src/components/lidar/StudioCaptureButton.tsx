import { CaptureIcon, PopoverCloseIcon } from '@/components/icons/LidarIcons';
import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { STUDIO_REVEAL_EVENT } from './tutorial/steps';

/** Bottom-anchored position of the button, in CSS pixels. */
export interface CaptureButtonAnchor {
    bottom: number;
    right: number;
}

/**
 * Capture entry point, on both chromes: a large round floating action button
 * pinned to the bottom of the map. Pressing it opens the full capture controls
 * (mode, zone dimensions, density, load/clear, progress, stats), activates the
 * on-map preview footprint of the zone to load — hidden until it's pressed —
 * AND arms the draw mode, so the zone is drawn and redrawn straight on the map
 * without any other affordance. « Capturer » ends the drawing; the menu
 * otherwise closes via the button or its close control.
 *
 * Capture is deliberately kept out of the desktop render accordion: one never
 * frames the next capture while tuning the current render, and the green disc
 * reads as *the* action of the studio rather than one setting among thirteen.
 * `hidden` keeps it mounted — and listening to the tutorial — while the render
 * panel is open.
 */
export function StudioCaptureButton({ anchor, hidden = false }: Readonly<{
    anchor: CaptureButtonAnchor;
    hidden?: boolean;
}>): ReactElement | null {
    const [open, setOpen] = useState(false);
    const isMobile = useIsMobile();

    useEffect(() => {
        if (hidden) setOpen(false);
    }, [hidden]);

    // The load-zone preview footprint is shown only while this menu is open.
    // The zone is ground-anchored, so bring it back under the camera when
    // opening the panel would otherwise show dimensions for an off-screen zone.
    useEffect(() => {
        useMapStore.getState().setLidarPreviewVisible(open);
        if (open) useMapStore.getState().ensureCaptureRectVisible();
    }, [open]);
    useEffect(() => () => {
        useMapStore.getState().setLidarPreviewVisible(false);
        useMapStore.getState().setLidarRectDrawActive(false);
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

    // Drawing stays armed for the whole time the panel is open, so a drag
    // replaces the previous rectangle without re-arming anything; pressing
    // « Capturer » is what ends it and gives the camera its pitch back.
    useEffect(() => {
        useMapStore.getState().setLidarRectDrawActive(open && !loading);
    }, [open, loading]);

    // The tutorial spotlights the capture controls, which only exist in the
    // DOM while this menu is open — and closes it again when it moves on to a
    // step revealing another surface (the event carries `null` in between).
    useEffect(() => {
        const onReveal = (e: Event) => setOpen((e as CustomEvent<string | null>).detail === 'capture');
        globalThis.addEventListener(STUDIO_REVEAL_EVENT, onReveal);
        return () => globalThis.removeEventListener(STUDIO_REVEAL_EVENT, onReveal);
    }, []);

    // On a phone the menu covers the bottom half of the screen, so pad the map
    // while it's open — drawing and reviewing the capture rectangle then happen
    // in the uncovered area. On desktop it only clips a bottom corner, and the
    // padding there belongs to `StudioSidePanel`: one `setPadding` call rewrites
    // every edge, so a second writer would wipe the panel's reserved strip.
    useEffect(() => {
        if (!isMobile) return;
        const map = useMapStore.getState().mapInstance;
        if (!map) return;
        const bottom = open ? Math.round(globalThis.innerHeight * 0.55) : 0;
        map.setPadding({ top: 0, right: 0, bottom, left: 0 });
        return () => {
            map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
        };
    }, [open, isMobile]);

    if (hidden) return null;

    return (
        <div
            className="absolute z-30 flex flex-col items-end gap-3"
            style={{ bottom: anchor.bottom, right: anchor.right }}
        >
            {open && (
                <div
                    data-tutorial="capture"
                    className={`flex ${isMobile ? 'max-h-[58vh]' : 'max-h-[70vh]'} w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-black/5 bg-white/95 text-slate-800 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:text-slate-100 dark:ring-white/10`}
                >
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
            {/* On a phone the FAB hides while the menu is open so the menu can
                drop into its place — closing is then via the panel's × control.
                Desktop has the room to keep it as a toggle. */}
            {!(open && isMobile) && (
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    title={open ? 'Fermer la capture' : 'Capturer une zone LiDAR'}
                    aria-label={open ? 'Fermer la capture' : 'Capturer une zone LiDAR'}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-1 ring-emerald-400/60 transition hover:bg-emerald-400"
                >
                    <CaptureIcon className="h-7 w-7" />
                </button>
            )}
        </div>
    );
}
