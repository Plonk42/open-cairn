import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer } from './components/map/MapContainer';
import { LayerSwitcher } from './components/ui/LayerSwitcher';
import { RoutePanel } from './components/ui/RoutePanel';
import { SettingsPanel } from './components/ui/SettingsPanel';
import { buildShareUrl } from './lib/shareView';
import { useMapStore } from './stores/mapStore';
import { useRouteStore } from './stores/routeStore';

type RightTab = 'layers' | 'settings';

export function App() {
    const [rightOpen, setRightOpen] = useState(true);
    const [rightTab, setRightTab] = useState<RightTab>('layers');
    const [bottomOpen, setBottomOpen] = useState(true);
    const [bottomHeight, setBottomHeight] = useState(330);
    const [shareTooltip, setShareTooltip] = useState(false);
    const resizingRef = useRef(false);
    const uiTheme = useMapStore((s) => s.uiTheme);

    const handleShare = useCallback(() => {
        const map = useMapStore.getState();
        const route = useRouteStore.getState();
        const url = buildShareUrl({
            view: map.view,
            baseLayer: map.baseLayer,
            hillshadeEnabled: map.hillshadeEnabled,
            hillshadeSource: map.hillshadeSource,
            hillshadeBlend: map.hillshadeBlend,
            hillshadeIntensity: map.hillshadeIntensity,
            terrainEnabled: map.terrainEnabled,
            terrainExaggeration: map.terrainExaggeration,
            contourLinesEnabled: map.contourLinesEnabled,
            contourLinesOpacity: map.contourLinesOpacity,
            renderQuality: map.renderQuality,
            uiTheme: map.uiTheme,
            routeActive: route.active,
            routeMode: route.mode,
            colorElevationBySlope: route.colorElevationBySlope,
            waypoints: route.waypoints,
        });
        navigator.clipboard.writeText(url);
        setShareTooltip(true);
        setTimeout(() => setShareTooltip(false), 2000);
    }, []);

    const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        resizingRef.current = true;
        const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const startHeight = bottomHeight;

        const onMove = (ev: MouseEvent | TouchEvent) => {
            const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
            const delta = startY - clientY;
            setBottomHeight(Math.max(120, Math.min(window.innerHeight * 0.7, startHeight + delta)));
        };
        const onEnd = () => {
            resizingRef.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('touchend', onEnd);
    }, [bottomHeight]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', uiTheme === 'dark');
    }, [uiTheme]);

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Main area: map + right sidebar */}
            <div className="relative flex min-h-0 flex-1">
                {/* Map fills remaining space */}
                <div className="relative flex-1">
                    <MapContainer />
                    {/* App title badge */}
                    <div className="pointer-events-none absolute left-3 top-3 z-10 select-none">
                        <div className="flex items-center gap-1.5 rounded-lg bg-white/85 px-3 py-1.5 text-sm font-semibold shadow-sm backdrop-blur-md ring-1 ring-black/5 dark:bg-slate-900/70 dark:ring-white/10">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-4 w-3.5 text-green-600 dark:text-emerald-400">
                                <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                                <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                                <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                                <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                            </svg>
                            <span className="text-slate-700 dark:text-slate-100">open-cairn</span>
                            <button
                                type="button"
                                onClick={handleShare}
                                className="pointer-events-auto relative ml-1.5 flex items-center gap-1 rounded-md bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 transition hover:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                                title="Partager la vue actuelle"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                    <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
                                    <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                                </svg>
                                Partager
                                {shareTooltip && (
                                    <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow dark:bg-slate-700">
                                        Lien copié !
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right sidebar */}
                <div className={`relative z-10 flex flex-shrink-0 transition-[width] duration-200 ${rightOpen ? 'w-72' : 'w-0'}`}>
                    {/* Tab bar on the edge */}
                    <div className="absolute -left-10 top-3 z-20 flex flex-col gap-1">
                        <button
                            type="button"
                            onClick={() => { setRightOpen(true); setRightTab('layers'); }}
                            className={`flex h-9 w-9 items-center justify-center rounded-l-lg shadow-sm transition ring-1 ${rightOpen && rightTab === 'layers' ? 'bg-white text-green-600 ring-black/5 dark:bg-slate-800 dark:text-emerald-400 dark:ring-white/10' : 'bg-white/80 text-slate-400 ring-black/5 hover:text-slate-600 dark:bg-slate-900/80 dark:ring-white/10 dark:hover:text-slate-200'}`}
                            title="Couches"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setRightOpen(true); setRightTab('settings'); }}
                            className={`flex h-9 w-9 items-center justify-center rounded-l-lg shadow-sm transition ring-1 ${rightOpen && rightTab === 'settings' ? 'bg-white text-green-600 ring-black/5 dark:bg-slate-800 dark:text-emerald-400 dark:ring-white/10' : 'bg-white/80 text-slate-400 ring-black/5 hover:text-slate-600 dark:bg-slate-900/80 dark:ring-white/10 dark:hover:text-slate-200'}`}
                            title="Réglages"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.971.41 1.416.69l1.38-.588a1 1 0 011.12.258l.962.962a1 1 0 01.258 1.12l-.588 1.38c.28.445.511.919.69 1.416l1.473.295A1 1 0 0119 9.32v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.41.971-.69 1.416l.588 1.38a1 1 0 01-.258 1.12l-.962.962a1 1 0 01-1.12.258l-1.38-.588c-.445.28-.919.511-1.416.69l-.295 1.473A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.69l-1.38.588a1 1 0 01-1.12-.258l-.962-.962a1 1 0 01-.258-1.12l.588-1.38a7.957 7.957 0 01-.69-1.416l-1.473-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.41-.971.69-1.416l-.588-1.38a1 1 0 01.258-1.12l.962-.962a1 1 0 011.12-.258l1.38.588c.445-.28.919-.511 1.416-.69l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                            </svg>
                        </button>
                        {rightOpen && (
                            <button
                                type="button"
                                onClick={() => setRightOpen(false)}
                                className="flex h-9 w-9 items-center justify-center rounded-l-lg bg-white/80 text-slate-400 shadow-sm ring-1 ring-black/5 transition hover:text-slate-600 dark:bg-slate-900/80 dark:ring-white/10 dark:hover:text-slate-200"
                                title="Fermer le panneau"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {rightOpen && (
                        <div className="flex h-full w-72 flex-col overflow-y-auto border-l border-gray-200/60 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95">
                            <div className="flex-1 p-3">
                                {rightTab === 'layers' && <LayerSwitcher />}
                                {rightTab === 'settings' && <SettingsPanel />}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom panel */}
            <div
                className={`relative z-10 flex-shrink-0 border-t border-gray-200/60 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95 ${bottomOpen ? '' : 'max-h-10'}`}
                style={bottomOpen ? { height: `${bottomHeight}px` } : undefined}
            >
                {/* Resize handle */}
                {bottomOpen && (
                    <div
                        onMouseDown={handleResizeStart}
                        onTouchStart={handleResizeStart}
                        className="absolute inset-x-0 -top-1 z-30 flex h-2 cursor-ns-resize items-center justify-center"
                    >
                        <div className="h-0.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
                    </div>
                )}
                {/* Collapse toggle */}
                <button
                    type="button"
                    onClick={() => setBottomOpen((v) => !v)}
                    className="absolute -top-8 left-1/2 z-20 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-t-lg bg-white/90 px-3 text-xs text-slate-600 shadow-sm ring-1 ring-black/5 transition hover:text-slate-900 dark:bg-slate-800/90 dark:text-slate-300 dark:ring-white/10 dark:hover:text-slate-100"
                    title={bottomOpen ? 'Réduire' : 'Agrandir'}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${bottomOpen ? '' : 'rotate-180'}`}>
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                    <span>Itinéraire</span>
                </button>
                {bottomOpen && (
                    <div className="h-full overflow-hidden">
                        <RoutePanel />
                    </div>
                )}
            </div>
        </div>
    );
}
