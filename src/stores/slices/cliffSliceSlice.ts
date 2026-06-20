import type { CliffStation } from '@/lib/cliffSlice';
import type { LngLatTuple } from '@/lib/geo';
import type { StateCreator } from 'zustand';
import { persisted } from '../persistence';
import type { MapState } from '../mapStore';

export interface CliffSliceSlice {
    /** True while the user is picking points of the slice polyline on the map. */
    cliffSliceActive: boolean;
    setCliffSliceActive: (v: boolean) => void;
    /** Which bottom panel is currently shown: route or cliff. Drives map click routing. */
    bottomMode: 'route' | 'cliff';
    setBottomMode: (m: 'route' | 'cliff') => void;
    /** Polyline vertices in WGS84 (≥2 → slice is drawn). */
    cliffSlicePoints: LngLatTuple[];
    setCliffSlicePoints: (pts: LngLatTuple[]) => void;
    addCliffSlicePoint: (p: LngLatTuple) => void;
    removeLastCliffSlicePoint: () => void;
    /** Half-width of the corridor sampled either side of the slice plane, meters. */
    cliffSliceCorridor: number;
    setCliffSliceCorridor: (v: number) => void;
    /** Apply ASPRS class colors to slice points. */
    cliffSliceColorClass: boolean;
    setCliffSliceColorClass: (v: boolean) => void;
    /** Modulate slice point color by depth (front → bright, back → dim). */
    cliffSliceColorDepth: boolean;
    setCliffSliceColorDepth: (v: boolean) => void;
    /** ASPRS LAS classes kept when extracting the slice profile (empty = all). Default = [2] (Sol). */
    cliffSliceClasses: number[];
    setCliffSliceClasses: (v: number[]) => void;
    toggleCliffSliceClass: (cls: number) => void;
    /** Climber-defined belay stations on the cliff profile. */
    cliffSliceStations: CliffStation[];
    addCliffSliceStation: (d: number, e: number) => void;
    removeCliffSliceStation: (id: string) => void;
    clearCliffSliceStations: () => void;
    /** Replace the whole stations list (used for restoring from share URL). */
    setCliffSliceStations: (stations: CliffStation[]) => void;
    setCliffSliceStationLabel: (id: string, label: string) => void;
    /** Safety margin added to the direct rope length (0.15 = +15 %). */
    cliffSliceRopeSafety: number;
    setCliffSliceRopeSafety: (v: number) => void;
    /** Reset everything (line + stations). */
    clearCliffSlice: () => void;
}

export const createCliffSliceSlice: StateCreator<MapState, [], [], CliffSliceSlice> = (set) => ({
    cliffSliceActive: false,
    setCliffSliceActive: (cliffSliceActive) => set({ cliffSliceActive }),
    bottomMode: 'route',
    setBottomMode: (bottomMode) => set({ bottomMode }),
    cliffSlicePoints: [],
    setCliffSlicePoints: (cliffSlicePoints) => set({ cliffSlicePoints }),
    addCliffSlicePoint: (p) => set((s) => ({ cliffSlicePoints: [...s.cliffSlicePoints, p] })),
    removeLastCliffSlicePoint: () => set((s) => ({ cliffSlicePoints: s.cliffSlicePoints.slice(0, -1) })),
    cliffSliceCorridor: persisted.cliffSliceCorridor ?? 2,
    setCliffSliceCorridor: (cliffSliceCorridor) => set({ cliffSliceCorridor }),
    cliffSliceColorClass: persisted.cliffSliceColorClass ?? true,
    setCliffSliceColorClass: (cliffSliceColorClass) => set({ cliffSliceColorClass }),
    cliffSliceColorDepth: persisted.cliffSliceColorDepth ?? false,
    setCliffSliceColorDepth: (cliffSliceColorDepth) => set({ cliffSliceColorDepth }),
    cliffSliceClasses: persisted.cliffSliceClasses ?? [2],
    setCliffSliceClasses: (cliffSliceClasses) => set({ cliffSliceClasses }),
    toggleCliffSliceClass: (cls) => set((s) => {
        const has = s.cliffSliceClasses.includes(cls);
        return {
            cliffSliceClasses: has
                ? s.cliffSliceClasses.filter((c) => c !== cls)
                : [...s.cliffSliceClasses, cls].sort((a, b) => a - b),
        };
    }),
    cliffSliceStations: [],
    addCliffSliceStation: (d, e) => set((s) => {
        const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        // Preserve click order — climbers chain rappels in the order they
        // place stations, not in left-to-right d order (a route can U-turn).
        return { cliffSliceStations: [...s.cliffSliceStations, { id, d, e }] };
    }),
    removeCliffSliceStation: (id) => set((s) => ({
        cliffSliceStations: s.cliffSliceStations.filter((x) => x.id !== id),
    })),
    clearCliffSliceStations: () => set({ cliffSliceStations: [] }),
    setCliffSliceStations: (cliffSliceStations) => set({ cliffSliceStations }),
    setCliffSliceStationLabel: (id, label) => set((s) => ({
        cliffSliceStations: s.cliffSliceStations.map((st) => st.id === id ? { ...st, label } : st),
    })),
    cliffSliceRopeSafety: persisted.cliffSliceRopeSafety ?? 0.15,
    setCliffSliceRopeSafety: (cliffSliceRopeSafety) => set({ cliffSliceRopeSafety }),
    clearCliffSlice: () => set({
        cliffSlicePoints: [],
        cliffSliceStations: [],
        cliffSliceActive: true,
    }),
});
