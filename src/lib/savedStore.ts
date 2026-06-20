import { useSyncExternalStore } from 'react';

/**
 * A tiny reactive wrapper around a synchronous, externally-mutated source
 * (e.g. a localStorage-backed list). Replaces the previous DOM `CustomEvent`
 * change-notification scheme so that components subscribe through React's
 * `useSyncExternalStore` instead of `window.addEventListener`.
 *
 * The snapshot is cached and only recomputed on `notify()`, which keeps the
 * reference stable between mutations (required by `useSyncExternalStore`).
 */
export interface SavedStore<T> {
    getSnapshot: () => T;
    subscribe: (listener: () => void) => () => void;
    /** Recompute the snapshot from the source and notify all subscribers. */
    notify: () => void;
}

export function createSavedStore<T>(read: () => T): SavedStore<T> {
    const listeners = new Set<() => void>();
    let snapshot = read();
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify() {
            snapshot = read();
            for (const listener of listeners) listener();
        },
    };
}

/** React hook returning the current snapshot of a {@link SavedStore}. */
export function useSavedStore<T>(store: SavedStore<T>): T {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
