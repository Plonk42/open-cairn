import { formatSunDate, parseSunDate } from '@/lib/sun';
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

/**
 * Le read-out décrit la lumière **effective** (les réglages bas niveau), pas
 * celle que la date impliquerait : quand l'utilisateur force l'éclairage, un
 * azimut qui ne colle pas à l'heure affichée est justement le signal utile.
 */
function sunDayState(intensity: number, minutesOfDay: number): SunDayState {
    if (intensity <= 0) return 'night';
    if (intensity >= 1) return 'day';
    // Twilight: morning (before noon) is dawn, afternoon is dusk.
    return minutesOfDay < 12 * 60 ? 'dawn' : 'dusk';
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
 * Date/time picker + live read-out of the effective sun azimuth/elevation, plus
 * a "course du soleil" playback button. Subscribes to the sun date directly so
 * the playback (which rewrites the value every ~60 ms) only re-renders this
 * small control.
 */
export function SunDateControl() {
    const value = useMapStore((s) => s.lidarSunDate);
    const onChange = useMapStore((s) => s.applyLidarSunDate);
    const azimuthDeg = useMapStore((s) => s.lidarSunAzimuth);
    const elevationDeg = useMapStore((s) => s.lidarSunElevation);
    const intensity = useMapStore((s) => s.lidarSunIntensity);

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

    const { badge: dayBadge, label: dayLabel } = SUN_BADGES[sunDayState(intensity, minutesOfDay)];
    const azStr = `${Math.round(azimuthDeg)}°`;
    const elStr = `${elevationDeg >= 0 ? '+' : ''}${Math.round(elevationDeg)}°`;

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
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] text-slate-400">
                    Position : az {azStr} · h {elStr}
                </p>
                <span className={`inline-block flex-shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${dayBadge}`}>
                    {dayLabel}
                </span>
            </div>
        </div>
    );
}
