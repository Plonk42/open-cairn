import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

interface CursorCoordinatesProps {
    compact?: boolean;
    /** Flat variant: no own background/ring/shadow (for nesting in a parent card). */
    flat?: boolean;
}

function formatCoord(value: number): string {
    return value.toFixed(5);
}

function formatDMS(value: number, isLat: boolean): string {
    let hemi: string;
    if (isLat) hemi = value >= 0 ? 'N' : 'S';
    else hemi = value >= 0 ? 'E' : 'O';
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minF = (abs - deg) * 60;
    const min = Math.floor(minF);
    const sec = (minF - min) * 60;
    return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1)}"${hemi}`;
}

export function CursorCoordinates({ compact = false, flat = false }: Readonly<CursorCoordinatesProps>) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const [mode, setMode] = useState<'dec' | 'dms'>('dec');
    const routeActive = useRouteStore((s) => s.active);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!mapInstance) return undefined;
        const onMove = (e: maplibregl.MapMouseEvent) => {
            setCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        };
        const onLeave = () => setCoords(null);
        mapInstance.on('mousemove', onMove);
        mapInstance.on('mouseout', onLeave);
        return () => {
            mapInstance.off('mousemove', onMove);
            mapInstance.off('mouseout', onLeave);
        };
    }, [mapInstance]);

    // Right-click on map = copy coordinates without interfering with left-click (used for route)
    useEffect(() => {
        if (!mapInstance) return undefined;
        const copyCoords = (lngLat: { lng: number; lat: number }) => {
            const text = `${formatCoord(lngLat.lat)}, ${formatCoord(lngLat.lng)}`;
            navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
            setCopied(true);
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = globalThis.setTimeout(() => setCopied(false), 1800);
        };
        const onContext = (e: maplibregl.MapMouseEvent) => {
            if (routeActive) return;
            e.preventDefault();
            copyCoords(e.lngLat);
        };
        mapInstance.on('contextmenu', onContext);
        return () => {
            mapInstance.off('contextmenu', onContext);
        };
    }, [mapInstance, routeActive]);

    if (!coords) {
        const sizeClass = compact ? 'text-[10px]' : '';
        const placeholderClass = flat
            ? `pointer-events-none select-none px-1 py-0.5 text-[11px] font-mono text-slate-400 dark:text-slate-500 ${sizeClass}`
            : `pointer-events-none select-none rounded-lg bg-white/80 px-2.5 py-1 text-[11px] font-mono text-slate-400 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/70 dark:text-slate-500 dark:ring-white/10 ${sizeClass}`;
        return (
            <div className={placeholderClass}>
                — , —
            </div>
        );
    }

    const decimalText = `${formatCoord(coords.lat)}, ${formatCoord(coords.lng)}`;
    const display = mode === 'dec'
        ? decimalText
        : `${formatDMS(coords.lat, true)} ${formatDMS(coords.lng, false)}`;

    const sizeClass = compact ? 'text-[10px]' : '';
    const containerClass = flat
        ? `pointer-events-none flex select-none items-center gap-1.5 px-1 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-200 ${sizeClass}`
        : `pointer-events-none flex select-none items-center gap-1.5 rounded-lg bg-white/85 px-2 py-1 font-mono text-[11px] text-slate-700 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/75 dark:text-slate-200 dark:ring-white/10 ${sizeClass}`;
    return (
        <div className={containerClass}>
            <button
                type="button"
                onClick={() => setMode((m) => m === 'dec' ? 'dms' : 'dec')}
                title="Basculer décimal / DMS"
                className="pointer-events-auto cursor-pointer tabular-nums"
            >
                {display}
            </button>
            {copied && (
                <span className="text-[10px] font-sans text-green-600 dark:text-emerald-400">copié ✓</span>
            )}
            {!copied && !routeActive && (
                <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500">clic droit = copier</span>
            )}
        </div>
    );
}
