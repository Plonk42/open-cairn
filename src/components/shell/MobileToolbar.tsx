import { type IconProps } from '@/components/icons/LidarIcons';
import { type ReactElement, type ReactNode } from 'react';

/** One entry in the mobile toolbar: a pill that opens a bottom sheet. */
export interface MobileTool {
    id: string;
    label: string;
    Icon?: (props: IconProps) => ReactElement;
    render: () => ReactNode;
    /** Optional tooltip / disabled hint. */
    title?: string;
}

function ToolButton({ tool, active, onSelect }: Readonly<{ tool: MobileTool; active: boolean; onSelect: () => void }>) {
    const { label, Icon, title } = tool;
    const tone = active
        ? 'bg-green-600/10 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        : 'text-slate-500 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/5';
    return (
        <button
            type="button"
            onClick={onSelect}
            title={title ?? label}
            aria-label={label}
            aria-pressed={active}
            className={`flex min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium leading-none transition ${tone}`}
        >
            {Icon && <Icon className="h-5 w-5" />}
            <span>{label}</span>
        </button>
    );
}

/**
 * Generic mobile bottom toolbar: a flush, full-width bar of icon-over-label tab
 * buttons anchored to the bottom edge (horizontally scrollable to reveal all
 * buttons), plus a bottom sheet that shows the active tool's content above it.
 * The sheet hugs its content up to a max height, so a small menu stays small.
 * One tool open at a time; tapping the active button (or the sheet's grabber
 * handle) collapses it.
 *
 * Theme-aware (light default + `dark:` variants). Composed per-view: the
 * Itinéraire and Studio mobile shells each pass their own `tools`, plus optional
 * `leading` (e.g. the Studio basemap switch) and `trailing` (e.g. reset) nodes.
 */
export function MobileToolbar({ tools, activeId, onSelect, leading, trailing }: Readonly<{
    tools: ReadonlyArray<MobileTool>;
    activeId: string | null;
    onSelect: (id: string) => void;
    leading?: ReactNode;
    trailing?: ReactNode;
}>) {
    const active = tools.find((t) => t.id === activeId) ?? null;

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col">
            {active && (
                <div className="pointer-events-auto flex max-h-[70vh] flex-col overflow-hidden border-t border-black/10 bg-white/95 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90">
                    <button
                        type="button"
                        onClick={() => onSelect(active.id)}
                        title="Fermer"
                        aria-label={`Fermer ${active.label}`}
                        className="group flex shrink-0 items-center justify-center py-2.5"
                    >
                        <span className="h-1.5 w-10 rounded-full bg-slate-300 transition group-hover:bg-slate-400 dark:bg-white/25 dark:group-hover:bg-white/40" />
                    </button>
                    <div className="scrollbar-slim min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-1 text-slate-800 dark:text-slate-100">
                        {active.render()}
                    </div>
                </div>
            )}

            <div className="scrollbar-slim safe-bottom pointer-events-auto flex items-stretch gap-1 overflow-x-auto border-t border-black/10 bg-white/95 px-1.5 py-1 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90">
                {leading && <div className="flex shrink-0 items-center">{leading}</div>}
                {tools.map((tool) => (
                    <ToolButton key={tool.id} tool={tool} active={tool.id === activeId} onSelect={() => onSelect(tool.id)} />
                ))}
                {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
            </div>
        </div>
    );
}
