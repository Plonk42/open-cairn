import { parseCoordinates, type ParsedCoordinate } from '@/lib/coordinates';
import { ignAutocomplete, ignSearch, type IgnSuggestion } from '@/lib/ignGeocoding';
import { useMapStore } from '@/stores/mapStore';
import maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SearchBoxProps {
    /** Compact (mobile) variant. */
    compact?: boolean;
    /** Flat variant: no own background/ring/shadow on the input (for nesting in a parent card). */
    flat?: boolean;
}

export function SearchBox({ compact = false, flat = false }: Readonly<SearchBoxProps>) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<IgnSuggestion[]>([]);
    const [highlight, setHighlight] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const coordMarkerRef = useRef<maplibregl.Marker | null>(null);

    // Direct GPS coordinate parse (decimal, DMS, DDM, with or without hemispheres).
    // When set, surfaced as the first suggestion and used as a fallback on submit.
    const parsedCoord = useMemo<ParsedCoordinate | null>(() => parseCoordinates(query), [query]);

    // Debounced autocomplete fetch
    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setSuggestions([]);
            setLoading(false);
            setError(null);
            return;
        }
        const handle = globalThis.setTimeout(() => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setLoading(true);
            setError(null);
            ignAutocomplete(trimmed, controller.signal)
                .then((results) => {
                    if (controller.signal.aborted) return;
                    setSuggestions(results);
                    setHighlight(0);
                })
                .catch((e: unknown) => {
                    if (controller.signal.aborted) return;
                    setError(e instanceof Error ? e.message : 'Erreur');
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        }, 220);
        return () => globalThis.clearTimeout(handle);
    }, [query]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const clearCoordMarker = useCallback(() => {
        coordMarkerRef.current?.remove();
        coordMarkerRef.current = null;
    }, []);

    useEffect(() => clearCoordMarker, [clearCoordMarker]);

    const flyTo = useCallback((s: IgnSuggestion) => {
        if (!mapInstance) return;
        if (s.bbox) {
            mapInstance.fitBounds([[s.bbox[0], s.bbox[1]], [s.bbox[2], s.bbox[3]]], {
                padding: 60,
                duration: 900,
                maxZoom: 15,
            });
        } else {
            mapInstance.flyTo({ center: [s.lng, s.lat], zoom: Math.max(mapInstance.getZoom(), 14), duration: 900 });
        }
    }, [mapInstance]);

    const flyToCoord = useCallback((c: ParsedCoordinate) => {
        if (!mapInstance) return;
        mapInstance.flyTo({ center: [c.lng, c.lat], zoom: Math.max(mapInstance.getZoom(), 14), duration: 900 });
        if (coordMarkerRef.current) {
            coordMarkerRef.current.setLngLat([c.lng, c.lat]);
        } else {
            coordMarkerRef.current = new maplibregl.Marker({ color: '#16a34a' })
                .setLngLat([c.lng, c.lat])
                .addTo(mapInstance);
        }
        coordMarkerRef.current.getElement().title = c.label;
        setSuggestions([]);
        setOpen(false);
    }, [mapInstance]);

    const pick = useCallback((s: IgnSuggestion) => {
        clearCoordMarker();
        setQuery(s.fulltext);
        setSuggestions([]);
        setOpen(false);
        flyTo(s);
    }, [clearCoordMarker, flyTo]);

    const onSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (parsedCoord && (suggestions.length === 0 || highlight === 0)) {
            flyToCoord(parsedCoord);
            return;
        }
        if (suggestions.length > 0) {
            pick(suggestions[Math.max(0, Math.min(highlight, suggestions.length - 1))]);
            return;
        }
        const trimmed = query.trim();
        if (!trimmed) return;
        try {
            setLoading(true);
            const result = await ignSearch(trimmed);
            if (result) pick(result);
            else setError('Aucun résultat');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur');
        } finally {
            setLoading(false);
        }
    }, [flyToCoord, highlight, parsedCoord, pick, query, suggestions]);

    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || suggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    }, [open, suggestions.length]);

    const widthClass = compact ? 'w-56' : 'w-72';

    return (
        <div ref={containerRef} className={`pointer-events-auto relative ${widthClass}`}>
            <form onSubmit={onSubmit} className="relative">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                >
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a.75.75 0 11-1.06 1.06l-3.08-3.08A7 7 0 012 9z" clipRule="evenodd" />
                </svg>
                <input
                    type="search"
                    autoComplete="off"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder="Rechercher un lieu (IGN)…"
                    className={flat
                        ? 'w-full bg-transparent py-1.5 pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500'
                        : 'w-full rounded-lg bg-white/90 py-2 pl-8 pr-8 text-sm text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/60 dark:bg-slate-900/85 dark:text-slate-100 dark:ring-white/10 dark:placeholder:text-slate-500'}
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); clearCoordMarker(); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="Effacer"
                        aria-label="Effacer"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                    </button>
                )}
            </form>
            {open && (suggestions.length > 0 || loading || error || parsedCoord) && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg bg-white/95 shadow-lg ring-1 ring-black/10 backdrop-blur-md dark:bg-slate-900/95 dark:ring-white/10">
                    {parsedCoord && (
                        <button
                            type="button"
                            onClick={() => flyToCoord(parsedCoord)}
                            className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-sm text-slate-700 transition hover:bg-green-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-emerald-900/30"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-emerald-400">
                                <path fillRule="evenodd" d="M10 2a6 6 0 016 6c0 4.31-4.5 9.46-5.59 10.66a.55.55 0 01-.82 0C8.5 17.46 4 12.31 4 8a6 6 0 016-6zm0 4a2 2 0 100 4 2 2 0 000-4z" clipRule="evenodd" />
                            </svg>
                            <span className="flex-1 truncate">
                                <span className="block truncate font-mono text-[12px]">{parsedCoord.label}</span>
                                <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">Coordonnées GPS</span>
                            </span>
                        </button>
                    )}
                    {loading && (
                        <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Recherche…</div>
                    )}
                    {error && !loading && (
                        <div className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</div>
                    )}
                    {!loading && suggestions.map((s, i) => (
                        <button
                            type="button"
                            key={`${s.fulltext}-${i}`}
                            onMouseEnter={() => setHighlight(i)}
                            onClick={() => pick(s)}
                            className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition ${highlight === i
                                ? 'bg-green-50 text-green-900 dark:bg-emerald-900/30 dark:text-emerald-100'
                                : 'text-slate-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800'
                                }`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400">
                                <path fillRule="evenodd" d="M9.69 18.93l.005-.003.027-.018a13.92 13.92 0 001.65-1.367c.952-.95 2.236-2.408 3.235-4.246C16.628 11.388 17.5 9.215 17.5 7a7.5 7.5 0 10-15 0c0 2.215.872 4.388 1.893 6.296.999 1.838 2.283 3.296 3.234 4.246a13.93 13.93 0 001.676 1.385l.027.018.006.004A.85.85 0 0010 19c.142 0 .272-.034.39-.094zM10 9.75A2.25 2.25 0 1010 5.25a2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                            </svg>
                            <span className="flex-1 truncate">
                                <span className="block truncate">{s.fulltext}</span>
                                {(s.city || s.zipcode || s.kind) && (
                                    <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
                                        {[s.zipcode, s.city, s.kind].filter(Boolean).join(' · ')}
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
