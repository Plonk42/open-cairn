import { formatSunDate, parseSunDate, sunLighting } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState } from 'react';

// ───────────────────────────────────────────────────────────────────────
// SunDateControl helpers — kept module-level so the component stays under the
// cognitive-complexity cap.
// ───────────────────────────────────────────────────────────────────────
type SunDayState = 'night' | 'dawn' | 'dusk' | 'day';

/** Daylight window (minutes-of-day) the sun animation loops over. */
const SUN_DAY_START = 4 * 60; // 4h
const SUN_NIGHT_END = 22 * 60; // 22h

function computeSunReadout(
    value: string,
    centerLng: number | null,
    centerLat: number | null,
): { azStr: string; elStr: string; dayState: SunDayState } {
    if (centerLng == null || centerLat == null) return { azStr: '—', elStr: '—', dayState: 'day' };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { azStr: '—', elStr: '—', dayState: 'day' };
    const { azimuthDeg, elevationDeg, intensity } = sunLighting(d, centerLat, centerLng);
    let dayState: SunDayState = 'day';
    if (intensity <= 0) {
        dayState = 'night';
    } else if (intensity < 1) {
        // Twilight: morning (before noon) is dawn, afternoon is dusk.
        dayState = d.getHours() < 12 ? 'dawn' : 'dusk';
    }
    return {
        azStr: `${Math.round(azimuthDeg)}°`,
        elStr: `${elevationDeg >= 0 ? '+' : ''}${Math.round(elevationDeg)}°`,
        dayState,
    };
}

const SUN_BADGES: Record<SunDayState, { badge: string; label: string }> = {
    night: { badge: 'bg-slate-700 text-slate-200', label: 'nuit' },
    dawn: { badge: 'bg-sky-200 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200', label: 'aube' },
    dusk: { badge: 'bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200', label: 'crépuscule' },
    day: { badge: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200', label: 'jour' },
};

/** Loops the time-of-day forward while `playing` */
function useSunPlayback(
    playing: boolean,
    datePart: string,
    minutesRef: { current: number },
    onChange: (v: string) => void,
) {
    useEffect(() => {
        if (!playing) return;
        const id = globalThis.setInterval(() => {
            let next = minutesRef.current + 5;
            // Skip the dark hours (22h → 4h) where nothing is visible: once the
            // animation reaches 22h, jump straight to 4h the next morning.
            if (next >= SUN_NIGHT_END || next < SUN_DAY_START) next = SUN_DAY_START;
            onChange(formatSunDate(datePart, next));
        }, 60);
        return () => globalThis.clearInterval(id);
    }, [playing, datePart, minutesRef, onChange]);
}

/**
 * Date/time picker + live read-out of sun azimuth/elevation, plus a "course du
 * soleil" playback button. Subscribes to the sun date directly so the playback
 * (which rewrites the value every ~60 ms) only re-renders this small control.
 */
export function SunDateControl({
    centerLng,
    centerLat,
}: Readonly<{
    centerLng: number | null;
    centerLat: number | null;
}>) {
    const value = useMapStore((s) => s.lidarSunDate);
    const onChange = useMapStore((s) => s.setLidarSunDate);

    // value is stored as "YYYY-MM-DDTHH:mm" (local time). Split into date and
    // minutes-of-day for an independent date picker + hour slider.
    const { datePart, minutesOfDay } = parseSunDate(value);
    const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const mm = String(minutesOfDay % 60).padStart(2, '0');
    const timeLabel = `${hh}h${mm}`;

    const setDate = (d: string) => {
        if (!d) return;
        onChange(formatSunDate(d, minutesOfDay));
    };
    const setMinutes = (n: number) => {
        onChange(formatSunDate(datePart, n));
    };

    const [playing, setPlaying] = useState(false);
    const minutesRef = useRef(minutesOfDay);
    minutesRef.current = minutesOfDay;
    useSunPlayback(playing, datePart, minutesRef, onChange);

    const { azStr, elStr, dayState } = computeSunReadout(value, centerLng, centerLat);
    const { badge: dayBadge, label: dayLabel } = SUN_BADGES[dayState];

    return (
        <div>
            <input
                aria-label="Date pour le calcul du soleil"
                type="date"
                value={datePart}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setPlaying((p) => !p)}
                    aria-label={playing ? 'Arrêter la course du soleil' : 'Lancer la course du soleil'}
                    title={playing ? 'Arrêter l’animation' : 'Animer la course du soleil sur la journée'}
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors ${playing
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                        }`}
                >
                    {playing ? (
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                            <rect x="3" y="2" width="3.5" height="12" rx="1" />
                            <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                            <path d="M4 2.5v11a.75.75 0 0 0 1.14.64l9-5.5a.75.75 0 0 0 0-1.28l-9-5.5A.75.75 0 0 0 4 2.5Z" />
                        </svg>
                    )}
                </button>
                <input
                    aria-label="Heure de la journée"
                    type="range"
                    min={0}
                    max={1439}
                    step={5}
                    value={minutesOfDay}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    className="min-w-0 flex-1 accent-green-600"
                />
                <span className="w-12 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-200">
                    {timeLabel}
                </span>
                <span className={`inline-block w-16 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${dayBadge}`}>
                    {dayLabel}
                </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
                Position : az {azStr} · h {elStr}
            </p>
        </div>
    );
}
