import {
    ropeBetween,
    snapToProfile,
    type CliffStation,
    type SliceProfile,
    type SliceProfilePoint,
} from '@/lib/cliffSlice';
import { LAS_CLASS_COLORS } from '@/lib/lidarCloud';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useMemo, useRef, useState } from 'react';

export type ColorMode = 'class' | 'depth' | 'class-depth';

interface ChartProps {
    readonly profile: SliceProfile;
    readonly stations: readonly CliffStation[];
    readonly colorMode: ColorMode;
    readonly safetyMargin: number;
    readonly theme: 'light' | 'dark';
}

interface PixelTransform {
    /** Convert world (d, e) to canvas pixel (px, py). */
    toPx: (d: number, e: number) => [number, number];
    /** Convert canvas pixel (px, py) back to world (d, e). */
    fromPx: (px: number, py: number) => [number, number];
    /** Pixels per meter (same in both axes — 1:1 aspect). */
    scale: number;
    chartArea: { left: number; top: number; right: number; bottom: number };
}

const PADDING_LEFT = 56;
const PADDING_RIGHT = 16;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 28;

function niceGridStep(targetPx: number, scale: number): number {
    // Choose a 1-2-5 step in meters that maps to roughly `targetPx` pixels.
    const meters = targetPx / scale;
    const exp = Math.floor(Math.log10(meters));
    const base = Math.pow(10, exp);
    const m = meters / base;
    let step: number;
    if (m < 1.5) step = 1;
    else if (m < 3.5) step = 2;
    else if (m < 7.5) step = 5;
    else step = 10;
    return step * base;
}

function packColor(rgb: [number, number, number], alpha: number): string {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function colorForPoint(p: SliceProfilePoint, mode: ColorMode, halfCorridor: number): [number, number, number] {
    if (mode === 'class') return LAS_CLASS_COLORS[p.cls] ?? [200, 200, 200];
    if (mode === 'depth') {
        const t = (p.depth + halfCorridor) / (2 * halfCorridor);
        const v = Math.round(80 + 175 * t);
        return [v, v, v];
    }
    // 'class-depth': base class color modulated by depth (closer = brighter, farther = dimmer).
    const base = LAS_CLASS_COLORS[p.cls] ?? [200, 200, 200];
    const t = (p.depth + halfCorridor) / (2 * halfCorridor);
    const k = 0.45 + 0.55 * t;
    return [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k)];
}

function buildTransform(profile: SliceProfile, width: number, height: number): PixelTransform {
    const left = PADDING_LEFT;
    const right = width - PADDING_RIGHT;
    const top = PADDING_TOP;
    const bottom = height - PADDING_BOTTOM;
    const innerW = Math.max(10, right - left);
    const innerH = Math.max(10, bottom - top);

    const dRange = Math.max(1, profile.length);
    const ePad = Math.max(1, (profile.eMax - profile.eMin) * 0.05);
    const eMin = profile.eMin - ePad;
    const eMax = profile.eMax + ePad;
    const eRange = Math.max(1, eMax - eMin);

    // 1:1 aspect — pick the more constrained axis.
    const scale = Math.min(innerW / dRange, innerH / eRange);
    const usedW = dRange * scale;
    const usedH = eRange * scale;
    const offsetX = left + (innerW - usedW) / 2;
    const offsetY = top + (innerH - usedH) / 2;

    const toPx = (d: number, e: number): [number, number] => [
        offsetX + d * scale,
        offsetY + (eMax - e) * scale,
    ];
    const fromPx = (px: number, py: number): [number, number] => [
        (px - offsetX) / scale,
        eMax - (py - offsetY) / scale,
    ];
    return { toPx, fromPx, scale, chartArea: { left, top, right, bottom } };
}

function drawGrid(
    ctx: CanvasRenderingContext2D,
    profile: SliceProfile,
    tr: PixelTransform,
    isDark: boolean,
): void {
    const { chartArea } = tr;
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const tickColor = isDark ? '#94a3b8' : '#475569';
    const step = niceGridStep(80, tr.scale);

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = tickColor;

    // Vertical (distance) grid.
    const dStart = 0;
    const dEnd = profile.length;
    const firstD = Math.ceil(dStart / step) * step;
    for (let d = firstD; d <= dEnd + 1e-6; d += step) {
        const [x] = tr.toPx(d, profile.eMin);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(`${d.toFixed(0)} m`, x, chartArea.bottom + 14);
    }

    // Horizontal grid in height-from-base units so labels are round (0, step, 2*step…).
    const ePad = Math.max(1, (profile.eMax - profile.eMin) * 0.05);
    const hMin = -ePad;
    const hMax = (profile.eMax - profile.eMin) + ePad;
    const firstH = Math.ceil(hMin / step) * step;
    for (let h = firstH; h <= hMax + 1e-6; h += step) {
        const [, y] = tr.toPx(0, profile.eMin + h);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(`${h.toFixed(0)}`, chartArea.left - 6, y + 3);
    }

    // Axis labels.
    ctx.fillStyle = tickColor;
    ctx.textAlign = 'center';
    ctx.font = '600 10px ui-sans-serif, system-ui';
    ctx.fillText('Distance (m)', (chartArea.left + chartArea.right) / 2, chartArea.bottom + 24);
    ctx.save();
    ctx.translate(14, (chartArea.top + chartArea.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Hauteur (m)', 0, 0);
    ctx.restore();

    ctx.restore();
}

function bucketDepthGrids(profile: SliceProfile, bucketCount: number, bandCount: number): Float32Array[] {
    const { points, halfCorridor, length } = profile;
    const totalDepth = halfCorridor * 2;
    const bucketWidth = length / bucketCount;
    const grids: Float32Array[] = [];
    for (let b = 0; b < bandCount; b += 1) {
        const g = new Float32Array(bucketCount);
        g.fill(Number.NEGATIVE_INFINITY);
        grids.push(g);
    }
    for (const p of points) {
        const tBand = (p.depth + halfCorridor) / totalDepth;
        let band = Math.floor(tBand * bandCount);
        if (band < 0) band = 0;
        else if (band >= bandCount) band = bandCount - 1;
        let bucket = Math.floor(p.d / bucketWidth);
        if (bucket < 0) bucket = 0;
        else if (bucket >= bucketCount) bucket = bucketCount - 1;
        const g = grids[band];
        if (p.e > g[bucket]) g[bucket] = p.e;
    }
    return grids;
}

function gridToPolyline(grid: Float32Array, bucketWidth: number): Array<[number, number]> {
    const line: Array<[number, number]> = [];
    for (let i = 0; i < grid.length; i += 1) {
        const e = grid[i];
        if (!Number.isFinite(e)) continue;
        line.push([(i + 0.5) * bucketWidth, e]);
    }
    return line;
}

/**
 * Build a "wall profile" line per depth band: points are bucketed into a
 * fixed number of depth bands (front of corridor → back), then within each
 * band into pixel-wide d-buckets, and the topmost elevation per (band, bucket)
 * is connected. This gives the climber a visual sense of the rock face's 3D
 * relief at different depths, without overplotting a million dots.
 */
function buildDepthLines(profile: SliceProfile, tr: PixelTransform, bandCount: number): { band: number; line: Array<[number, number]> }[] {
    if (profile.points.length === 0 || profile.halfCorridor <= 0) return [];
    const innerW = Math.max(10, tr.chartArea.right - tr.chartArea.left);
    const bucketCount = Math.max(20, Math.min(800, Math.floor(innerW / 2)));
    const bucketWidth = profile.length / bucketCount;
    const grids = bucketDepthGrids(profile, bucketCount, bandCount);
    const out: { band: number; line: Array<[number, number]> }[] = [];
    for (let b = 0; b < bandCount; b += 1) {
        const line = gridToPolyline(grids[b], bucketWidth);
        if (line.length >= 2) out.push({ band: b, line });
    }
    return out;
}

function drawDepthLines(
    ctx: CanvasRenderingContext2D,
    profile: SliceProfile,
    tr: PixelTransform,
    colorMode: ColorMode,
): void {
    const bandCount: number = colorMode === 'depth' ? 7 : 4;
    const lines = buildDepthLines(profile, tr, bandCount);
    if (lines.length === 0) return;
    const ca = tr.chartArea;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top);
    ctx.clip();
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const { band, line } of lines) {
        const t = bandCount === 1 ? 0.5 : band / (bandCount - 1);
        const v = Math.round(80 + 175 * t);
        const alpha = colorMode === 'depth' ? 0.55 + 0.35 * t : 0.18 + 0.18 * t;
        ctx.strokeStyle = `rgba(${v},${v},${v},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(...tr.toPx(line[0][0], line[0][1]));
        for (let i = 1; i < line.length; i += 1) {
            ctx.lineTo(...tr.toPx(line[i][0], line[i][1]));
        }
        ctx.stroke();
    }
    ctx.restore();
}

function drawPoints(
    ctx: CanvasRenderingContext2D,
    profile: SliceProfile,
    tr: PixelTransform,
    colorMode: ColorMode,
): void {
    const { points, halfCorridor } = profile;
    const size = Math.max(1.2, Math.min(3, tr.scale * 0.18));
    ctx.save();
    // Clip to chart area to avoid bleed when scale is tight.
    const ca = tr.chartArea;
    ctx.beginPath();
    ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top);
    ctx.clip();
    for (const p of points) {
        const rgb = colorForPoint(p, colorMode, halfCorridor);
        ctx.fillStyle = packColor(rgb, 0.85);
        const [x, y] = tr.toPx(p.d, p.e);
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
}

function drawStations(
    ctx: CanvasRenderingContext2D,
    stations: readonly CliffStation[],
    tr: PixelTransform,
): void {
    if (stations.length === 0) return;
    ctx.save();
    for (let i = 0; i < stations.length; i += 1) {
        const s = stations[i];
        const [x, y] = tr.toPx(s.d, s.e);
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#0ea5e9';
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.label ?? `R${i + 1}`, x, y);
    }
    ctx.restore();
}

function drawRope(
    ctx: CanvasRenderingContext2D,
    stations: readonly CliffStation[],
    tr: PixelTransform,
    safetyMargin: number,
): void {
    if (stations.length < 2) return;
    ctx.save();
    ctx.lineWidth = 2.5;
    for (let i = 1; i < stations.length; i += 1) {
        const a = stations[i - 1];
        const b = stations[i];
        const seg = ropeBetween(a, b, safetyMargin);
        // Color by overhang severity: green (slab) → orange (vertical) → red (overhang).
        let color = '#22c55e';
        if (seg.overhang) color = '#ef4444';
        else if (seg.angle >= 80) color = '#f97316';
        else if (seg.angle >= 60) color = '#eab308';
        const [ax, ay] = tr.toPx(a.d, a.e);
        const [bx, by] = tr.toPx(b.d, b.e);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        // Mid-segment label: rope length.
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const angle = Math.atan2(by - ay, bx - ax);
        const adj = Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(adj);
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.font = '700 11px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const txt = `${seg.rope.toFixed(1)} m`;
        ctx.strokeText(txt, 0, -6);
        ctx.fillText(txt, 0, -6);
        ctx.restore();
    }
    ctx.restore();
}

function drawHover(
    ctx: CanvasRenderingContext2D,
    hover: { p: SliceProfilePoint; px: number; py: number; eMin: number } | null,
    tr: PixelTransform,
    isDark: boolean,
): void {
    if (!hover) return;
    const ca = tr.chartArea;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = isDark ? 'rgba(248,250,252,0.6)' : 'rgba(15,23,42,0.5)';
    ctx.beginPath();
    ctx.moveTo(hover.px, ca.top);
    ctx.lineTo(hover.px, ca.bottom);
    ctx.moveTo(ca.left, hover.py);
    ctx.lineTo(ca.right, hover.py);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f97316';
    ctx.strokeStyle = '#fff7ed';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hover.px, hover.py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tooltip box.
    const txt = `${hover.p.d.toFixed(1)} m · ${(hover.p.e - hover.eMin).toFixed(1)} m h`;
    ctx.font = '600 11px ui-sans-serif, system-ui';
    const w = ctx.measureText(txt).width + 14;
    const h = 22;
    let bx = hover.px + 10;
    let by = hover.py - h - 10;
    if (bx + w > ca.right) bx = hover.px - w - 10;
    if (by < ca.top) by = hover.py + 14;
    ctx.fillStyle = isDark ? 'rgba(2,6,23,0.94)' : 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.18)';
    ctx.beginPath();
    ctx.rect(bx, by, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + 7, by + h / 2);
    ctx.restore();
}

export function CliffSliceChart({ profile, stations, colorMode, safetyMargin, theme }: ChartProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [hover, setHover] = useState<{ p: SliceProfilePoint; px: number; py: number; eMin: number } | null>(null);
    const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 320 });

    const addStation = useMapStore((s) => s.addCliffSliceStation);
    const removeStation = useMapStore((s) => s.removeCliffSliceStation);

    // Track container size.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            setSize({ w: el.clientWidth, h: el.clientHeight });
        });
        ro.observe(el);
        setSize({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    const transform = useMemo(() => buildTransform(profile, size.w, size.h), [profile, size.w, size.h]);

    // Redraw on every relevant change.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = globalThis.devicePixelRatio || 1;
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
        canvas.style.width = `${size.w}px`;
        canvas.style.height = `${size.h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Background.
        ctx.fillStyle = theme === 'dark' ? '#0f172a' : '#ffffff';
        ctx.fillRect(0, 0, size.w, size.h);
        if (profile.points.length === 0) {
            ctx.fillStyle = theme === 'dark' ? '#94a3b8' : '#64748b';
            ctx.font = '600 12px ui-sans-serif, system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Aucun point dans la coupe — élargissez le couloir ou changez de zone.',
                size.w / 2, size.h / 2);
            return;
        }
        drawGrid(ctx, profile, transform, theme === 'dark');
        drawDepthLines(ctx, profile, transform, colorMode);
        drawPoints(ctx, profile, transform, colorMode);
        drawRope(ctx, stations, transform, safetyMargin);
        drawStations(ctx, stations, transform);
        drawHover(ctx, hover, transform, theme === 'dark');
    }, [profile, transform, colorMode, stations, safetyMargin, hover, size.w, size.h, theme]);

    function eventToWorld(ev: React.MouseEvent<HTMLCanvasElement>): { px: number; py: number; d: number; e: number } | null {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const ca = transform.chartArea;
        if (px < ca.left || px > ca.right || py < ca.top || py > ca.bottom) return null;
        const [d, e] = transform.fromPx(px, py);
        return { px, py, d, e };
    }

    function onMove(ev: React.MouseEvent<HTMLCanvasElement>): void {
        const w = eventToWorld(ev);
        if (!w) { setHover(null); return; }
        const snap = snapToProfile(profile, w.d, w.e, transform.scale, transform.scale);
        if (!snap) { setHover(null); return; }
        // Only show hover if the snapped point is reasonably close in pixel space.
        const [sx, sy] = transform.toPx(snap.d, snap.e);
        const distPx = Math.hypot(sx - w.px, sy - w.py);
        if (distPx > 18) { setHover(null); return; }
        setHover({ p: snap, px: sx, py: sy, eMin: profile.eMin });
    }

    function onLeave(): void { setHover(null); }

    function onClick(ev: React.MouseEvent<HTMLCanvasElement>): void {
        const w = eventToWorld(ev);
        if (!w) return;
        // If clicking near an existing station, remove it.
        for (const s of stations) {
            const [sx, sy] = transform.toPx(s.d, s.e);
            if (Math.hypot(sx - w.px, sy - w.py) < 14) {
                removeStation(s.id);
                return;
            }
        }
        const snap = snapToProfile(profile, w.d, w.e, transform.scale, transform.scale);
        if (!snap) return;
        const [sx, sy] = transform.toPx(snap.d, snap.e);
        if (Math.hypot(sx - w.px, sy - w.py) > 24) return;
        addStation(snap.d, snap.e);
    }

    return (
        <div ref={containerRef} className="relative h-full w-full">
            <canvas
                ref={canvasRef}
                onMouseMove={onMove}
                onMouseLeave={onLeave}
                onClick={onClick}
                className="block h-full w-full cursor-crosshair"
            />
        </div>
    );
}
