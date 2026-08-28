import { COORD_FORMAT_LABELS, formatCoordByMode, type CoordFormat } from '@/lib/coordinateFormat';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;

/**
 * Touch counterpart of the desktop right-click-to-copy shortcut: a long press
 * on the map reveals the coordinates of that point, with the same dec/DMS/DDM
 * format selector. Rendered by `MobileTopBar`, so both mobile shells get it.
 */
export function TouchCoordinates() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const setCoordPickActive = useMapStore((s) => s.setCoordPickActive);
    const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
    const [mode, setMode] = useState<CoordFormat>('dec');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!mapInstance) return undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let origin: { x: number; y: number } | null = null;

        const cancel = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            origin = null;
        };

        const onStart = (e: maplibregl.MapTouchEvent) => {
            cancel();
            // Clearing here (rather than on a timer) is what un-suppresses the
            // map: the only click swallowed is the one ending the long press.
            setCoordPickActive(false);
            if (e.points.length !== 1) return;
            origin = { x: e.point.x, y: e.point.y };
            const { lat, lng } = e.lngLat;
            timer = setTimeout(() => {
                timer = null;
                setPoint({ lat, lng });
                setCopied(false);
                setCoordPickActive(true);
            }, LONG_PRESS_MS);
        };

        const onMove = (e: maplibregl.MapTouchEvent) => {
            if (!timer || !origin) return;
            if (Math.hypot(e.point.x - origin.x, e.point.y - origin.y) > MOVE_TOLERANCE_PX) cancel();
        };

        mapInstance.on('touchstart', onStart);
        mapInstance.on('touchmove', onMove);
        mapInstance.on('touchend', cancel);
        mapInstance.on('touchcancel', cancel);
        mapInstance.on('movestart', cancel);
        return () => {
            cancel();
            setCoordPickActive(false);
            mapInstance.off('touchstart', onStart);
            mapInstance.off('touchmove', onMove);
            mapInstance.off('touchend', cancel);
            mapInstance.off('touchcancel', cancel);
            mapInstance.off('movestart', cancel);
        };
    }, [mapInstance, setCoordPickActive]);

    if (!point) return null;

    const text = formatCoordByMode(mode, point.lat, point.lng);
    const handleCopy = () => {
        navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
        setCopied(true);
        globalThis.setTimeout(() => setCopied(false), 1800);
    };

    return (
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/80 dark:ring-white/10">
            <span className="flex-1 truncate font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">{text}</span>
            <select
                value={mode}
                onChange={(e) => setMode(e.target.value as CoordFormat)}
                title="Format d'affichage et de copie"
                className="shrink-0 cursor-pointer rounded border-none bg-transparent py-0 pl-0.5 pr-4 text-[11px] text-slate-500 focus:outline-none dark:text-slate-400"
            >
                {(Object.keys(COORD_FORMAT_LABELS) as CoordFormat[]).map((f) => (
                    <option key={f} value={f}>{COORD_FORMAT_LABELS[f]}</option>
                ))}
            </select>
            <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-600/10 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
            >
                {copied ? 'copié ✓' : 'Copier'}
            </button>
            <button
                type="button"
                onClick={() => setPoint(null)}
                title="Fermer"
                aria-label="Fermer"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10"
            >
                ×
            </button>
        </div>
    );
}
