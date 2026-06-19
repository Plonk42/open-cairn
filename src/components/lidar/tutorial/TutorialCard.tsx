import { useLayoutEffect, useRef, useState } from 'react';
import type { TutorialGesture, TutorialPlacement } from './steps';

const CARD_WIDTH = 320;
const GAP = 16;
const MARGIN = 12;

interface Point {
    left: number;
    top: number;
}

/** Splits a `Label — text` / `Label : text` line into its emphasised label and the rest. */
function splitLine(line: string): { label: string; rest: string } {
    const match = /^(.*?)\s*[—:]\s*(.*)$/.exec(line);
    if (!match) return { label: '', rest: line };
    return { label: match[1], rest: match[2] };
}

/** Pure placement maths — kept out of the component to stay simple/testable. */
function computeCardPosition(
    rect: DOMRect | null,
    placement: TutorialPlacement,
    cardW: number,
    cardH: number,
): Point {
    const vw = globalThis.innerWidth;
    const vh = globalThis.innerHeight;

    if (!rect || placement === 'center') {
        return { left: (vw - cardW) / 2, top: (vh - cardH) / 2 };
    }

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const byPlacement: Record<Exclude<TutorialPlacement, 'center'>, Point> = {
        top: { left: cx - cardW / 2, top: rect.top - cardH - GAP },
        bottom: { left: cx - cardW / 2, top: rect.bottom + GAP },
        left: { left: rect.left - cardW - GAP, top: cy - cardH / 2 },
        right: { left: rect.right + GAP, top: cy - cardH / 2 },
    };

    const pos = byPlacement[placement];
    return {
        left: Math.min(Math.max(MARGIN, pos.left), vw - cardW - MARGIN),
        top: Math.min(Math.max(MARGIN, pos.top), vh - cardH - MARGIN),
    };
}

/** Lightweight built-in motion hint (no external media). */
function GestureHint({ gesture }: Readonly<{ gesture: TutorialGesture }>) {
    if (gesture !== 'drag-orbit') return null;
    return (
        <div className="mt-3 flex items-center justify-center rounded-lg bg-white/5 py-3">
            <svg viewBox="0 0 64 40" className="h-10 w-16 text-emerald-300" fill="none" aria-hidden="true">
                <ellipse cx="32" cy="20" rx="22" ry="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                <g>
                    <circle cx="32" cy="20" r="3.5" fill="currentColor">
                        <animateMotion dur="2.4s" repeatCount="indefinite" path="M 0 0 a 22 9 0 1 0 0.1 0" />
                    </circle>
                </g>
            </svg>
        </div>
    );
}

export interface TutorialCardProps {
    rect: DOMRect | null;
    placement: TutorialPlacement;
    title: string;
    body: string;
    lines?: readonly string[];
    gesture?: TutorialGesture;
    stepIndex: number;
    stepCount: number;
    isFirst: boolean;
    isLast: boolean;
    onPrev: () => void;
    onNext: () => void;
    onSkip: () => void;
}

export function TutorialCard({
    rect,
    placement,
    title,
    body,
    lines,
    gesture,
    stepIndex,
    stepCount,
    isFirst,
    isLast,
    onPrev,
    onNext,
    onSkip,
}: Readonly<TutorialCardProps>) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<Point>({ left: -9999, top: -9999 });

    useLayoutEffect(() => {
        const h = ref.current?.offsetHeight ?? 0;
        setPos(computeCardPosition(rect, placement, CARD_WIDTH, h));
    }, [rect, placement, title, body, lines]);

    return (
        <div
            ref={ref}
            className="pointer-events-auto fixed z-[71] w-80 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
            style={{ left: pos.left, top: pos.top }}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{body}</p>
            {lines && lines.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                    {lines.map((line) => {
                        const { label, rest } = splitLine(line);
                        return (
                            <li key={line} className="text-sm leading-relaxed text-slate-300">
                                {label && <span className="font-semibold text-emerald-300">{label} — </span>}
                                {rest}
                            </li>
                        );
                    })}
                </ul>
            )}
            {gesture && <GestureHint gesture={gesture} />}

            <div className="mt-4 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={onSkip}
                    className="text-xs font-medium text-slate-400 transition hover:text-slate-200"
                >
                    Passer
                </button>

                <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-slate-500">
                        {stepIndex + 1} / {stepCount}
                    </span>
                    {!isFirst && (
                        <button
                            type="button"
                            onClick={onPrev}
                            className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/15 transition hover:bg-white/10"
                        >
                            Précédent
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onNext}
                        className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-400"
                    >
                        {isLast ? 'Terminer' : 'Suivant'}
                    </button>
                </div>
            </div>
        </div>
    );
}
