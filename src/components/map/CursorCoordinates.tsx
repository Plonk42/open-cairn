import { COORD_FORMAT_LABELS, formatCoordByMode, type CoordFormat } from '@/lib/coordinateFormat';
import { useMapStore } from '@/stores/mapStore';
import { useRouteStore } from '@/stores/routeStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

interface CursorCoordinatesProps {
    compact?: boolean;
    /** Flat variant: no own background/ring/shadow (for nesting in a parent card). */
    flat?: boolean;
}

export function CursorCoordinates({ compact = false, flat = false }: Readonly<CursorCoordinatesProps>) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const [mode, setMode] = useState<CoordFormat>('dec');
    const routeActive = useRouteStore((s) => s.active);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modeRef = useRef(mode);
    modeRef.current = mode;

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
            const text = formatCoordByMode(modeRef.current, lngLat.lat, lngLat.lng);
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

    // Keep last-known text when the pointer leaves the map (e.g. moving onto this
    // very overlay, which also fires the map's mouseout) so the selector never disappears.
    const display = coords ? formatCoordByMode(mode, coords.lat, coords.lng) : '— , —';

    const sizeClass = compact ? 'text-[10px]' : '';
    const containerClass = flat
        ? `pointer-events-none flex select-none items-center gap-1.5 px-1 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-200 ${sizeClass}`
        : `pointer-events-none flex select-none items-center gap-1.5 rounded-lg bg-white/85 px-2 py-1 font-mono text-[11px] text-slate-700 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/75 dark:text-slate-200 dark:ring-white/10 ${sizeClass}`;
    return (
        <div className={containerClass}>
            <span
                className="pointer-events-auto cursor-help whitespace-nowrap tabular-nums"
                title={routeActive ? undefined : 'Clic droit sur la carte = copier les coordonnées'}
            >
                {display}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {copied && (
                    <span className="whitespace-nowrap text-[10px] font-sans text-green-600 dark:text-emerald-400">copié ✓</span>
                )}
                <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as CoordFormat)}
                    title="Format d'affichage et de copie"
                    className="pointer-events-auto cursor-pointer rounded border-none bg-transparent py-0 pl-0.5 pr-4 text-[10px] font-sans text-slate-500 focus:outline-none dark:text-slate-400"
                >
                    {(Object.keys(COORD_FORMAT_LABELS) as CoordFormat[]).map((f) => (
                        <option key={f} value={f}>{COORD_FORMAT_LABELS[f]}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}

