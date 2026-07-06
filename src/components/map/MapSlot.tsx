import { useLayoutEffect, useRef } from 'react';

// A single MapLibre instance is created once and shared across every view
// (classic desktop map, mobile, LiDAR Studio). Instead of each view mounting
// its own <MapContainer/> — which destroyed and rebuilt the WebGL context on
// every `?view=` switch — the persistent map's DOM node is *reparented* into
// whichever <MapSlot/> is currently mounted. This registry tracks the active
// slot and notifies the persistent map when it changes.

type Listener = () => void;

let activeSlot: HTMLElement | null = null;
const listeners = new Set<Listener>();

export function getActiveMapSlot(): HTMLElement | null {
    return activeSlot;
}

export function subscribeMapSlot(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function setActiveMapSlot(el: HTMLElement | null): void {
    if (activeSlot === el) return;
    activeSlot = el;
    for (const listener of listeners) listener();
}

/**
 * Positioned placeholder that the shared, persistent map is reparented into.
 *
 * Each view renders exactly one <MapSlot/> where its map area should appear.
 * On mount it becomes the active slot; the single map instance hosted at
 * <Root/> moves its canvas here. Switching views therefore never destroys or
 * rebuilds the map — the same WebGL context, loaded tiles and terrain mesh are
 * simply moved to the new slot.
 */
export function MapSlot({ className }: Readonly<{ className?: string }>) {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        setActiveMapSlot(ref.current);
        return () => {
            // On a view swap the incoming slot may already have claimed the
            // active slot before this cleanup runs — only clear if still ours.
            if (activeSlot === ref.current) setActiveMapSlot(null);
        };
    }, []);
    return <div ref={ref} className={className ?? 'absolute inset-0 h-full w-full'} />;
}
