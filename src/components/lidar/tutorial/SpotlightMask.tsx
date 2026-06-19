/**
 * Full-screen dimmer that darkens everything except a padded rectangle around
 * the highlighted target, drawing the eye to it with a soft pulsing ring. When
 * `rect` is null (centered/anchor-less step) the whole screen is dimmed evenly.
 *
 * Built entirely from an SVG mask — no external assets, immune to UI drift.
 */
export interface SpotlightMaskProps {
    rect: DOMRect | null;
    /** Extra space around the target included in the cut-out, in px. */
    padding?: number;
}

const HOLE_RADIUS = 12;

export function SpotlightMask({ rect, padding = 8 }: Readonly<SpotlightMaskProps>) {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;

    const hole = rect
        ? {
              x: Math.max(0, rect.left - padding),
              y: Math.max(0, rect.top - padding),
              width: rect.width + padding * 2,
              height: rect.height + padding * 2,
          }
        : null;

    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            width={w}
            height={h}
            aria-hidden="true"
        >
            <defs>
                <mask id="studio-tutorial-spotlight">
                    {/* White = visible (dimmed), black = cut-out (clear). */}
                    <rect x={0} y={0} width={w} height={h} fill="white" />
                    {hole && (
                        <rect
                            x={hole.x}
                            y={hole.y}
                            width={hole.width}
                            height={hole.height}
                            rx={HOLE_RADIUS}
                            ry={HOLE_RADIUS}
                            fill="black"
                        />
                    )}
                </mask>
            </defs>

            <rect
                x={0}
                y={0}
                width={w}
                height={h}
                fill="rgb(2 6 23 / 0.72)"
                mask="url(#studio-tutorial-spotlight)"
            />

            {hole && (
                <rect
                    x={hole.x}
                    y={hole.y}
                    width={hole.width}
                    height={hole.height}
                    rx={HOLE_RADIUS}
                    ry={HOLE_RADIUS}
                    fill="none"
                    stroke="rgb(52 211 153)"
                    strokeWidth={2}
                    className="animate-pulse"
                />
            )}
        </svg>
    );
}
