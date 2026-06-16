import { useCallback, useEffect, useState } from 'react';

/**
 * Top-level application view, selected via the `?view=` search param.
 * `map` is the classic full map shell; `lidar` is the dedicated LiDAR Studio.
 */
export type AppView = 'map' | 'lidar';

/** Read the current view from the URL search params. */
function readView(): AppView {
    const params = new URLSearchParams(globalThis.location.search);
    return params.get('view') === 'lidar' ? 'lidar' : 'map';
}

/**
 * Build the next URL for a given view, preserving the existing hash
 * (MapLibre `#map=` and any `#share=` payload) and other search params.
 */
function buildUrl(view: AppView): string {
    const params = new URLSearchParams(globalThis.location.search);
    if (view === 'map') {
        params.delete('view');
    } else {
        params.set('view', view);
    }
    const query = params.toString();
    const search = query ? `?${query}` : '';
    return `${globalThis.location.pathname}${search}${globalThis.location.hash}`;
}

/**
 * Custom event fired when `setView` mutates the history, so that every
 * `useView` instance (e.g. the one in `Root` and the one in a panel) stays in
 * sync — `history.pushState` alone does not emit `popstate`.
 */
const VIEW_CHANGE_EVENT = 'open-cairn-viewchange';

/**
 * Hook exposing the current top-level view and a setter that updates the
 * `?view=` search param via the History API (no full reload), keeping the
 * hash intact so the map position / share link survive view switches.
 */
export function useView(): { view: AppView; setView: (next: AppView) => void } {
    const [currentView, setCurrentView] = useState<AppView>(() => readView());

    useEffect(() => {
        const sync = () => setCurrentView(readView());
        globalThis.addEventListener('popstate', sync);
        globalThis.addEventListener(VIEW_CHANGE_EVENT, sync);
        return () => {
            globalThis.removeEventListener('popstate', sync);
            globalThis.removeEventListener(VIEW_CHANGE_EVENT, sync);
        };
    }, []);

    const setView = useCallback((next: AppView) => {
        if (next === readView()) return;
        history.pushState(null, '', buildUrl(next));
        globalThis.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
        setCurrentView(next);
    }, []);

    return { view: currentView, setView };
}
