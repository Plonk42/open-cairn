import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { useOrbit } from '@/components/ui/lidar/OrbitControl';
import { CaptureIcon, OrbitIcon, PopoverCloseIcon } from '@/components/icons/LidarIcons';
import {
    BottomBarItem,
    QuickBasemapSwitch,
    ResetSettingsButton,
    STUDIO_RENDER_SETTINGS,
    type StudioRenderSettingId,
} from '@/components/lidar/StudioRenderSettings';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

export type { StudioRenderSettingId } from '@/components/lidar/StudioRenderSettings';

/**
 * Bottom overlay toolbar for the LiDAR Studio: a row of small pills (one per
 * render setting), each toggling a compact popover above it. One open at a
 * time; clicking anywhere outside collapses it. Desktop only.
 */
export function StudioBottomBar() {
    const [active, setActive] = useState<StudioRenderSettingId | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const select = (id: StudioRenderSettingId) =>
        setActive((cur) => (cur === id ? null : id));

    // Collapse the open popover on any outside interaction (map, top bar, …).
    useEffect(() => {
        if (!active) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setActive(null);
        };
        globalThis.addEventListener('pointerdown', onPointerDown);
        return () => globalThis.removeEventListener('pointerdown', onPointerDown);
    }, [active]);

    return (
        <div className="dark pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-3 text-slate-100">
            <div
                ref={rootRef}
                data-tutorial="render-settings"
                className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/85 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
            >
                <QuickBasemapSwitch />
                <div className="mx-0.5 h-6 w-px bg-white/15" />
                {STUDIO_RENDER_SETTINGS.map((s) => (
                    <BottomBarItem key={s.id} setting={s} active={s.id === active} onSelect={select} />
                ))}
                <div className="mx-0.5 h-6 w-px bg-white/15" />
                <ResetSettingsButton />
            </div>
        </div>
    );
}

/** Orbit auto toggle for the top bar, sitting beside "Galerie" / "Exporter cette vue". */
export function OrbitTopBarButton() {
    const { orbiting, setOrbiting } = useOrbit();
    return (
        <button
            type="button"
            data-tutorial="orbit"
            onClick={() => setOrbiting((o) => !o)}
            title="Orbite automatique autour du LiDAR"
            aria-label="Orbite automatique autour du LiDAR"
            aria-pressed={orbiting}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${orbiting
                ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                : 'bg-white/5 text-slate-200 ring-white/15 hover:bg-white/10'}`}
        >
            <OrbitIcon className="h-4 w-4" />
            <span>Orbite</span>
        </button>
    );
}

/**
 * Capture entry point: a large round floating action button pinned to the
 * bottom-right. Pressing it opens the full capture controls (mode, radius,
 * density, load/clear, progress, stats) AND activates the on-map preview
 * footprint of the zone to load — the preview is hidden until it's pressed.
 * The menu stays open while panning so the zone can be positioned, and only
 * closes via the button or its close control.
 */
export function StudioCaptureButton() {
    const [open, setOpen] = useState(false);

    // The load-zone preview footprint is shown only while this menu is open.
    useEffect(() => {
        useMapStore.getState().setLidarPreviewVisible(open);
    }, [open]);
    useEffect(() => () => useMapStore.getState().setLidarPreviewVisible(false), []);

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

    return (
        <div className="absolute bottom-4 right-4 z-30 flex flex-col items-end gap-3">
            {open && (
                <div className="dark flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2.5">
                        <h2 className="text-sm font-semibold text-white">Capture</h2>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            title="Fermer"
                            aria-label="Fermer le panneau"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10"
                        >
                            <PopoverCloseIcon />
                        </button>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col p-3">
                        <LidarCaptureControls />
                    </div>
                </div>
            )}
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
        </div>
    );
}
