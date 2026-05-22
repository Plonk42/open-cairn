import type { ElevationSample } from '@/lib/elevation';
import { formatDistance, formatElevation } from '@/lib/geo';
import {
    Chart,
    Filler,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip,
    type ChartConfiguration,
    type Plugin,
} from 'chart.js';
import { useEffect, useReducer, useRef } from 'react';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

export type WaypointGraphMarker = Readonly<{
    id: string;
    label: string;
    distance: number;
}>;

export type DashedRange = Readonly<{
    start: number;
    end: number;
    dash: number[];
}>;

type ChartPoint = {
    x: number;
    y: number;
    slope: number;
};

type Selection = {
    start: number;
    end: number;
};

type ElevationChartProps = Readonly<{
    samples: ElevationSample[];
    waypointMarkers: WaypointGraphMarker[];
    dashedRanges: DashedRange[];
    colorBySlope: boolean;
    hoverDistance: number | null;
    selectionRange: [number, number] | null;
    onHoverDistance: (distance: number | null) => void;
    onSelectionChange: (range: [number, number] | null) => void;
    theme: 'light' | 'dark';
}>;

function slopeColor(slope: number): string {
    if (slope <= -12) return '#2563eb';
    if (slope <= -4) return '#38bdf8';
    if (slope < 4) return '#34d399';
    if (slope < 10) return '#facc15';
    if (slope < 18) return '#fb923c';
    return '#ef4444';
}

function nearestSample(samples: ElevationSample[], distance: number): ElevationSample | null {
    if (samples.length === 0) return null;
    return samples.reduce((best, sample) => (
        Math.abs(sample.distance - distance) < Math.abs(best.distance - distance) ? sample : best
    ), samples[0]);
}

function profileMetricsBetween(samples: ElevationSample[], startDistance: number, endDistance: number) {
    const start = Math.min(startDistance, endDistance);
    const end = Math.max(startDistance, endDistance);
    const startSample = nearestSample(samples, start);
    const endSample = nearestSample(samples, end);
    const slice = samples.filter((sample) => sample.distance >= start && sample.distance <= end);
    let ascent = 0;
    let descent = 0;
    for (let i = 1; i < slice.length; i += 1) {
        const delta = slice[i].elevation - slice[i - 1].elevation;
        if (delta > 0) ascent += delta;
        if (delta < 0) descent += Math.abs(delta);
    }
    return startSample && endSample ? {
        distance: end - start,
        elevationDelta: endSample.elevation - startSample.elevation,
        ascent,
        descent,
    } : null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function buildOverlayPlugin(
    samplesRef: React.MutableRefObject<ElevationSample[]>,
    markersRef: React.MutableRefObject<WaypointGraphMarker[]>,
    hoverRef: React.MutableRefObject<number | null>,
    selectionRef: React.MutableRefObject<Selection | null>,
): Plugin<'line'> {
    return {
        id: 'open-cairn-elevation-overlays',
        afterDatasetsDraw(chart) {
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;
            const samples = samplesRef.current;
            const markers = markersRef.current;
            const ctx = chart.ctx;

            ctx.save();

            const selection = selectionRef.current;
            if (selection && Math.abs(selection.start - selection.end) > 1) {
                const leftValue = Math.min(selection.start, selection.end);
                const rightValue = Math.max(selection.start, selection.end);
                const left = xScale.getPixelForValue(leftValue);
                const right = xScale.getPixelForValue(rightValue);
                const metrics = profileMetricsBetween(samples, leftValue, rightValue);

                ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
                ctx.fillRect(left, chart.chartArea.top, right - left, chart.chartArea.bottom - chart.chartArea.top);
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, chart.chartArea.top);
                ctx.lineTo(left, chart.chartArea.bottom);
                ctx.moveTo(right, chart.chartArea.top);
                ctx.lineTo(right, chart.chartArea.bottom);
                ctx.stroke();

                if (metrics) {
                    const boxWidth = 162;
                    const boxHeight = 58;
                    const boxX = Math.min(chart.chartArea.right - boxWidth, Math.max(chart.chartArea.left, left + 8));
                    const boxY = chart.chartArea.top + 8;
                    ctx.fillStyle = 'rgba(2, 6, 23, 0.94)';
                    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
                    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#f8fafc';
                    ctx.font = '700 12px ui-sans-serif, system-ui';
                    ctx.fillText(formatDistance(metrics.distance), boxX + 10, boxY + 17);
                    ctx.fillStyle = '#cbd5e1';
                    ctx.font = '11px ui-sans-serif, system-ui';
                    ctx.fillText(`Delta ${metrics.elevationDelta >= 0 ? '+' : ''}${formatElevation(metrics.elevationDelta)}`, boxX + 10, boxY + 34);
                    ctx.fillStyle = '#94a3b8';
                    ctx.fillText(`+${formatElevation(metrics.ascent)} / -${formatElevation(metrics.descent)}`, boxX + 10, boxY + 49);
                }
            }

            for (const marker of markers) {
                const sample = nearestSample(samples, marker.distance);
                if (!sample) continue;
                const x = xScale.getPixelForValue(marker.distance);
                const y = yScale.getPixelForValue(sample.elevation);
                ctx.setLineDash([2, 5]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chart.chartArea.top);
                ctx.lineTo(x, chart.chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                // Larger bullet with number inside
                const radius = 8;
                ctx.fillStyle = '#0ea5e9';
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.font = '700 9px ui-sans-serif, system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(marker.label, x, y);
                ctx.textBaseline = 'alphabetic';
                // Elevation label above the marker point
                ctx.font = '600 10px ui-sans-serif, system-ui';
                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.lineWidth = 3;
                ctx.strokeText(formatElevation(sample.elevation), x, y - radius - 4);
                ctx.fillStyle = '#1e40af';
                ctx.fillText(formatElevation(sample.elevation), x, y - radius - 4);
                ctx.textAlign = 'start';
            }

            const hoverDistance = hoverRef.current;
            if (hoverDistance !== null) {
                const sample = nearestSample(samples, hoverDistance);
                if (sample) {
                    const x = xScale.getPixelForValue(hoverDistance);
                    const y = yScale.getPixelForValue(sample.elevation);
                    ctx.setLineDash([3, 4]);
                    ctx.strokeStyle = 'rgba(248, 250, 252, 0.75)';
                    ctx.beginPath();
                    ctx.moveTo(x, chart.chartArea.top);
                    ctx.lineTo(x, chart.chartArea.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = '#f97316';
                    ctx.strokeStyle = '#fff7ed';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }

            ctx.restore();
        },
    };
}

export function ElevationChart({ samples, waypointMarkers, dashedRanges, colorBySlope, hoverDistance, selectionRange, onHoverDistance, onSelectionChange, theme }: ElevationChartProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<Chart<'line', ChartPoint[]> | null>(null);
    const samplesRef = useRef(samples);
    const markersRef = useRef(waypointMarkers);
    const hoverRef = useRef(hoverDistance);
    const selectionRef = useRef<Selection | null>(selectionRange ? { start: selectionRange[0], end: selectionRange[1] } : null);
    const draggingRef = useRef(false);
    const forceOverlayRender = useReducer((value: number) => value + 1, 0)[1];

    samplesRef.current = samples;
    markersRef.current = waypointMarkers;
    hoverRef.current = hoverDistance;

    // Sync external selection range into internal ref
    useEffect(() => {
        if (!draggingRef.current) {
            selectionRef.current = selectionRange ? { start: selectionRange[0], end: selectionRange[1] } : null;
            chartRef.current?.draw();
        }
    }, [selectionRange]);

    useEffect(() => {
        chartRef.current?.draw();
    }, [hoverDistance]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || samples.length < 2) return;

        const data = samples.map((sample) => ({ x: sample.distance, y: sample.elevation, slope: sample.slope }));
        const elevations = samples.map((sample) => sample.elevation);
        const minElevation = Math.min(...elevations);
        const maxElevation = Math.max(...elevations);
        const elevationPadding = Math.max(8, (maxElevation - minElevation) * 0.08);
        const maxDistance = samples.at(-1)?.distance ?? 0;
        const startElevation = samples[0].elevation;

        const isDark = theme === 'dark';
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const tickColor = isDark ? '#94a3b8' : '#64748b';
        const tooltipBg = isDark ? 'rgba(2,6,23,0.94)' : 'rgba(255,255,255,0.96)';
        const tooltipBorder = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
        const tooltipBodyColor = isDark ? '#f1f5f9' : '#1e293b';
        const tooltipTitleColor = isDark ? '#94a3b8' : '#64748b';

        const config: ChartConfiguration<'line', ChartPoint[]> = {
            type: 'line',
            data: {
                datasets: [{
                    data,
                    parsing: false,
                    fill: true,
                    borderColor: '#34d399',
                    backgroundColor: 'rgba(16, 185, 129, 0.16)',
                    borderWidth: 3,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.18,
                    segment: {
                        borderColor: (context) => colorBySlope ? slopeColor(data[context.p1DataIndex]?.slope ?? 0) : '#34d399',
                        borderDash: (context) => {
                            const x = data[context.p0DataIndex]?.x ?? 0;
                            for (const range of dashedRanges) {
                                if (x >= range.start && x < range.end) return range.dash;
                            }
                            return undefined;
                        },
                    },
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                normalized: true,
                interaction: { mode: 'nearest', intersect: false, axis: 'x' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: tooltipBg,
                        borderColor: tooltipBorder,
                        borderWidth: 1,
                        bodyColor: tooltipBodyColor,
                        titleColor: tooltipTitleColor,
                        callbacks: {
                            title: (items) => formatDistance(Number(items[0]?.parsed.x ?? 0)),
                            label: (item) => `Altitude ${formatElevation(Number(item.parsed.y ?? 0))}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: maxDistance,
                        grid: { color: gridColor },
                        border: { display: false },
                        ticks: {
                            color: tickColor,
                            maxTicksLimit: 5,
                            callback: (value) => formatDistance(Number(value)),
                        },
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        min: minElevation - elevationPadding,
                        max: maxElevation + elevationPadding,
                        grid: { color: gridColor },
                        border: { display: false },
                        ticks: {
                            color: tickColor,
                            maxTicksLimit: 4,
                            callback: (value) => formatElevation(Number(value)),
                        },
                    },
                    yRelative: {
                        type: 'linear',
                        position: 'right',
                        min: (minElevation - elevationPadding) - startElevation,
                        max: (maxElevation + elevationPadding) - startElevation,
                        grid: { drawOnChartArea: false },
                        border: { display: false },
                        ticks: {
                            color: tickColor,
                            maxTicksLimit: 4,
                            callback: (value) => {
                                const v = Number(value);
                                return `${v >= 0 ? '+' : ''}${formatElevation(v)}`;
                            },
                        },
                    },
                },
            },
            plugins: [buildOverlayPlugin(samplesRef, markersRef, hoverRef, selectionRef)],
        };

        chartRef.current?.destroy();
        chartRef.current = new Chart(canvas, config);

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [colorBySlope, dashedRanges, samples, theme]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const distanceFromEvent = (event: PointerEvent | { clientX: number }): number | null => {
            const chart = chartRef.current;
            if (!chart) return null;
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            if (x < chart.chartArea.left || x > chart.chartArea.right) return null;
            return chart.scales.x.getValueForPixel(x) ?? null;
        };

        // Track active touch count for two-finger selection
        const activeTouchesRef = { current: 0 };
        const twoFingerRef = { current: false };

        const handlePointerMove = (event: PointerEvent) => {
            // On touch, if two-finger selection is active, update selection
            if (event.pointerType === 'touch' && twoFingerRef.current && draggingRef.current && selectionRef.current) {
                const distance = distanceFromEvent(event);
                if (distance !== null) {
                    selectionRef.current = { ...selectionRef.current, end: distance };
                    onSelectionChange([selectionRef.current.start, selectionRef.current.end]);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
                return;
            }
            // On touch with single finger, only hover (no selection)
            if (event.pointerType === 'touch' && !twoFingerRef.current) {
                const distance = distanceFromEvent(event);
                if (distance === null) {
                    onHoverDistance(null);
                } else {
                    onHoverDistance(distance);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
                return;
            }
            // Mouse/pen: original behavior
            const distance = distanceFromEvent(event);
            if (distance === null) {
                onHoverDistance(null);
                return;
            }
            onHoverDistance(distance);
            if (draggingRef.current && selectionRef.current) {
                selectionRef.current = { ...selectionRef.current, end: distance };
                onSelectionChange([selectionRef.current.start, selectionRef.current.end]);
                forceOverlayRender();
                chartRef.current?.draw();
            }
        };

        const handlePointerDown = (event: PointerEvent) => {
            // Touch: only hover on single finger, don't start selection
            if (event.pointerType === 'touch') {
                activeTouchesRef.current++;
                const distance = distanceFromEvent(event);
                if (distance !== null) {
                    onHoverDistance(distance);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
                return;
            }
            // Mouse/pen: start selection
            const distance = distanceFromEvent(event);
            if (distance === null) return;
            canvas.setPointerCapture(event.pointerId);
            draggingRef.current = true;
            selectionRef.current = { start: distance, end: distance };
            onSelectionChange(null);
            onHoverDistance(distance);
            chartRef.current?.draw();
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerType === 'touch') {
                activeTouchesRef.current = Math.max(0, activeTouchesRef.current - 1);
                if (activeTouchesRef.current === 0 && twoFingerRef.current) {
                    // End two-finger selection
                    twoFingerRef.current = false;
                    draggingRef.current = false;
                    if (selectionRef.current && Math.abs(selectionRef.current.end - selectionRef.current.start) > 1) {
                        onSelectionChange([selectionRef.current.start, selectionRef.current.end]);
                    } else {
                        selectionRef.current = null;
                        onSelectionChange(null);
                    }
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
                if (activeTouchesRef.current === 0) {
                    onHoverDistance(null);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
                return;
            }
            // Mouse/pen
            const distance = distanceFromEvent(event);
            if (distance !== null && selectionRef.current) {
                selectionRef.current = { ...selectionRef.current, end: distance };
            }
            draggingRef.current = false;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            if (selectionRef.current && Math.abs(selectionRef.current.end - selectionRef.current.start) > 1) {
                onSelectionChange([selectionRef.current.start, selectionRef.current.end]);
            } else {
                selectionRef.current = null;
                onSelectionChange(null);
            }
            forceOverlayRender();
            chartRef.current?.draw();
        };

        const handlePointerLeave = (event: PointerEvent) => {
            if (event.pointerType === 'touch') return;
            if (!draggingRef.current) onHoverDistance(null);
        };

        // Two-finger touch detection for selection
        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length === 2) {
                event.preventDefault();
                twoFingerRef.current = true;
                // Start selection at the midpoint of the two touches
                const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                const distance = distanceFromEvent({ clientX: midX });
                if (distance !== null) {
                    draggingRef.current = true;
                    selectionRef.current = { start: distance, end: distance };
                    onSelectionChange(null);
                    chartRef.current?.draw();
                }
            }
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (twoFingerRef.current && event.touches.length === 2) {
                event.preventDefault();
                // Use spread of two fingers as selection range
                const x1 = event.touches[0].clientX;
                const x2 = event.touches[1].clientX;
                const d1 = distanceFromEvent({ clientX: Math.min(x1, x2) });
                const d2 = distanceFromEvent({ clientX: Math.max(x1, x2) });
                if (d1 !== null && d2 !== null) {
                    selectionRef.current = { start: d1, end: d2 };
                    onSelectionChange([d1, d2]);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
            } else if (event.touches.length === 1 && !twoFingerRef.current) {
                // Single finger: just hover
                const distance = distanceFromEvent({ clientX: event.touches[0].clientX });
                if (distance !== null) {
                    onHoverDistance(distance);
                    forceOverlayRender();
                    chartRef.current?.draw();
                }
            }
        };

        const handleTouchEnd = (event: TouchEvent) => {
            if (twoFingerRef.current && event.touches.length < 2) {
                twoFingerRef.current = false;
                draggingRef.current = false;
                activeTouchesRef.current = event.touches.length;
                if (selectionRef.current && Math.abs(selectionRef.current.end - selectionRef.current.start) > 1) {
                    onSelectionChange([selectionRef.current.start, selectionRef.current.end]);
                } else {
                    selectionRef.current = null;
                    onSelectionChange(null);
                }
                forceOverlayRender();
                chartRef.current?.draw();
            }
            if (event.touches.length === 0) {
                activeTouchesRef.current = 0;
                onHoverDistance(null);
                forceOverlayRender();
                chartRef.current?.draw();
            }
        };

        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointerleave', handlePointerLeave);
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        return () => {
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('pointerleave', handlePointerLeave);
            canvas.removeEventListener('touchstart', handleTouchStart);
            canvas.removeEventListener('touchmove', handleTouchMove);
            canvas.removeEventListener('touchend', handleTouchEnd);
        };
        // `samples` is included so the effect re-runs once the canvas actually
        // mounts (the component renders a placeholder when samples.length < 2,
        // so canvasRef is null on first mount and listeners would otherwise
        // never get attached when the route becomes non-empty).
    }, [onHoverDistance, onSelectionChange, samples]);

    if (samples.length < 2) {
        return (
            <div className="flex h-full min-h-32 items-center justify-center rounded-md bg-gray-100 text-sm text-slate-400 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">
                Profil disponible après deux points
            </div>
        );
    }

    return (
        <div className="h-full w-full rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 dark:bg-slate-900 dark:ring-slate-700">
            <canvas ref={canvasRef} className="h-full w-full" />
        </div>
    );
}
