import { type IconProps, PopoverCloseIcon } from '@/components/icons/LidarIcons';
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

function ToolPill({ tool, active, onSelect }: Readonly<{ tool: MobileTool; active: boolean; onSelect: () => void }>) {
    const { label, Icon, title } = tool;
    const tone = active
        ? 'bg-green-600/10 text-green-700 ring-green-600/30 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-400/40'
        : 'bg-black/5 text-slate-600 ring-black/5 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15';
    return (
        <button
            type="button"
            onClick={onSelect}
            title={title ?? label}
            aria-label={label}
            aria-pressed={active}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition ${tone}`}
        >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{label}</span>
        </button>
    );
}

/**
 * Generic mobile bottom toolbar: a horizontally-scrollable row of pills anchored
 * to the bottom of the screen, plus a bottom sheet that shows the active tool's
 * content above it. The sheet hugs its content up to a max height, so a small
 * menu stays small. One tool open at a time; tapping the active pill (or the
 * sheet's × control) collapses it.
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
                <div className="pointer-events-auto mx-2 mb-1.5 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-black/5 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 dark:ring-white/10">
                    <div className="flex shrink-0 items-center justify-between border-b border-black/5 py-2 pl-3 pr-1 dark:border-white/10">
                        <span className="text-sm font-semibold text-slate-800 dark:text-white">{active.label}</span>
                        <button
                            type="button"
                            onClick={() => onSelect(active.id)}
                            title="Fermer"
                            aria-label="Fermer le panneau"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                            <PopoverCloseIcon className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="scrollbar-slim min-h-0 overflow-y-auto overscroll-contain p-3 text-slate-800 dark:text-slate-100">
                        {active.render()}
                    </div>
                </div>
            )}

            <div className="scrollbar-slim safe-bottom pointer-events-auto mx-2 mb-2 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-black/5 bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/85 dark:ring-white/10">
                {leading && <div className="flex shrink-0 items-center">{leading}</div>}
                {tools.map((tool) => (
                    <ToolPill key={tool.id} tool={tool} active={tool.id === activeId} onSelect={() => onSelect(tool.id)} />
                ))}
                {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
            </div>
        </div>
    );
}
