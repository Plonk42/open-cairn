import { LAS_CLASS_COLORS } from '@/lib/lidarCloud';
import { useMemo } from 'react';

export interface ClassChoice {
    id: number;
    label: string;
    hint?: string;
}

function rgbCss([r, g, b]: readonly [number, number, number]): string {
    return `rgb(${r},${g},${b})`;
}

/**
 * Class-filter chip group used by the LiDAR + Cliff-slice panels. Each chip
 * shows a colored dot (LAS class palette), an optional tooltip, and toggles
 * its class id on click.
 */
export function ClassFilterChips({
    choices,
    selected,
    onToggle,
    disabled = false,
}: Readonly<{
    choices: ReadonlyArray<ClassChoice>;
    selected: readonly number[];
    onToggle: (cls: number) => void;
    disabled?: boolean;
}>) {
    const sel = useMemo(() => new Set(selected), [selected]);
    return (
        <div className="flex flex-wrap gap-1">
            {choices.map((c) => {
                const on = sel.has(c.id);
                const color = LAS_CLASS_COLORS[c.id] ?? [180, 180, 180];
                let chipCls: string;
                if (disabled) {
                    chipCls = 'cursor-not-allowed bg-slate-50 text-slate-300 ring-slate-100 dark:bg-slate-900 dark:text-slate-600 dark:ring-slate-800';
                } else if (on) {
                    chipCls = 'bg-green-600 text-white ring-green-700';
                } else {
                    chipCls = 'bg-slate-100 text-slate-600 ring-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700';
                }
                return (
                    <button
                        key={c.id}
                        type="button"
                        title={c.hint}
                        onClick={() => onToggle(c.id)}
                        disabled={disabled}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${chipCls}`}
                    >
                        <span
                            className="inline-block h-2 w-2 rounded-full ring-1 ring-black/10"
                            style={{ background: rgbCss(color) }}
                        />
                        {c.label}
                    </button>
                );
            })}
        </div>
    );
}
