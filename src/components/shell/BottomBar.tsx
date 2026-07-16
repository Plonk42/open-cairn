import type { IconProps } from '@/components/icons/LidarIcons';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

/**
 * Generic bottom overlay toolbar: a centered, theme-aware row of pills anchored
 * to the bottom of the nearest positioned ancestor. Owns the click-outside
 * dismissal (fires `onDismiss` when a popover is `active` and the user
 * interacts anywhere outside the bar).
 *
 * Light default + `dark:` variants: the LiDAR Studio wraps it in a `dark`
 * element (permanent dark look); the Itinéraire view omits it so it follows
 * `uiTheme` via the document `dark` class.
 */
export function BottomBar({ active, onDismiss, dataTutorial, children }: Readonly<{
    active: boolean;
    onDismiss: () => void;
    dataTutorial?: string;
    children: ReactNode;
}>) {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!active) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) onDismiss();
        };
        globalThis.addEventListener('pointerdown', onPointerDown);
        return () => globalThis.removeEventListener('pointerdown', onPointerDown);
    }, [active, onDismiss]);

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-3">
            <div
                ref={rootRef}
                data-tutorial={dataTutorial}
                className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10"
            >
                {children}
            </div>
        </div>
    );
}

/**
 * A single bottom-bar pill + its anchored popover (shown above when active).
 * Theme-aware; the popover content is provided as `children`.
 */
export function BottomBarPill({ label, Icon, active, onSelect, children }: Readonly<{
    label: string;
    Icon?: (props: IconProps) => ReactElement;
    active: boolean;
    onSelect: () => void;
    children: ReactNode;
}>): ReactElement {
    return (
        <div className="relative">
            {active && (
                <div className="absolute bottom-full left-1/2 mb-2 w-80 -translate-x-1/2 overflow-hidden rounded-xl border border-black/5 bg-white shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10">
                    <div className="scrollbar-slim max-h-[60vh] overflow-y-auto p-3 text-slate-800 dark:text-slate-100">
                        {children}
                    </div>
                </div>
            )}
            <BottomBarButton label={label} Icon={Icon} active={active} onSelect={onSelect} />
        </div>
    );
}

/** A plain bottom-bar pill button (no popover), sharing the pill styling. */
export function BottomBarButton({ label, Icon, active, onSelect, title }: Readonly<{
    label: string;
    Icon?: (props: IconProps) => ReactElement;
    active: boolean;
    onSelect: () => void;
    title?: string;
}>): ReactElement {
    return (
        <button
            type="button"
            onClick={onSelect}
            title={title ?? label}
            aria-label={label}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${active
                ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
                : 'bg-black/5 text-slate-600 ring-black/5 hover:bg-black/10 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/10'}`}
        >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{label}</span>
        </button>
    );
}
