import { LidarAppearanceControls } from '@/components/ui/lidar/LidarAppearanceControls';
import { LidarCaptureControls } from '@/components/ui/lidar/LidarCaptureControls';
import { LidarEffectsControls } from '@/components/ui/lidar/LidarEffectsControls';
import { LidarLightingControls } from '@/components/ui/lidar/LidarLightingControls';
import { useOrbit } from '@/components/ui/lidar/OrbitControl';

export type StudioCategoryId = 'capture' | 'apparence' | 'lumiere' | 'effets';

type IconProps = Readonly<{ className?: string }>;

function CaptureIcon({ className }: IconProps) {
    // Map-pin: "capture this location" — distinct from the download arrow used
    // for "Exporter cette vue".
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
        </svg>
    );
}

function AppearanceIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10 3.75a2 2 0 1 0-1.732 1.975V16.25a.75.75 0 0 0 1.5 0V5.725A2 2 0 0 0 10 3.75ZM3 3.75A.75.75 0 0 0 2.25 4.5v8.025a2 2 0 1 0 1.5 0V4.5A.75.75 0 0 0 3 3.75ZM17 12.025V15.5a.75.75 0 0 1-1.5 0v-3.475a2 2 0 1 1 1.5 0Z" />
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

function EffectsIcon({ className }: IconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
        </svg>
    );
}

function OrbitIcon({ className }: IconProps) {
    // Orbit ring + central body + satellite — an "auto-orbit camera" metaphor
    // that reads clearly differently from a refresh/reload arrow loop.
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
            <ellipse cx="10" cy="10" rx="8" ry="3.4" stroke="currentColor" strokeWidth="1.4" transform="rotate(-30 10 10)" />
            <circle cx="10" cy="10" r="3" fill="currentColor" />
            <circle cx="16.5" cy="6.2" r="1.3" fill="currentColor" />
        </svg>
    );
}

interface StudioCategory {
    id: StudioCategoryId;
    label: string;
    Icon: (props: IconProps) => React.ReactElement;
    render: () => React.ReactNode;
}

/** Single source of truth for the studio settings categories. */
export const STUDIO_CATEGORIES: ReadonlyArray<StudioCategory> = [
    // Capture shows live progress at the bottom of the panel (hidden when the
    // panel is collapsed) plus the final stats — no duplicated floating cluster.
    { id: 'capture', label: 'Capture', Icon: CaptureIcon, render: () => <LidarCaptureControls /> },
    { id: 'apparence', label: 'Apparence', Icon: AppearanceIcon, render: () => <LidarAppearanceControls /> },
    { id: 'lumiere', label: 'Lumière', Icon: LightIcon, render: () => <LidarLightingControls /> },
    { id: 'effets', label: 'Effets', Icon: EffectsIcon, render: () => <LidarEffectsControls /> },
];

const RAIL_BTN_BASE = 'flex h-9 w-9 items-center justify-center rounded-md transition';

function RailButton({ category, active, onSelect }: Readonly<{
    category: StudioCategory;
    active: boolean;
    onSelect: (id: StudioCategoryId) => void;
}>) {
    const { Icon, label, id } = category;
    return (
        <button
            type="button"
            onClick={() => onSelect(id)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={`${RAIL_BTN_BASE} ${active
                ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
        >
            <Icon className="h-5 w-5" />
        </button>
    );
}

/** Orbit auto toggle for the top bar, sitting beside "Galerie" / "Exporter cette vue". */
export function OrbitTopBarButton() {
    const { orbiting, setOrbiting } = useOrbit();
    return (
        <button
            type="button"
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

function CloseChevron() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
        </svg>
    );
}

function StudioCategoryPanel({ category, onClose }: Readonly<{ category: StudioCategory; onClose: () => void }>) {
    return (
        <div className="flex w-80 flex-col border-r border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                <h2 className="text-sm font-semibold text-white">{category.label}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    title="Réduire le panneau"
                    aria-label="Réduire le panneau"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10"
                >
                    <CloseChevron />
                </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-3">{category.render()}</div>
        </div>
    );
}

/** Desktop: a right-edge icon rail (always visible) + the active category panel, flush together. */
function StudioSettingsRail({ active, onSelect }: Readonly<{
    active: StudioCategoryId | null;
    onSelect: (id: StudioCategoryId) => void;
}>) {
    const activeCategory = STUDIO_CATEGORIES.find((c) => c.id === active) ?? null;
    return (
        <div className="pointer-events-none absolute right-0 top-14 z-20 flex flex-col items-end gap-2">
            <div className="dark pointer-events-auto flex overflow-hidden rounded-l-xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                {activeCategory && <StudioCategoryPanel category={activeCategory} onClose={() => onSelect(activeCategory.id)} />}
                <div className="flex flex-col items-center gap-1 p-1.5">
                    {STUDIO_CATEGORIES.map((c) => (
                        <RailButton key={c.id} category={c} active={c.id === active} onSelect={onSelect} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function SheetTabButton({ category, active, onSelect }: Readonly<{
    category: StudioCategory;
    active: boolean;
    onSelect: (id: StudioCategoryId) => void;
}>) {
    const { Icon, label, id } = category;
    return (
        <button
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={active}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium transition ${active
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'text-slate-300 hover:bg-white/10'}`}
        >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
        </button>
    );
}

function SheetOrbitTabButton() {
    const { orbiting, setOrbiting } = useOrbit();
    return (
        <button
            type="button"
            onClick={() => setOrbiting((o) => !o)}
            aria-pressed={orbiting}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium transition ${orbiting
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'text-slate-300 hover:bg-white/10'}`}
        >
            <OrbitIcon className="h-5 w-5" />
            <span>Orbite</span>
        </button>
    );
}

/** Mobile: a bottom tab bar + a slide-up sheet for the active category. */
function StudioSettingsSheet({ active, onSelect }: Readonly<{
    active: StudioCategoryId | null;
    onSelect: (id: StudioCategoryId) => void;
}>) {
    const activeCategory = STUDIO_CATEGORIES.find((c) => c.id === active) ?? null;
    return (
        <div className="dark pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col text-slate-100">
            {activeCategory && (
                <div className="pointer-events-auto mx-2 mb-1 flex max-h-[55vh] flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950/90 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                        <h2 className="text-sm font-semibold text-white">{activeCategory.label}</h2>
                        <button
                            type="button"
                            onClick={() => onSelect(activeCategory.id)}
                            title="Fermer"
                            aria-label="Fermer le panneau"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                            </svg>
                        </button>
                    </div>
                    <div className="overflow-y-auto p-3">{activeCategory.render()}</div>
                </div>
            )}
            <div className="pointer-events-auto flex items-stretch gap-1 border-t border-white/10 bg-slate-950/90 px-1 py-1 backdrop-blur-md">
                {STUDIO_CATEGORIES.map((c) => (
                    <SheetTabButton key={c.id} category={c} active={c.id === active} onSelect={onSelect} />
                ))}
                <SheetOrbitTabButton />
            </div>
        </div>
    );
}

/** Studio settings entry point: right-edge rail on desktop, bottom sheet on mobile. */
export function StudioSettings({ isMobile, active, onSelect }: Readonly<{
    isMobile: boolean;
    active: StudioCategoryId | null;
    onSelect: (id: StudioCategoryId) => void;
}>) {
    return isMobile
        ? <StudioSettingsSheet active={active} onSelect={onSelect} />
        : <StudioSettingsRail active={active} onSelect={onSelect} />;
}
