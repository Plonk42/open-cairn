import {
    buildForestGpuTables,
    buildForestPalette,
    classifyForest,
    FOREST_CATEGORIES,
    FOREST_GROUP_COUNT,
    FOREST_NONE,
    FOREST_SPECIES_COUNT,
    resolveForestCategory,
    type ForestPolygon,
} from '@/lib/lidarBrowser/bdforet';
import { lngLatToL93 } from '@/lib/lidarBrowser/proj';
import { describe, expect, it } from 'vitest';

describe('resolveForestCategory', () => {
    it('maps concrete essences to pure species categories', () => {
        expect(resolveForestCategory('Hêtre', '')).toBe(1);
        expect(resolveForestCategory('Sapin, épicéa', '')).toBe(9);
        expect(resolveForestCategory('Chêne décidu', '')).toBe(0);
        expect(resolveForestCategory('Douglas', '')).toBe(11);
    });

    it('maps generic essences to mix categories', () => {
        expect(resolveForestCategory('Feuillus', '')).toBe(4);
        expect(resolveForestCategory('Conifères', '')).toBe(12);
        expect(resolveForestCategory('Mixte', '')).toBe(13);
    });

    it('falls back to tfv_g11 when essence is NC or empty', () => {
        expect(resolveForestCategory('NC', 'Forêt fermée de feuillus')).toBe(4);
        expect(resolveForestCategory('', 'Forêt fermée de conifères')).toBe(12);
        expect(resolveForestCategory('NC', 'Formation herbacée')).toBe(15);
    });

    it('returns the "autre" category for anything unrecognised', () => {
        expect(resolveForestCategory('???', '???')).toBe(16);
    });
});

describe('classifyForest', () => {
    const centerLng = 5.81;
    const centerLat = 45.3;
    const [x0, y0] = lngLatToL93(centerLng, centerLat);

    // A 100 m square stand centred on the capture origin, in absolute L93.
    const square: ForestPolygon = {
        cat: 1,
        rings: [Float32Array.from([
            x0 - 50, y0 - 50,
            x0 + 50, y0 - 50,
            x0 + 50, y0 + 50,
            x0 - 50, y0 + 50,
            x0 - 50, y0 - 50,
        ])],
        minX: x0 - 50, minY: y0 - 50, maxX: x0 + 50, maxY: y0 + 50,
    };

    it('labels vegetation points inside the stand and leaves the rest at FOREST_NONE', () => {
        // point 0: veg inside, point 1: veg outside, point 2: ground inside.
        const positions = Float32Array.from([
            0, 0, 12,
            200, 200, 12,
            10, 10, 0,
        ]);
        const classes = Uint8Array.from([5, 5, 2]);
        const out = classifyForest(positions, 3, classes, centerLng, centerLat, [square]);
        expect(out[0]).toBe(1);
        expect(out[1]).toBe(FOREST_NONE);
        expect(out[2]).toBe(FOREST_NONE);
    });

    it('returns all FOREST_NONE when there are no polygons', () => {
        const positions = Float32Array.from([0, 0, 12]);
        const out = classifyForest(positions, 1, Uint8Array.from([5]), centerLng, centerLat, []);
        expect(out[0]).toBe(FOREST_NONE);
    });
});

describe('buildForestGpuTables', () => {
    it('exposes pure species and mix candidate lists', () => {
        const t = buildForestGpuTables();
        // Hêtre (cat 1) is pure species 1.
        expect(t.catSpecies[1]).toBe(1);
        expect(t.catMixCount[1]).toBe(0);
        // Feuillus mix (cat 4) has 5 candidates, no pure species.
        expect(t.catSpecies[4]).toBe(FOREST_NONE);
        expect(t.catMixCount[4]).toBe(FOREST_CATEGORIES[4].candidates.length);
        const base = t.catMixBase[4];
        const slice = Array.from(t.mixSpecies.slice(base, base + t.catMixCount[4]));
        expect(slice).toEqual(FOREST_CATEGORIES[4].candidates);
    });

    it('records each category group', () => {
        const t = buildForestGpuTables();
        expect(t.catGroup[1]).toBe(0); // Hêtre → Feuillus
        expect(t.catGroup[9]).toBe(1); // Sapin/épicéa → Conifères
    });
});

describe('buildForestPalette', () => {
    it('sizes the palette to the grouping and normalises colors', () => {
        const groups = buildForestPalette('group');
        const species = buildForestPalette('species');
        expect(groups.length).toBe(FOREST_GROUP_COUNT * 3);
        expect(species.length).toBe(FOREST_SPECIES_COUNT * 3);
        for (const v of groups) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of groups) expect(v).toBeLessThanOrEqual(1);
    });
});
