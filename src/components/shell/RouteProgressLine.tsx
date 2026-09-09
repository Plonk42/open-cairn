import { slopeColor, type ElevationSample } from '@/lib/elevation';
import { formatElevation } from '@/lib/geo';
import { useRouteStore } from '@/stores/routeStore';
import { useEffect, useMemo, useState } from 'react';

/** Width one elevation label needs before the next waypoint overlaps it. */
const LABEL_SLOT_PX = 46;
/** Sample-by-sample colouring turns the rail into confetti: average over bands. */
const RAIL_BANDS = 50;

type RailMarker = { id: string; label: string; ratio: number; elevation: number };

/** Mean slope of each band, from the first and last sample it contains. */
function bandSlopes(samples: ElevationSample[], total: number): number[] {
    const bandLength = total / RAIL_BANDS;
    const first = new Array<number | null>(RAIL_BANDS).fill(null);
    const last = new Array<number | null>(RAIL_BANDS).fill(null);
    for (const sample of samples) {
        const band = Math.min(RAIL_BANDS - 1, Math.floor(sample.distance / bandLength));
        first[band] ??= sample.elevation;
        last[band] = sample.elevation;
    }
    const slopes: number[] = [];
    let previous = 0;
    for (let i = 0; i < RAIL_BANDS; i++) {
        const start = first[i];
        const end = last[i];
        // A band too short to hold two samples keeps its neighbour's slope.
        if (start !== null && end !== null) previous = ((end - start) / bandLength) * 100;
        slopes.push(previous);
    }
    return slopes;
}

/** Hard-stop gradient: one band per run of bands sharing a slope colour. */
function slopeGradient(samples: ElevationSample[], total: number): string {
    const slopes = bandSlopes(samples, total);
    const stops: string[] = [];
    let color = slopeColor(slopes[0]);
    let runStart = 0;
    for (let i = 1; i < RAIL_BANDS; i++) {
        const next = slopeColor(slopes[i]);
        if (next === color) continue;
        const pct = (i / RAIL_BANDS) * 100;
        stops.push(`${color} ${runStart.toFixed(2)}% ${pct.toFixed(2)}%`);
        runStart = pct;
        color = next;
    }
    stops.push(`${color} ${runStart.toFixed(2)}% 100%`);
    return `linear-gradient(to right, ${stops.join(',')})`;
}

function elevationAt(samples: ElevationSample[], distance: number): number {
    return samples.reduce((best, s) => (
        Math.abs(s.distance - distance) < Math.abs(best.distance - distance) ? s : best
    ), samples[0]).elevation;
}

function buildMarkers(
    waypoints: { id: string }[],
    segments: { distance: number }[],
    samples: ElevationSample[],
    total: number,
): RailMarker[] {
    const markers: RailMarker[] = [];
    let cumulative = 0;
    for (let i = 0; i < waypoints.length; i++) {
        markers.push({
            id: waypoints[i].id,
            label: `${i + 1}`,
            ratio: Math.min(1, cumulative / total),
            elevation: elevationAt(samples, cumulative),
        });
        if (i < segments.length) cumulative += segments[i].distance;
    }
    return markers;
}

/**
 * Stand-in for the elevation chart while the dock is collapsed: a flat rail
 * with no vertical axis, so the relief is carried by the slope colours alone.
 * Its own component so the per-frame `hoverDistance` of a flyover doesn't
 * re-render the whole dock.
 */
export function RouteProgressLine() {
    const profile = useRouteStore((s) => s.profile);
    const waypoints = useRouteStore((s) => s.waypoints);
    const routeSegments = useRouteStore((s) => s.routeSegments);
    const hoverDistance = useRouteStore((s) => s.hoverDistance);
    // A ref callback, not a ref: the rail only mounts once the profile exists,
    // long after an effect with an empty dependency list would have run.
    const [rail, setRail] = useState<HTMLDivElement | null>(null);
    const [railWidth, setRailWidth] = useState(0);

    useEffect(() => {
        if (!rail) return;
        const observer = new ResizeObserver(([entry]) => setRailWidth(entry.contentRect.width));
        observer.observe(rail);
        return () => observer.disconnect();
    }, [rail]);

    const total = profile.length >= 2 ? profile.at(-1)!.distance : 0;
    const gradient = useMemo(
        () => (total > 0 ? slopeGradient(profile, total) : ''),
        [profile, total],
    );
    const markers = useMemo(
        () => (total > 0 ? buildMarkers(waypoints, routeSegments, profile, total) : []),
        [waypoints, routeSegments, profile, total],
    );

    if (total <= 0) return null;

    const ratio = hoverDistance === null ? null : Math.max(0, Math.min(1, hoverDistance / total));
    // Elevations are dropped rather than overlapped when the rail is too narrow.
    const showElevations = railWidth >= markers.length * LABEL_SLOT_PX;

    return (
        // The margins hold the half of an end waypoint badge that hangs off the rail.
        <div ref={setRail} className="relative mx-3 h-7 min-w-0 flex-1">
            <div
                className="absolute inset-x-0 bottom-1 h-1.5 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                style={{ background: gradient }}
            />
            {/* Everything past the flyover marker is dimmed instead of overpainted,
                so the slope colours stay readable ahead of the camera. */}
            {ratio !== null && (
                <div
                    className="absolute bottom-1 right-0 h-1.5 rounded-r-full bg-white/65 dark:bg-slate-900/65"
                    style={{ width: `${(1 - ratio) * 100}%` }}
                />
            )}
            {markers.map((marker) => (
                <div
                    key={marker.id}
                    className="absolute bottom-0 -translate-x-1/2"
                    style={{ left: `${marker.ratio * 100}%` }}
                >
                    {showElevations && (
                        <div className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold leading-none text-slate-500 dark:text-slate-400">
                            {formatElevation(marker.elevation)}
                        </div>
                    )}
                    <div
                        className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold leading-none text-white ring-1 ring-white dark:ring-slate-900"
                        title={`Point ${marker.label} — ${formatElevation(marker.elevation)}`}
                    >
                        {marker.label}
                    </div>
                </div>
            ))}
            {ratio !== null && (
                <div
                    className="absolute -bottom-0.5 h-[18px] w-1 -translate-x-1/2 rounded-full bg-orange-500 ring-1 ring-white dark:ring-slate-900"
                    style={{ left: `${ratio * 100}%` }}
                />
            )}
        </div>
    );
}
