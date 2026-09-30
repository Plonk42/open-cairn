import { ChevronDownIcon } from '@/components/icons/LidarIcons';
import { shiftSunDatePart, todaySunDatePart } from '@/lib/sun';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

/** Width of one day on the date tape: over two months across the sky menu. */
const PX_PER_DAY = 3;
/** Width of one minute on the time tape: about four and a half hours across the sky menu. */
const PX_PER_MINUTE = 0.75;
/** Tape drawn either side of the centre: wider than any panel hosting it. */
const HALF_SPAN_PX = 240;
/** Holding an arrow: pause before it repeats, then one step per tick. */
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 70;
const MINUTES_PER_DAY = 1440;

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FULL_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const EDGE_FADE = 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)';

/** A label, or a dot when `label` is null, `offset` tape units from the centre. */
interface TapeMark {
    offset: number;
    label: string | null;
}

/** Everything that tells the date tape from the time tape. */
interface TapeSpec {
    marks: TapeMark[];
    pxPerUnit: number;
    buttonStep: number;
    keyStep: number;
    shiftKeyStep: number;
    label: string;
    title: string;
    prevLabel: string;
    nextLabel: string;
    valueMin: number;
    valueMax: number;
    valueNow: number;
    valueText: string;
}

function utcDay(datePart: string): Date {
    return new Date(`${datePart}T00:00:00Z`);
}

/** A month name on the 1st (with the year in January), a dot mid-month. */
function dateMarks(datePart: string): TapeMark[] {
    const marks: TapeMark[] = [];
    const halfSpan = Math.ceil(HALF_SPAN_PX / PX_PER_DAY);
    for (let k = -halfSpan; k <= halfSpan; k++) {
        const day = utcDay(shiftSunDatePart(datePart, k));
        const dom = day.getUTCDate();
        if (dom === 1) {
            const month = MONTH_FMT.format(day);
            marks.push({ offset: k, label: day.getUTCMonth() === 0 ? `${month} ${day.getUTCFullYear()}` : month });
        } else if (dom === 16) {
            marks.push({ offset: k, label: null });
        }
    }
    return marks;
}

/** Every hour labelled (the date at midnight, since the tape rolls over), a dot on the half hour. */
function timeMarks(datePart: string, minutesOfDay: number): TapeMark[] {
    const marks: TapeMark[] = [];
    const halfSpan = HALF_SPAN_PX / PX_PER_MINUTE;
    const first = Math.ceil((minutesOfDay - halfSpan) / 30) * 30;
    for (let t = first; t <= minutesOfDay + halfSpan; t += 30) {
        const days = Math.floor(t / MINUTES_PER_DAY);
        const tod = t - days * MINUTES_PER_DAY;
        let label: string | null = null;
        if (tod === 0) label = DAY_FMT.format(utcDay(shiftSunDatePart(datePart, days)));
        else if (tod % 60 === 0) label = `${tod / 60}h`;
        marks.push({ offset: t - minutesOfDay, label });
    }
    return marks;
}

function dayOfYear(datePart: string): number {
    const day = utcDay(datePart);
    return Math.round((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

/** Press-and-hold stepping: one step at once, then a steady scroll until release. */
function useHoldRepeat(onShift: (units: number) => void, disabled: boolean) {
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const shiftRef = useRef(onShift);
    shiftRef.current = onShift;

    const stop = useCallback(() => {
        globalThis.clearTimeout(timer.current);
        timer.current = undefined;
    }, []);

    const start = useCallback((units: number) => {
        stop();
        shiftRef.current(units);
        const tick = (delay: number) => {
            timer.current = globalThis.setTimeout(() => {
                shiftRef.current(units);
                tick(HOLD_REPEAT_MS);
            }, delay);
        };
        tick(HOLD_DELAY_MS);
    }, [stop]);

    // A disabled button never sees its pointerup.
    useEffect(() => {
        if (disabled) stop();
    }, [disabled, stop]);
    useEffect(() => stop, [stop]);

    return { start, stop };
}

function StepButton({ units, label, hold, onShift }: Readonly<{
    units: number;
    label: string;
    hold: ReturnType<typeof useHoldRepeat>;
    onShift: (units: number) => void;
}>) {
    return (
        <button
            type="button"
            aria-label={label}
            title={`${label} — maintenir pour faire défiler`}
            onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                hold.start(units);
            }}
            onPointerUp={hold.stop}
            onPointerLeave={hold.stop}
            onPointerCancel={hold.stop}
            onContextMenu={(e) => e.preventDefault()}
            // Keyboard activation only: a pointer press already stepped on pointerdown.
            onClick={(e) => {
                if (e.detail === 0) onShift(units);
            }}
            className="flex h-7 w-6 flex-shrink-0 touch-manipulation select-none items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
            <ChevronDownIcon className={`h-3.5 w-3.5 ${units < 0 ? 'rotate-90' : '-rotate-90'}`} />
        </button>
    );
}

/**
 * PeakFinder-style tape: drag it, or hold an arrow, and the value scrolls
 * under the centre marker — the sky tracks and the lighting follow live.
 */
function SunTape({ spec, disabled, onShift }: Readonly<{
    spec: TapeSpec;
    disabled: boolean;
    onShift: (units: number) => void;
}>) {
    const hold = useHoldRepeat(onShift, disabled);
    const drag = useRef<{ pointerId: number; startX: number; units: number } | null>(null);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        // A second finger must not restart the drag from where it landed.
        if (disabled || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        drag.current = { pointerId: e.pointerId, startX: e.clientX, units: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d?.pointerId !== e.pointerId) return;
        // Dragging the tape leftwards brings later values under the marker.
        const units = Math.round((d.startX - e.clientX) / spec.pxPerUnit);
        if (units === d.units) return;
        onShift(units - d.units);
        d.units = units;
    };
    const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== e.pointerId) return;
        drag.current = null;
        // pointercancel has already released the capture.
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? spec.shiftKeyStep : spec.keyStep;
        onShift(e.key === 'ArrowLeft' ? -step : step);
    };

    return (
        <div className="flex items-center gap-1">
            <StepButton units={-spec.buttonStep} label={spec.prevLabel} hold={hold} onShift={onShift} />
            <div
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={spec.label}
                aria-valuemin={spec.valueMin}
                aria-valuemax={spec.valueMax}
                aria-valuenow={spec.valueNow}
                aria-valuetext={spec.valueText}
                aria-disabled={disabled}
                title={spec.title}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onKeyDown}
                className={`relative h-7 min-w-0 flex-1 touch-pan-y select-none overflow-hidden rounded-md bg-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-green-500 dark:bg-slate-800 ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
            >
                <div className="absolute inset-0" style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}>
                    {spec.marks.map(({ offset, label }) => (
                        <span
                            key={offset}
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
                            style={{ left: `calc(50% + ${offset * spec.pxPerUnit}px)` }}
                        >
                            {label === null
                                ? <span className="block h-1 w-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                                : <span className="text-[11px] text-slate-600 dark:text-slate-300">{label}</span>}
                        </span>
                    ))}
                </div>
                <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-1.5 w-0.5 -translate-x-1/2 bg-green-600" />
                <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-green-600" />
            </div>
            <StepButton units={spec.buttonStep} label={spec.nextLabel} hold={hold} onShift={onShift} />
        </div>
    );
}

/** Scrolls the date day by day, the hour held fixed: the seasonal drift of the sun and moon. */
export function SunDateTape({ datePart, disabled, onShiftDays }: Readonly<{
    datePart: string;
    disabled: boolean;
    onShiftDays: (days: number) => void;
}>) {
    const date = datePart || todaySunDatePart();
    const spec: TapeSpec = {
        marks: dateMarks(date),
        pxPerUnit: PX_PER_DAY,
        buttonStep: 1,
        keyStep: 1,
        shiftKeyStep: 7,
        label: 'Faire défiler la date',
        title: 'Glisser pour faire défiler la date, l’heure reste fixe (← / →, Maj : une semaine)',
        prevLabel: 'Jour précédent',
        nextLabel: 'Jour suivant',
        valueMin: 1,
        valueMax: 366,
        valueNow: dayOfYear(date),
        valueText: FULL_FMT.format(utcDay(date)),
    };
    return <SunTape spec={spec} disabled={disabled} onShift={onShiftDays} />;
}

/** Scrolls the time of day; past midnight it rolls onto the next or previous day. */
export function SunTimeTape({ datePart, minutesOfDay, disabled, onShiftMinutes }: Readonly<{
    datePart: string;
    minutesOfDay: number;
    disabled: boolean;
    onShiftMinutes: (minutes: number) => void;
}>) {
    const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const mm = String(minutesOfDay % 60).padStart(2, '0');
    const spec: TapeSpec = {
        marks: timeMarks(datePart || todaySunDatePart(), minutesOfDay),
        pxPerUnit: PX_PER_MINUTE,
        buttonStep: 5,
        keyStep: 1,
        shiftKeyStep: 15,
        label: 'Faire défiler l’heure',
        title: 'Glisser pour faire défiler l’heure, minuit passe au jour voisin (← / → : une minute, Maj : un quart d’heure)',
        prevLabel: '5 minutes plus tôt',
        nextLabel: '5 minutes plus tard',
        valueMin: 0,
        valueMax: MINUTES_PER_DAY - 1,
        valueNow: minutesOfDay,
        valueText: `${hh}:${mm}`,
    };
    return <SunTape spec={spec} disabled={disabled} onShift={onShiftMinutes} />;
}
