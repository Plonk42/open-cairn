import { MapSlot } from '@/components/map/MapSlot';
import { MobileSheetContent, type MobileTab } from '@/components/panels/PanelTabs';
import { useCallback, useEffect, useRef, useState } from 'react';

export function MobileLayout({ mobileTab, setMobileTab, shareTooltip, handleShare }: Readonly<{
    mobileTab: MobileTab;
    setMobileTab: (tab: MobileTab) => void;
    shareTooltip: boolean;
    handleShare: () => void;
}>) {
    const [sheetHeight, setSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ y: number; height: string } | null>(null);

    // Computed sheet height
    const sheetHeightClass = {
        collapsed: 'h-0',
        half: 'h-[45vh]',
        full: 'h-[85vh]',
    }[sheetHeight];

    // When switching to map tab, collapse sheet
    useEffect(() => {
        if (mobileTab === 'map') setSheetHeight('collapsed');
        else if (sheetHeight === 'collapsed') setSheetHeight('half');
    }, [mobileTab]);

    // Swipe to resize sheet
    const handleSheetDragStart = useCallback((e: React.TouchEvent) => {
        const startY = e.touches[0].clientY;
        dragStartRef.current = { y: startY, height: sheetHeight };

        const onMove = (ev: TouchEvent) => {
            const deltaY = ev.touches[0].clientY - startY;
            const vh = globalThis.innerHeight;
            if (deltaY > vh * 0.15 && sheetHeight !== 'collapsed') {
                // Swiping down
                if (sheetHeight === 'full') setSheetHeight('half');
                else { setSheetHeight('collapsed'); setMobileTab('map'); }
            } else if (deltaY < -vh * 0.1 && sheetHeight !== 'full') {
                // Swiping up
                if (sheetHeight === 'collapsed') setSheetHeight('half');
                else setSheetHeight('full');
            }
        };
        const onEnd = () => {
            dragStartRef.current = null;
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
    }, [sheetHeight, setMobileTab]);

    return (
        <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-gray-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {/* Map always renders, takes available space */}
            <div className="relative min-h-0 flex-1">
                <MapSlot />
                {/* Compact title badge */}
                <div className="pointer-events-none absolute left-2 top-2 z-10 select-none">
                    <div className="flex items-center gap-1 rounded-lg bg-white/85 px-2 py-1 text-xs font-semibold shadow-sm backdrop-blur-md ring-1 ring-black/5 dark:bg-slate-900/70 dark:ring-white/10">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20" fill="currentColor" className="h-3.5 w-3 text-green-600 dark:text-emerald-400">
                            <ellipse cx="8" cy="17" rx="5.5" ry="2" />
                            <ellipse cx="8" cy="12.5" rx="4" ry="1.8" opacity="0.85" />
                            <ellipse cx="8" cy="8.5" rx="2.8" ry="1.5" opacity="0.7" />
                            <circle cx="8" cy="4.5" r="2" opacity="0.9" />
                        </svg>
                        <span className="text-slate-700 dark:text-slate-100">open-cairn</span>
                        <button
                            type="button"
                            onClick={handleShare}
                            className="pointer-events-auto relative ml-1 flex h-6 w-6 items-center justify-center rounded-md bg-green-600/10 text-green-700 transition active:bg-green-600/20 dark:bg-emerald-400/10 dark:text-emerald-300"
                            title="Partager"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M13 4.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM13 15.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM2 10a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z" />
                                <path d="M7 9l5.5-3M7 11l5.5 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            </svg>
                            {shareTooltip && (
                                <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white shadow">
                                    Copié !
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom sheet overlay */}
            {mobileTab !== 'map' && (
                <div
                    ref={sheetRef}
                    className={`flex-shrink-0 overflow-hidden border-t border-gray-200/60 bg-white/95 backdrop-blur-md transition-[height] duration-200 ease-out dark:border-white/10 dark:bg-slate-900/98 ${sheetHeightClass}`}
                >
                    {/* Drag handle */}
                    <div
                        onTouchStart={handleSheetDragStart}
                        className="flex h-6 w-full touch-none items-center justify-center"
                    >
                        <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
                    </div>
                    {/* Sheet content */}
                    <div className="h-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain px-3 pb-2">
                        <MobileSheetContent mobileTab={mobileTab} />
                    </div>
                </div>
            )}

            {/* Bottom tab bar */}
            <nav className="flex-shrink-0 border-t border-gray-200/60 bg-white/95 backdrop-blur-md safe-bottom dark:border-white/10 dark:bg-slate-900/98">
                <div className="flex h-14 items-stretch">
                    <MobileTabButton
                        active={mobileTab === 'map'}
                        label="Carte"
                        onClick={() => setMobileTab('map')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 00-1.147 0l-4.084 1.69A1.5 1.5 0 002 5.25v10.877a1.5 1.5 0 002.074 1.386l3.51-1.452 4.26 1.762a1.5 1.5 0 001.147 0l4.084-1.69A1.5 1.5 0 0018 14.75V3.873a1.5 1.5 0 00-2.074-1.386l-3.51 1.452-4.26-1.763zM7.58 5a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 017.58 5zm5.59 2a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5a.75.75 0 01.75-.75z" clipRule="evenodd" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'layers'}
                        label="Couches"
                        onClick={() => setMobileTab('layers')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M2.5 9.5l7.5 4 7.5-4M2.5 13l7.5 4 7.5-4M10 2L2.5 6 10 10l7.5-4L10 2z" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'lidar'}
                        label="LiDAR"
                        onClick={() => setMobileTab('lidar')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><circle cx="4" cy="6" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="16" cy="7" r="1.2" /><circle cx="6" cy="11" r="1.2" /><circle cx="13" cy="12" r="1.2" /><circle cx="4" cy="16" r="1.2" /><circle cx="11" cy="17" r="1.2" /><circle cx="17" cy="14" r="1.2" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'route'}
                        label="Tracé"
                        onClick={() => setMobileTab('route')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13zm10.857 5.691a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 00-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'routes'}
                        label="Enreg."
                        onClick={() => setMobileTab('routes')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M2 6.75A1.75 1.75 0 013.75 5h3.36c.4 0 .78.135 1.094.384L9.81 6.5h6.44A1.75 1.75 0 0118 8.25v6A1.75 1.75 0 0116.25 16H3.75A1.75 1.75 0 012 14.25v-7.5z" /></svg>}
                    />
                    <MobileTabButton
                        active={mobileTab === 'settings'}
                        label="Réglages"
                        onClick={() => setMobileTab('settings')}
                        icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.971.41 1.416.69l1.38-.588a1 1 0 011.12.258l.962.962a1 1 0 01.258 1.12l-.588 1.38c.28.445.511.919.69 1.416l1.473.295A1 1 0 0119 9.32v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.41.971-.69 1.416l.588 1.38a1 1 0 01-.258 1.12l-.962.962a1 1 0 01-1.12.258l-1.38-.588c-.445.28-.919.511-1.416.69l-.295 1.473A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.69l-1.38.588a1 1 0 01-1.12-.258l-.962-.962a1 1 0 01-.258-1.12l.588-1.38a7.957 7.957 0 01-.69-1.416l-1.473-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.41-.971.69-1.416l-.588-1.38a1 1 0 01.258-1.12l.962-.962a1 1 0 011.12-.258l1.38.588c.445-.28.919-.511 1.416-.69l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>}
                    />
                </div>
            </nav>
        </div>
    );
}

function MobileTabButton({ active, label, icon, onClick }: Readonly<{
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}>) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${active ? 'text-green-600 dark:text-emerald-400' : 'text-slate-400 active:text-slate-600 dark:text-slate-500 dark:active:text-slate-300'}`}
        >
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
        </button>
    );
}
