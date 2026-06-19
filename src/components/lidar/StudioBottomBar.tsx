import {
    ClassFilterSection,
    OpacityControls,
    PointSizeControls,
    ShaderControls,
} from '@/components/ui/lidar/LidarAppearanceControls';
import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { LidarEffectsControls } from '@/components/ui/lidar/LidarEffectsControls';
import { BoundShadowControls, SunControls } from '@/components/ui/lidar/LidarLightingControls';
import { useOrbit } from '@/components/ui/lidar/OrbitControl';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

export type StudioRenderSettingId =
    | 'opacite'
    | 'classes'
    | 'points'
    | 'shader'
    | 'lumiere'
    | 'ombres'
    | 'edl';

type IconProps = Readonly<{ className?: string }>;

// ── Icons (20×20, heroicons-mini style) ──────────────────────────────────────

function OpacityIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 3a7 7 0 0 0 0 14V3Z" fill="currentColor" />
        </svg>
    );
}

function ClassesIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10 1.5 2 5.5l8 4 8-4-8-4Z" />
            <path d="M2.5 9.5 10 13.25 17.5 9.5l1.5.75-9 4.5-9-4.5 1.5-.75Z" opacity="0.55" />
        </svg>
    );
}

function ShaderIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.36-.6-.36-.99 0-.83.67-1.5 1.5-1.5H14a4 4 0 0 0 4-4c0-3.87-3.58-6-8-6Zm-4.5 8a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm2.5-3.5A1.25 1.25 0 1 1 8 4a1.25 1.25 0 0 1 0 2.5Zm4 0A1.25 1.25 0 1 1 12 4a1.25 1.25 0 0 1 0 2.5Zm2.5 3.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" clipRule="evenodd" />
        </svg>
    );
}

function SizeIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <circle cx="5.5" cy="14.5" r="1.2" />
            <circle cx="10" cy="11" r="1.8" />
            <circle cx="15" cy="6" r="2.6" />
        </svg>
    );
}

function LightIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.061 1.06l1.06 1.06Z" />
        </svg>
    );
}

function ShadowIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={className} aria-hidden="true">
            <ellipse cx="12.5" cy="14" rx="5.5" ry="2" fill="currentColor" opacity="0.4" />
            <circle cx="8" cy="8" r="5" fill="currentColor" />
        </svg>
    );
}

function EffectsIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
        </svg>
    );
}

function CaptureIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
            <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
            <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
            <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
    );
}

function OrbitIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
            <ellipse cx="10" cy="10" rx="8" ry="3.4" stroke="currentColor" strokeWidth="1.4" transform="rotate(-30 10 10)" />
            <circle cx="10" cy="10" r="3" fill="currentColor" />
            <circle cx="16.5" cy="6.2" r="1.3" fill="currentColor" />
        </svg>
    );
}

function ResetIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h1.103a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v2.715a.75.75 0 0 0 1.5 0v-.964l.31.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V4.456a.75.75 0 0 0-1.5 0v.964l-.31-.311A7 7 0 0 0 3.239 8.247a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.17l.311.31h-1.103a.75.75 0 0 0 0 1.5h2.716a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Render-settings registry ──────────────────────────────────────────────────

interface StudioRenderSetting {
    id: StudioRenderSettingId;
    label: string;
    Icon: (props: IconProps) => React.ReactElement;
    render: () => React.ReactNode;
}

/** Single source of truth for the bottom-bar render settings (one per button). */
const STUDIO_RENDER_SETTINGS: ReadonlyArray<StudioRenderSetting> = [
    { id: 'opacite', label: 'Opacité', Icon: OpacityIcon, render: () => <OpacityControls /> },
    { id: 'classes', label: 'Classes', Icon: ClassesIcon, render: () => <ClassFilterSection /> },
    { id: 'points', label: 'Points', Icon: SizeIcon, render: () => <PointSizeControls /> },
    { id: 'shader', label: 'Shader', Icon: ShaderIcon, render: () => <ShaderControls /> },
    { id: 'lumiere', label: 'Lumière', Icon: LightIcon, render: () => <SunControls /> },
    { id: 'ombres', label: 'Ombres', Icon: ShadowIcon, render: () => <BoundShadowControls /> },
    { id: 'edl', label: 'EDL', Icon: EffectsIcon, render: () => <LidarEffectsControls /> },
];

function PopoverCloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
    );
}

const BASEMAPS: ReadonlyArray<{ id: 'ortho' | 'plan'; label: string }> = [
    { id: 'ortho', label: 'Photo' },
    { id: 'plan', label: 'Plan' },
];

function QuickBasemapSwitch() {
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

/** A single bottom-bar pill + its anchored popover (shown above when active). */
function BottomBarItem({ setting, active, onSelect }: Readonly<{
    setting: StudioRenderSetting;
    active: boolean;
    onSelect: (id: StudioRenderSettingId) => void;
}>) {
    const { Icon, label, id } = setting;
    return (
        <div className="relative">
            {active && (
                <div className="absolute bottom-full left-1/2 mb-2 w-80 -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="scrollbar-slim max-h-[60vh] overflow-y-auto p-3">{setting.render()}</div>
                </div>
            )}
            <button
                type="button"
                onClick={() => onSelect(id)}
                title={label}
                aria-label={label}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${active
                    ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40'
                    : 'bg-white/5 text-slate-200 ring-white/15 hover:bg-white/10'}`}
            >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
            </button>
        </div>
    );
}

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

/** Resets every LiDAR render setting (opacity, classes, shader, lighting…) to defaults. */
function ResetSettingsButton() {
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
