import { ClassFilterChips, type ClassChoice } from '@/components/ui/ClassFilterChips';
import { CliffSliceChart, type ColorMode } from '@/components/ui/CliffSliceChart';
import {
    extractPolylineSliceProfile,
    mergeSliceProfiles,
    meshAsSliceSource,
    ropeSegments,
    ropeTotals,
    type CliffStation,
    type RopeSegment,
    type SliceProfile,
} from '@/lib/cliffSlice';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMapStore } from '@/stores/mapStore';
import { useMemo, useState } from 'react';

/** ASPRS classes shown as chips in the slice header. Restricted on purpose. */
const SLICE_CLASS_CHOICES: ReadonlyArray<ClassChoice> = [
    { id: 2, label: 'Sol', hint: 'Surface rocheuse / terrain (recommandé pour la falaise)' },
    { id: 6, label: 'Bâti', hint: 'Bâtiments' },
    { id: 5, label: 'Végét. haute', hint: 'Arbres' },
];

function colorModeFromFlags(byClass: boolean, byDepth: boolean): ColorMode {
    if (byClass && byDepth) return 'class-depth';
    if (byDepth) return 'depth';
    return 'class';
}

function StationRow({
    index,
    station,
    segment,
    onLabel,
    onRemove,
}: Readonly<{
    index: number;
    station: CliffStation;
    segment: RopeSegment | null;
    onLabel: (id: string, label: string) => void;
    onRemove: (id: string) => void;
}>) {
    return (
        <div className={`flex items-center gap-2 px-2.5 py-2 ${index > 0 ? 'border-t border-gray-200 dark:border-slate-600' : ''}`}>
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-slate-800">
                {index + 1}
            </span>
            <input
                aria-label={`Étiquette du relais ${index + 1}`}
                type="text"
                value={station.label ?? ''}
                placeholder={`R${index + 1}`}
                onChange={(e) => onLabel(station.id, e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
            />
            {segment && (
                <div className="flex flex-shrink-0 items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                    <span title="Longueur de corde recommandée">
                        🪢 <strong className="text-sky-600 dark:text-sky-400">{segment.rope.toFixed(1)} m</strong>
                    </span>
                    <span title="Angle moyen depuis l'horizontale">
                        ∠ {segment.angle.toFixed(0)}°{segment.overhang ? ' ⚠' : ''}
                    </span>
                </div>
            )}
            <button
                type="button"
                onClick={() => onRemove(station.id)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-900/30"
                title="Retirer ce relais"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
            </button>
        </div>
    );
}

function StationsSidePanel({
    open,
    setOpen,
    stations,
    segments,
    totals,
    safety,
    onLabel,
    onRemove,
    onClear,
    onSafetyChange,
}: Readonly<{
    open: boolean;
    setOpen: (v: boolean) => void;
    stations: readonly CliffStation[];
    segments: readonly RopeSegment[];
    totals: { total: number; longest: number; ascent: number; descent: number };
    safety: number;
    onLabel: (id: string, label: string) => void;
    onRemove: (id: string) => void;
    onClear: () => void;
    onSafetyChange: (v: number) => void;
}>) {
    return (
        <div className="flex flex-shrink-0">
            {/* Toggle strip */}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={`flex h-full w-6 flex-col items-center justify-center gap-1 bg-gray-50 text-slate-500 ring-1 ring-gray-200 transition hover:bg-gray-100 hover:text-slate-700 dark:bg-slate-800/50 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${open ? 'rounded-l-md' : 'rounded-md'}`}
                title={open ? 'Masquer les relais' : `Afficher les ${stations.length} relais`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                </svg>
                <span className="text-[9px] font-bold">{stations.length}</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-3 w-3 transition-transform ${open ? '' : 'rotate-180'}`}>
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
            </button>

            {open && (
                <div className="flex w-56 flex-col rounded-r-md bg-white ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
                    {/* List header */}
                    <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <span>Relais ({stations.length})</span>
                        {stations.length > 0 && (
                            <button
                                type="button"
                                onClick={onClear}
                                className="text-[10px] text-slate-500 hover:text-rose-500"
                            >
                                Tout effacer
                            </button>
                        )}
                    </div>

                    {/* Body */}
                    <div className="min-h-0 flex-1 overflow-auto border-t border-gray-200 dark:border-slate-700">
                        {stations.length === 0 ? (
                            <p className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                                Cliquez un point dans le graphique pour ajouter un relais.
                            </p>
                        ) : (
                            stations.map((s, i) => (
                                <StationRow
                                    key={s.id}
                                    index={i}
                                    station={s}
                                    segment={i > 0 ? segments[i - 1] : null}
                                    onLabel={onLabel}
                                    onRemove={onRemove}
                                />
                            ))
                        )}
                    </div>

                    {/* Totals footer */}
                    {stations.length >= 2 && (
                        <div className="border-t border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
                            <div className="text-[11px] font-semibold">
                                Corde totale : {totals.total.toFixed(1)} m
                            </div>
                            <div className="text-sky-700 dark:text-sky-300">
                                Plus longue : <strong>{totals.longest.toFixed(1)} m</strong>
                                {' · '}+{totals.ascent.toFixed(1)} / −{totals.descent.toFixed(1)} m
                            </div>
                        </div>
                    )}

                    {/* Rope safety slider — always visible when the panel is open */}
                    <label className="block border-t border-gray-200 px-2.5 py-1.5 dark:border-slate-700">
                        <div className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300">
                            <span title="Marge appliquée à la longueur 3D directe pour obtenir la corde recommandée">
                                Marge corde
                            </span>
                            <span className="font-mono text-slate-400">+{Math.round(safety * 100)} %</span>
                        </div>
                        <input
                            aria-label="Marge de sécurité corde"
                            type="range"
                            min={0}
                            max={0.5}
                            step={0.05}
                            value={safety}
                            onChange={(e) => onSafetyChange(Number(e.target.value))}
                            className="mt-0.5 w-full accent-green-600"
                        />
                    </label>
                </div>
            )}
        </div>
    );
}

/** Build the slice profile from the current cloud + polyline, or null if not ready. */
export function useCliffSliceProfile(): SliceProfile | null {
    const cloud = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const points = useMapStore((s) => s.cliffSlicePoints);
    const corridor = useMapStore((s) => s.cliffSliceCorridor);
    const classes = useMapStore((s) => s.cliffSliceClasses);
    return useMemo(() => {
        if (points.length < 2) return null;
        if (!cloud && !mesh) return null;
        const filter = classes.length > 0 ? new Set<number>(classes) : null;
        // In delaunay/poisson modes the ground points are baked into the mesh
        // and `lidarShaded` only carries non-ground classes. Sample both so
        // the slice covers the rock face regardless of display mode.
        const cloudProfile = cloud
            ? extractPolylineSliceProfile(cloud, points, corridor, filter)
            : null;
        const meshProfile = mesh && (!filter || filter.has(2))
            ? extractPolylineSliceProfile(meshAsSliceSource(mesh), points, corridor, filter)
            : null;
        if (cloudProfile && meshProfile) return mergeSliceProfiles(cloudProfile, meshProfile);
        return cloudProfile ?? meshProfile;
    }, [cloud, mesh, points, corridor, classes]);
}

/**
 * Bottom-panel content for the cliff-slice tool. Owns the entire UI: header
 * controls (trace toggle, corridor, class chips, color modes, clear) and the
 * chart + stations side panel. Profile may be null while the user is still
 * placing points or the corridor is empty.
 */
export function CliffBottomPanel({ profile }: Readonly<{ profile: SliceProfile | null }>) {
    const isMobile = useIsMobile();
    const cloud = useMapStore((s) => s.lidarShaded);
    const mesh = useMapStore((s) => s.lidarMesh);
    const active = useMapStore((s) => s.cliffSliceActive);
    const setActive = useMapStore((s) => s.setCliffSliceActive);
    const points = useMapStore((s) => s.cliffSlicePoints);
    const popPoint = useMapStore((s) => s.removeLastCliffSlicePoint);
    const corridor = useMapStore((s) => s.cliffSliceCorridor);
    const setCorridor = useMapStore((s) => s.setCliffSliceCorridor);
    const sliceClasses = useMapStore((s) => s.cliffSliceClasses);
    const toggleSliceClass = useMapStore((s) => s.toggleCliffSliceClass);
    const colorClass = useMapStore((s) => s.cliffSliceColorClass);
    const setColorClass = useMapStore((s) => s.setCliffSliceColorClass);
    const colorDepth = useMapStore((s) => s.cliffSliceColorDepth);
    const setColorDepth = useMapStore((s) => s.setCliffSliceColorDepth);
    const stations = useMapStore((s) => s.cliffSliceStations);
    const removeStation = useMapStore((s) => s.removeCliffSliceStation);
    const clearStations = useMapStore((s) => s.clearCliffSliceStations);
    const setLabel = useMapStore((s) => s.setCliffSliceStationLabel);
    const safety = useMapStore((s) => s.cliffSliceRopeSafety);
    const setSafety = useMapStore((s) => s.setCliffSliceRopeSafety);
    const theme = useMapStore((s) => s.uiTheme);
    const clearAll = useMapStore((s) => s.clearCliffSlice);

    const segments = useMemo(() => ropeSegments(stations, safety), [stations, safety]);
    const totals = useMemo(() => ropeTotals(segments), [segments]);
    const [stationsOpen, setStationsOpen] = useState(true);

    const colorMode = colorModeFromFlags(colorClass, colorDepth);
    const noLidar = cloud === null && mesh === null;

    const plural = points.length > 1 ? 's' : '';
    const traceTitle = active
        ? `Le clic sur la carte ajoute un point (${points.length} déjà placé${plural})`
        : 'Le clic sur la carte ne trace pas';

    return (
        <div className={isMobile ? 'flex flex-col gap-3 px-1 py-1' : 'flex h-full flex-col px-3 py-2'}>
            {/* Header bar: tool toggle + color mode + stats + actions — same layout as RoutePanel */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Tracé on/off */}
                <button
                    type="button"
                    onClick={() => setActive(!active)}
                    className={`rounded-md px-2 py-1 text-xs ring-1 transition ${active ? 'bg-green-50 text-green-700 ring-green-300 dark:bg-green-900/30 dark:text-emerald-400 dark:ring-green-700' : 'bg-gray-100 text-slate-400 ring-gray-200 hover:text-slate-600 dark:bg-slate-800 dark:ring-slate-600'}`}
                    title={traceTitle}
                >
                    {active ? `Tracé (${points.length} pts)` : 'Lecture'}
                </button>

                {/* Pop last point — only useful while actively tracing */}
                {active && points.length > 0 && (
                    <button
                        type="button"
                        onClick={popPoint}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition hover:bg-amber-50 hover:text-amber-600 dark:ring-slate-600 dark:hover:bg-amber-900/30 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Retirer le dernier point"
                    >
                        ↩
                    </button>
                )}

                {/* Corridor width — inline compact slider */}
                <label className="flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-xs ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-600">
                    <span className="text-slate-500 dark:text-slate-400" title="Demi-largeur du couloir échantillonné de chaque côté du plan vertical">Couloir</span>
                    <input
                        aria-label="Largeur du couloir"
                        type="range"
                        min={0.5}
                        max={10}
                        step={0.5}
                        value={corridor}
                        onChange={(e) => setCorridor(Number(e.target.value))}
                        className="h-3 w-20 accent-green-600"
                    />
                    <span className="font-mono text-[10px] text-slate-400">±{corridor.toFixed(1)} m</span>
                </label>

                {/* Class chips — restricted to sol / bâti / végét. haute */}
                <ClassFilterChips choices={SLICE_CLASS_CHOICES} selected={sliceClasses} onToggle={toggleSliceClass} />

                {/* Color mode toggles — class and depth, combinable */}
                <div className="flex gap-0.5 rounded-md bg-gray-100 p-0.5 ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-600">
                    <button
                        type="button"
                        onClick={() => setColorClass(!colorClass)}
                        className={`rounded px-2 py-1 text-xs transition ${colorClass ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Colorer par classe ASPRS"
                        aria-pressed={colorClass}
                    >
                        Classe
                    </button>
                    <button
                        type="button"
                        onClick={() => setColorDepth(!colorDepth)}
                        className={`rounded px-2 py-1 text-xs transition ${colorDepth ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Moduler la luminosité selon la profondeur dans le couloir"
                        aria-pressed={colorDepth}
                    >
                        Profondeur
                    </button>
                </div>

                {/* Stats — only when a profile exists */}
                {profile && (
                    <div className="flex items-center gap-2.5 text-xs text-slate-500">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{profile.length.toFixed(1)} m</span>
                        <span className="text-green-600">↥{(profile.eMax - profile.eMin).toFixed(1)} m</span>
                        <span title="Points dans la coupe">{profile.points.length.toLocaleString('fr-FR')} pts</span>
                    </div>
                )}

                {/* Clear — sole right-side action */}
                <div className="ml-auto">
                    <button
                        type="button"
                        onClick={clearAll}
                        disabled={noLidar}
                        className={`flex items-center justify-center rounded-md text-slate-400 ring-1 ring-gray-200 transition ${noLidar ? 'cursor-not-allowed opacity-50' : 'hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30'} dark:ring-slate-600 ${isMobile ? 'h-9 w-9' : 'h-7 w-7'}`}
                        title="Effacer la coupe et les relais"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Content: chart (or empty state) + collapsible stations */}
            <div className={isMobile ? 'flex flex-col gap-2' : 'mt-2 flex min-h-0 flex-1'}>
                <div className={isMobile ? 'h-40 w-full' : 'min-w-0 flex-1'}>
                    <div className="flex h-full w-full items-center justify-center rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 dark:bg-slate-900 dark:ring-slate-700">
                        {profile ? (
                            <CliffSliceChart
                                profile={profile}
                                stations={stations}
                                colorMode={colorMode}
                                safetyMargin={safety}
                                theme={theme}
                            />
                        ) : (
                            <CliffEmptyState noLidar={noLidar} pointCount={points.length} />
                        )}
                    </div>
                </div>

                {/* Stations side panel — desktop only, requires a profile */}
                {!isMobile && profile && (
                    <StationsSidePanel
                        open={stationsOpen}
                        setOpen={setStationsOpen}
                        stations={stations}
                        segments={segments}
                        totals={totals}
                        safety={safety}
                        onLabel={setLabel}
                        onRemove={removeStation}
                        onClear={clearStations}
                        onSafetyChange={setSafety}
                    />
                )}
            </div>

            {/* Mobile stations list — only when there's a profile */}
            {isMobile && profile && (
                <div className="mt-1 overflow-hidden rounded-md bg-white ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
                    {stations.map((s, i) => (
                        <StationRow
                            key={s.id}
                            index={i}
                            station={s}
                            segment={i > 0 ? segments[i - 1] : null}
                            onLabel={setLabel}
                            onRemove={removeStation}
                        />
                    ))}
                    {stations.length >= 2 && (
                        <div className="border-t border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
                            <strong>Corde totale : {totals.total.toFixed(1)} m</strong>
                            {' · '}plus longue {totals.longest.toFixed(1)} m
                        </div>
                    )}
                    <label className="block border-t border-gray-200 px-3 py-2 dark:border-slate-700">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                            <span title="Marge appliquée à la longueur 3D directe pour obtenir la corde recommandée">
                                Marge corde
                            </span>
                            <span className="font-mono text-slate-400">+{Math.round(safety * 100)} %</span>
                        </div>
                        <input
                            aria-label="Marge de sécurité corde"
                            type="range"
                            min={0}
                            max={0.5}
                            step={0.05}
                            value={safety}
                            onChange={(e) => setSafety(Number(e.target.value))}
                            className="mt-1 w-full accent-green-600"
                        />
                    </label>
                </div>
            )}
        </div>
    );
}

function CliffEmptyState({ noLidar, pointCount }: Readonly<{ noLidar: boolean; pointCount: number }>) {
    let message: string;
    if (noLidar) {
        message = 'Chargez un nuage de points LiDAR (panneau LiDAR) avant de tracer une coupe.';
    } else if (pointCount === 0) {
        message = 'Cliquez sur la carte pour ajouter le premier point de la coupe.';
    } else if (pointCount === 1) {
        message = 'Ajoutez au moins un second point pour calculer la coupe.';
    } else {
        message = 'Aucun point LiDAR trouvé dans le couloir — élargissez le couloir ou ajustez les classes.';
    }
    return (
        <p className="max-w-md px-4 text-center text-xs text-slate-500 dark:text-slate-400">
            {message}
        </p>
    );
}
