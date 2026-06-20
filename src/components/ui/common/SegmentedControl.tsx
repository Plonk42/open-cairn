export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    title?: string;
}

/**
 * Horizontal segmented button group (single-select). The first/last segments
 * are rounded; the active one is filled green. Used for the LiDAR capture
 * mode and shader-preset selectors.
 */
export function SegmentedControl<T extends string>({ value, options, onChange }: Readonly<{
    value: T;
    options: ReadonlyArray<SegmentOption<T>>;
    onChange: (value: T) => void;
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
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        title={opt.title}
                        className={`${roundCls} px-2.5 py-1 text-xs ${activeCls}`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </fieldset>
    );
}
