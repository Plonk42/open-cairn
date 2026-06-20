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

/**
 * A localStorage-backed collection of entities sharing the saved-item shape
 * (`{ id, createdAt }`). Centralizes the JSON read/write, the newest-first
 * sorting and the reactive {@link SavedStore} wiring that `savedRoutes`,
 * `savedClouds` and `savedScenes` all repeated.
 *
 * The heavy-payload IndexedDB handling stays in each module — only the compact
 * localStorage descriptor list is generic.
 */
export interface SavedCollection<T extends { id: string; createdAt?: string }> {
    /** Raw entries as stored (insertion order from localStorage). */
    readAll: () => T[];
    /** Persist the full list and notify subscribers. Tolerates quota errors. */
    writeAll: (items: T[]) => void;
    /** Entries sorted newest-first by `createdAt`. */
    list: () => T[];
    /** Reactive hook returning {@link list}. */
    useItems: () => T[];
}

export function createSavedCollection<T extends { id: string; createdAt?: string }>(
    storageKey: string,
): SavedCollection<T> {
    const readAll = (): T[] => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch {
            return [];
        }
    };

    const list = (): T[] =>
        readAll().sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? 1 : -1));

    const store = createSavedStore(list);

    const writeAll = (items: T[]): void => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(items));
        } catch { /* ignore quota */ }
        store.notify();
    };

    return {
        readAll,
        writeAll,
        list,
        useItems: () => useSavedStore(store),
    };
}
