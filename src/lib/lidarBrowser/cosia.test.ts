import { describe, expect, it } from 'vitest';
import {
    COSIA_CLASSES,
    COVER_BARE,
    COVER_GRASS,
    COVER_NONE,
    COVER_WOOD,
    coverAtMercator,
    coverFromRgb,
    labelCover,
    type CoverGrid,
} from './cosia';

// The class table is the only thing standing between the render and a wrong
// arbitration, and it was recovered by histogramming tiles rather than read off
// a legend: a duplicated colour would silently shadow a class.
describe('COSIA_CLASSES', () => {
    it('maps every colour to a single class', () => {
        const keys = COSIA_CLASSES.map((c) => c.rgb.join(','));
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('coverFromRgb', () => {
    it('recognises the witness colours of each arbitration', () => {
        expect(coverFromRgb(187, 176, 150, 255)).toBe(COVER_BARE);   // Sol nu
        expect(coverFromRgb(233, 239, 254, 255)).toBe(COVER_BARE);   // Neige
        expect(coverFromRgb(140, 215, 106, 255)).toBe(COVER_GRASS);  // Pelouse
        expect(coverFromRgb(76, 145, 41, 255)).toBe(COVER_WOOD);     // Feuillu
        expect(coverFromRgb(18, 100, 33, 255)).toBe(COVER_WOOD);     // Conifère
        expect(coverFromRgb(51, 117, 161, 255)).toBe(COVER_NONE);    // Surface d'eau
    });

    it('rejects a colour that is off by one', () => {
        // The match is exact on purpose: the WMTS renders flat colours, so
        // anything else is an antialiased class boundary, which must not be
        // resolved to whichever class happens to be nearest in RGB.
        expect(coverFromRgb(140, 215, 107, 255)).toBe(COVER_NONE);
    });

    it('treats a transparent pixel as unmeasured', () => {
        expect(coverFromRgb(140, 215, 106, 0)).toBe(COVER_NONE);
        expect(coverFromRgb(140, 215, 106, 254)).toBe(COVER_NONE);
    });
});

/** 2×2 grid spanning a Mercator square, NW = bare, NE = grass, SW = wood. */
function grid2x2(): CoverGrid {
    return {
        cols: 2,
        rows: 2,
        west: 0.5,
        east: 0.6,
        north: 0.3,
        south: 0.4,
        data: new Uint8Array([COVER_BARE, COVER_GRASS, COVER_WOOD, COVER_NONE]),
    };
}

describe('coverAtMercator', () => {
    it('reads row-major from the north-west corner', () => {
        const g = grid2x2();
        expect(coverAtMercator(g, 0.52, 0.32)).toBe(COVER_BARE);
        expect(coverAtMercator(g, 0.58, 0.32)).toBe(COVER_GRASS);
        expect(coverAtMercator(g, 0.52, 0.38)).toBe(COVER_WOOD);
    });

    it('returns unmeasured outside the grid rather than clamping', () => {
        // Clamping would smear the border class over a capture that overflows
        // the mosaic, which reads as a real measurement in the render.
        const g = grid2x2();
        expect(coverAtMercator(g, 0.49, 0.32)).toBe(COVER_NONE);
        expect(coverAtMercator(g, 0.61, 0.32)).toBe(COVER_NONE);
        expect(coverAtMercator(g, 0.52, 0.29)).toBe(COVER_NONE);
        expect(coverAtMercator(g, 0.52, 0.41)).toBe(COVER_NONE);
    });
});

describe('labelCover', () => {
    // A sign error on the north axis would mirror the whole capture without
    // ever failing anything: the render would just be plausibly wrong.
    it('maps a northward offset to a lower row', () => {
        const centerLat = 45;
        const centerLng = 5.5;
        // Mercator span of the grid, centred on the capture: ±1 km at 45°.
        const perMetre = 1 / (40_075_016.686 * Math.cos((centerLat * Math.PI) / 180));
        const half = 1000 * perMetre;
        const x0 = (centerLng + 180) / 360;
        const y0 = (1 - Math.asinh(Math.tan((centerLat * Math.PI) / 180)) / Math.PI) / 2;
        const g: CoverGrid = {
            cols: 1,
            rows: 2,
            west: x0 - half,
            east: x0 + half,
            north: y0 - half,
            south: y0 + half,
            data: new Uint8Array([COVER_WOOD, COVER_BARE]), // north = wood, south = bare
        };
        // One point 500 m north, one 500 m south, one 5 km east (off-grid).
        const positions = new Float32Array([
            0, 500, 0,
            0, -500, 0,
            5000, 0, 0,
        ]);
        const out = labelCover(positions, 3, centerLng, centerLat, g);
        expect(Array.from(out)).toEqual([COVER_WOOD, COVER_BARE, COVER_NONE]);
    });
});
