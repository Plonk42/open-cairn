import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    title?: string;
    icon?: ReactNode;
    /** Greyed out and unselectable (e.g. a layer needing a missing API key). */
    disabled?: boolean;
}

/**
 * Horizontal segmented button group (single-select). The first/last segments
 * are rounded; the active one is filled green. `iconOnly` drops the labels of
 * options that carry an icon.
 */
export function SegmentedControl<T extends string>({ value, options, onChange, iconOnly = false }: Readonly<{
    value: T;
    options: ReadonlyArray<SegmentOption<T>>;
    onChange: (value: T) => void;
    iconOnly?: boolean;
}>) {
    return (
        <fieldset className="inline-flex rounded-md ring-1 ring-slate-200 dark:ring-slate-600">
            {options.map((opt, i) => {
                let roundCls = '';
                if (i === 0) roundCls = 'rounded-l-md';
                else if (i === options.length - 1) roundCls = 'rounded-r-md';
                const activeCls = opt.value === value
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
                const hideLabel = iconOnly && opt.icon !== undefined;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        disabled={opt.disabled}
                        onClick={() => onChange(opt.value)}
                        title={opt.title}
                        aria-label={hideLabel ? opt.label : undefined}
                        className={`${roundCls} flex items-center justify-center gap-1 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${hideLabel ? 'px-2' : 'px-2.5'} ${activeCls}`}
                    >
                        {opt.icon}
                        {!hideLabel && opt.label}
                    </button>
                );
            })}
        </fieldset>
    );
}
