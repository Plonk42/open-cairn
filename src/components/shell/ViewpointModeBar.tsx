import { ChevronDownIcon, PeakLabelsIcon, PopoverCloseIcon, ViewpointIcon } from '@/components/icons/LidarIcons';
import { PanoramaIcon } from '@/components/shell/routeSections';
import { PEAK_LABELS_HINT, SkyPathSection } from '@/components/ui/LayerSwitcher';
import { isTextEntry } from '@/lib/freeCamera';
import { useIsMobile } from '@/lib/useIsMobile';
import { useView } from '@/lib/useView';
import { eyeHeightAfterStep, VIEWPOINT_EYE_HEIGHT_M, VIEWPOINT_MAX_EYE_HEIGHT_M } from '@/lib/viewpointCamera';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

/** How long the gesture reminder stays under the bar after planting the eye. */
const HINT_MS = 6000;

const CHIP_BASE = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md py-1.5 text-xs font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-40';
const CHIP = `${CHIP_BASE} px-2.5`;
const CHIP_IDLE = 'bg-black/5 text-slate-600 ring-black/5 hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10';
const CHIP_ON = 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40';

function Divider() {
    return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-black/10 dark:bg-white/15" />;
}

function formatHeight(heightM: number): string {
    return heightM.toLocaleString('fr-FR', { maximumFractionDigits: heightM < 10 ? 1 : 0 });
}

function PickingContent({ touch }: Readonly<{ touch: boolean }>) {
    const setPicking = useMapStore((s) => s.setViewpointPicking);
    return (
        <>
            <span className="inline-flex items-center gap-1.5 px-1.5 text-xs font-medium text-slate-700 dark:text-slate-100">
                <ViewpointIcon className="h-4 w-4 text-green-700 dark:text-emerald-300" />
                {touch ? 'Touchez la carte pour vous placer' : 'Cliquez sur la carte pour vous placer'}
            </span>
            <button type="button" onClick={() => setPicking(false)} title="Annuler (Échap)" className={`${CHIP} ${CHIP_IDLE}`}>
                Annuler
            </button>
        </>
    );
}

/** Touch twin of the up/down arrows: the only way to lift the eye on a phone. */
function EyeHeightControl({ compact }: Readonly<{ compact: boolean }>) {
    const heightM = useMapStore((s) => s.viewpointHeightM);
    const setHeightM = useMapStore((s) => s.setViewpointHeightM);
    const step = (up: boolean, fast: boolean) => setHeightM(eyeHeightAfterStep(heightM, up, fast));
    return (
        <div className="inline-flex items-center gap-0.5" title="Hauteur de l’œil au-dessus du sol (flèches ↑/↓, Maj : ×10)">
            <button
                type="button"
                onClick={(e) => step(false, e.shiftKey)}
                disabled={heightM <= VIEWPOINT_EYE_HEIGHT_M}
                aria-label="Descendre l’œil"
                className={`${CHIP_BASE} ${CHIP_IDLE} px-1.5`}
            >
                <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
            <span className={`${compact ? 'min-w-[3rem]' : 'min-w-[4.5rem]'} text-center text-xs tabular-nums text-slate-600 dark:text-slate-300`}>
                {compact ? '' : 'œil '}{formatHeight(heightM)} m
            </span>
            <button
                type="button"
                onClick={(e) => step(true, e.shiftKey)}
                disabled={heightM >= VIEWPOINT_MAX_EYE_HEIGHT_M}
                aria-label="Monter l’œil"
                className={`${CHIP_BASE} ${CHIP_IDLE} px-1.5`}
            >
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
            </button>
        </div>
    );
}

function SkyMenu({ open, setOpen, studio, compact }: Readonly<{
    open: boolean;
    setOpen: (v: boolean) => void;
    studio: boolean;
    compact: boolean;
}>) {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        globalThis.addEventListener('pointerdown', onPointerDown);
        return () => globalThis.removeEventListener('pointerdown', onPointerDown);
    }, [open, setOpen]);

    // On a phone the menu hangs from the whole bar: under the button it would overflow the screen.
    return (
        <div ref={rootRef} className={compact ? '' : 'relative'}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                title="Trajectoires du soleil et de la lune, date et heure"
                className={`${CHIP} ${open ? CHIP_ON : CHIP_IDLE}`}
            >
                <PanoramaIcon className="h-4 w-4" />
                Ciel
                <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute bottom-full left-1/2 z-10 mb-2 w-72 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-black/5 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-950/95 dark:ring-white/10">
                    <div className="scrollbar-slim max-h-[60vh] overflow-y-auto p-3 text-slate-800 dark:text-slate-100">
                        <SkyPathSection studio={studio} />
                    </div>
                </div>
            )}
        </div>
    );
}

function StandingContent({ skyOpen, setSkyOpen, studio, compact }: Readonly<{
    skyOpen: boolean;
    setSkyOpen: (v: boolean) => void;
    studio: boolean;
    compact: boolean;
}>) {
    const peakLabels = useMapStore((s) => s.peakLabels);
    const setPeakLabels = useMapStore((s) => s.setPeakLabels);
    const changePlace = useMapStore((s) => s.changeViewpointPlace);
    const setViewpoint = useMapStore((s) => s.setViewpoint);

    const title = (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 text-xs font-semibold text-green-700 dark:text-emerald-300">
            <ViewpointIcon className="h-4 w-4" />
            Point de vue
        </span>
    );
    const peaks = (
        <button
            type="button"
            onClick={() => setPeakLabels(!peakLabels)}
            aria-pressed={peakLabels}
            title={PEAK_LABELS_HINT}
            className={`${CHIP} ${peakLabels ? CHIP_ON : CHIP_IDLE}`}
        >
            <PeakLabelsIcon className="h-4 w-4" />
            Sommets
        </button>
    );
    const sky = <SkyMenu open={skyOpen} setOpen={setSkyOpen} studio={studio} compact={compact} />;
    const move = (
        <button
            type="button"
            onClick={changePlace}
            title="Choisir un autre endroit où se tenir"
            className={`${CHIP} ${CHIP_IDLE}`}
        >
            Changer de lieu
        </button>
    );
    const quit = (
        <button
            type="button"
            onClick={() => setViewpoint(null)}
            title="Quitter le point de vue (Échap)"
            aria-label="Quitter le point de vue"
            className={`${CHIP} ${CHIP_IDLE}`}
        >
            <PopoverCloseIcon className="h-3.5 w-3.5" />
            {!compact && 'Quitter'}
        </button>
    );

    if (compact) {
        return (
            <div className="flex w-full flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                    {title}
                    <span className="flex-1" />
                    {move}
                    {quit}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <EyeHeightControl compact />
                    {peaks}
                    {sky}
                </div>
            </div>
        );
    }

    return (
        <>
            {title}
            <Divider />
            <EyeHeightControl compact={false} />
            <Divider />
            {peaks}
            {sky}
            <Divider />
            {move}
            {quit}
        </>
    );
}

/** Remounted per standpoint (keyed by the caller), so each one starts with the reminder shown. */
function GestureHint({ touch }: Readonly<{ touch: boolean }>) {
    const [visible, setVisible] = useState(true);
    useEffect(() => {
        const handle = globalThis.setTimeout(() => setVisible(false), HINT_MS);
        return () => globalThis.clearTimeout(handle);
    }, []);
    return (
        <p
            aria-hidden={!visible}
            className={`rounded-md bg-slate-900/70 px-2.5 py-1 text-[11px] text-white shadow backdrop-blur-sm transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
        >
            {touch
                ? 'Glisser : regarder autour · Pincer : focale'
                : 'Glisser : regarder autour · Molette : focale · ↑/↓ : hauteur de l’œil'}
        </p>
    );
}

/**
 * On-map bar of the « Point de vue » mode, shown while it is armed or standing.
 * The mode changes what every gesture does and suspends route editing, so it
 * says so where the user is looking and keeps the way out one click (or Échap)
 * away, instead of behind a folded top-bar group.
 *
 * Unpositioned: each chrome places it at the bottom of its visible map area,
 * the foreground — the top is where the summit names hang.
 */
export function ViewpointModeBar() {
    const viewpoint = useMapStore((s) => s.viewpoint);
    const picking = useMapStore((s) => s.viewpointPicking);
    const { view } = useView();
    const touch = useIsMobile();
    const [skyOpen, setSkyOpen] = useState(false);
    const active = picking || viewpoint !== null;

    useEffect(() => {
        if (!viewpoint) setSkyOpen(false);
    }, [viewpoint]);

    // Échap unwinds one level: the sky menu, then the pick, then the mode.
    useEffect(() => {
        if (!active) return undefined;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || isTextEntry(e.target)) return;
            if (skyOpen) {
                setSkyOpen(false);
                return;
            }
            const s = useMapStore.getState();
            if (s.viewpointPicking) s.setViewpointPicking(false);
            else s.setViewpoint(null);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [active, skyOpen]);

    if (!active) return null;

    return (
        <div className={`pointer-events-auto flex max-w-full flex-col items-center gap-1.5 ${touch ? 'w-full' : ''}`}>
            {viewpoint && !picking && !skyOpen && (
                <GestureHint key={`${viewpoint.lng},${viewpoint.lat}`} touch={touch} />
            )}
            <div className={`relative flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10 ${touch ? 'w-full' : ''}`}>
                {picking
                    ? <PickingContent touch={touch} />
                    : <StandingContent skyOpen={skyOpen} setSkyOpen={setSkyOpen} studio={view === 'lidar'} compact={touch} />}
            </div>
        </div>
    );
}

/** Right edge of MapLibre's bottom-left control column (attribution included), plus a gap. */
const MAP_CONTROLS_GUTTER_PX = 176;

/**
 * Desktop placement of the bar: 12 px above the bottom of the visible map area,
 * centred on it — unless centring would put it over the bottom-left map
 * controls, in which case the left spacer holds its minimum and the bar slides
 * right.
 */
export function DesktopViewpointBarSlot({ bottomPx, rightPx }: Readonly<{ bottomPx: number; rightPx: number }>) {
    return (
        <div className="pointer-events-none absolute left-0 z-30 flex items-end" style={{ bottom: bottomPx + 12, right: rightPx }}>
            <span className="flex-1" style={{ minWidth: MAP_CONTROLS_GUTTER_PX }} />
            <ViewpointModeBar />
            <span className="min-w-3 flex-1" />
        </div>
    );
}
