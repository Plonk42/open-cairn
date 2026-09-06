import { DEFAULT_SNOW_LINE, vertexColor } from '@/lib/lidarBrowser/slope';
import { describe, expect, it } from 'vitest';

type Preset = Parameters<typeof vertexColor>[4];

/** `vertexColor` à la ligne de neige par défaut, sauf mention contraire. */
const color = (
    nx: number, ny: number, nz: number, z: number,
    preset: Preset, snowLine = DEFAULT_SNOW_LINE,
): [number, number, number] => vertexColor(nx, ny, nz, z, preset, snowLine);

const lum = (c: readonly [number, number, number]): number => (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255;

describe('cliff preset', () => {
    it('returns integer RGB channels in [0, 255]', () => {
        const c = color(Math.sin(0.6), 0, Math.cos(0.6), 1800, 'cliff'); // ~34°
        expect(c).toHaveLength(3);
        for (const ch of c) {
            expect(Number.isInteger(ch)).toBe(true);
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
        }
    });

    it('clamps slopes beyond the rock palette to the last stop', () => {
        expect(color(1, 0, 0, 1800, 'cliff')).toEqual([128, 124, 116]);
    });
});

describe('vertexColor', () => {
    it('colours a flat upward-facing point as alpine meadow (cliff preset)', () => {
        const flat = color(0, 0, 1, 1000, 'cliff');
        expect(flat[1]).toBeGreaterThan(flat[0]);
        expect(flat[1]).toBeGreaterThan(flat[2] + 50);
    });

    it('keeps alpine turf on a 35° shoulder and bares the rock only above', () => {
        // Sur la Dent de Crolles l'épaulement herbeux est mesuré à 30-35° par la
        // carte de pente : il doit rester vert, la roche n'apparaît qu'au-delà.
        const deg = (d: number): [number, number, number] => {
            const r = (d * Math.PI) / 180;
            return color(Math.sin(r), 0, Math.cos(r), 1800, 'cliff');
        };
        const shoulder = deg(33);
        expect(shoulder[1]).toBeGreaterThan(shoulder[2] + 35);
        const band = deg(55);
        expect(band[2]).toBeGreaterThan(band[1] - 20);
        expect(lum(band)).toBeGreaterThan(lum(shoulder));
    });

    it('keeps the summer preset in the physical reflectance range', () => {
        // Meadow ρ ≈ 0.20, clean limestone ρ ≈ 0.40 — i.e. sRGB luminance around
        // 0.5 and 0.66. Anything brighter saturates to white as soon as the
        // photorealistic path adds the sun on top of it.
        expect(lum(color(0, 0, 1, 1000, 'cliff'))).toBeLessThan(0.55);
        expect(lum(color(1, 0, 1, 1000, 'cliff'))).toBeLessThan(0.72);
    });

    it('normalizes the input normal before computing slope', () => {
        // A non-unit upward normal should give the same colour as the unit one.
        expect(color(0, 0, 5, 1000, 'cliff')).toEqual(color(0, 0, 1, 1000, 'cliff'));
    });

    it('treats downward normals the same as upward (uses |nz|)', () => {
        expect(color(0, 0, -1, 1000, 'cliff')).toEqual(color(0, 0, 1, 1000, 'cliff'));
    });

    it('returns valid RGB for the winter preset on a steep north face', () => {
        const c = color(0, 1, 0.2, 2000, 'winter');
        expect(c).toHaveLength(3);
        for (const ch of c) {
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
        }
    });

    it('colours flat ground green and near-vertical faces a bright violet/pink (slope preset)', () => {
        const flat = color(0, 0, 1, 1000, 'slope');
        expect(flat).toEqual([34, 139, 58]);
        const vertical = color(1, 0, 0, 1000, 'slope');
        expect(vertical).toEqual([236, 160, 240]);
        // The steep end must stay bright/legible, not fade toward black.
        expect(Math.max(...vertical)).toBeGreaterThan(150);
    });
});

describe('snow line', () => {
    it('dries the meadow as it approaches the snow line, and only there', () => {
        // Même pente, même altitude : seul le réglage change. Plus la ligne de
        // neige descend, plus la prairie est proche de sa limite climatique,
        // plus elle pâlit et perd son vert.
        const lush = color(0, 0, 1, 1800, 'cliff', 3400);
        const dry = color(0, 0, 1, 1800, 'cliff', 2000);
        expect(lum(dry)).toBeGreaterThan(lum(lush));
        expect(dry[1] - dry[2]).toBeLessThan(lush[1] - lush[2]);
    });

    it('leaves the bare limestone of the cliff bands alone', () => {
        expect(color(1, 0, 0.2, 1800, 'cliff', 3400)).toEqual(color(1, 0, 0.2, 1800, 'cliff', 2000));
    });

    it('moves the montagne snow with the setting', () => {
        // 2200 m, terrain doux : sous la ligne par défaut (alpage), très
        // au-dessus d'une ligne abaissée à 1500 m (névé).
        expect(lum(color(0, 0, 1, 2200, 'montagne', 2700))).toBeLessThan(0.6);
        expect(lum(color(0, 0, 1, 2200, 'montagne', 1500))).toBeGreaterThan(0.8);
    });
});

describe('vertexColor — montagne preset', () => {
    it('bakes no aspect shading: a north and a south face of the same rock match', () => {
        // Same slope, same altitude, opposite bearings — below the snow line so
        // the aspect-shifted snow line cannot legitimately separate them.
        const north = color(0, 0.9, 0.44, 1200, 'montagne');
        const south = color(0, -0.9, 0.44, 1200, 'montagne');
        expect(north).toEqual(south);
    });

    it('keeps rock in the physical reflectance range instead of the legible-under-flat-ambient range', () => {
        const rock = color(0.8, 0, 0.6, 1500, 'montagne');
        expect(lum(rock)).toBeGreaterThan(0.25);
        expect(lum(rock)).toBeLessThan(0.62);
        // Alpine granite is markedly darker than the sunlit limestone of the
        // summer preset — both are albedos, so the gap is a mineral one.
        expect(lum(rock)).toBeLessThan(lum(color(0.8, 0, 0.6, 1500, 'cliff')) - 0.15);
    });

    it('puts bright snow on high gentle ground and bare rock on a high vertical wall', () => {
        const snowfield = color(0, 0, 1, 3200, 'montagne');
        const wall = color(1, 0, 0, 3200, 'montagne');
        expect(lum(snowfield)).toBeGreaterThan(0.85);
        expect(lum(wall)).toBeLessThan(0.35);
    });

    it('holds snow lower on north faces than on south faces', () => {
        // 3000 m, 45° : au-dessus de la limite des neiges décalée au nord, en
        // dessous de celle décalée au sud.
        const north = color(0, 1, 1, 3000, 'montagne');
        const south = color(0, -1, 1, 3000, 'montagne');
        expect(lum(north)).toBeGreaterThan(lum(south));
    });

    it('puts alpine meadow, not bare rock, on a gentle slope at Chartreuse altitude', () => {
        // Épaule herbeuse à ~30° vers 2000 m : le preset ne voyait là que du
        // rocher (et de la neige dès 1700 m en face nord).
        const shoulder = color(0, 0.5, 0.87, 2000, 'montagne');
        expect(shoulder[1]).toBeGreaterThan(shoulder[0]);
        expect(shoulder[1]).toBeGreaterThan(shoulder[2] + 40);
    });

    it('leaves no snow at Dent de Crolles altitude, whatever the aspect', () => {
        for (const [nx, ny] of [[0, 1], [0, -1], [1, 0]] as const) {
            const c = color(nx * 0.3, ny * 0.3, 0.95, 2062, 'montagne');
            expect(lum(c)).toBeLessThan(0.6);
        }
    });

    it('gives open rock a warm granite tint rather than a neutral grey', () => {
        // A 40° south face at 2200 m: above the turf limit, below the
        // south-shifted snow line, so this is bare rock. Lichen, iron staining
        // and sun-baked surfaces make it tan in the reference renders.
        const [r, g, b] = color(0, -Math.sin(0.7), Math.cos(0.7), 2200, 'montagne');
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
        expect(b / r).toBeLessThan(0.8);
    });

    it('returns integer RGB channels in [0, 255]', () => {
        for (const z of [800, 1800, 2400, 3600]) {
            const c = color(0.5, 0.5, 0.7, z, 'montagne');
            for (const ch of c) {
                expect(Number.isInteger(ch)).toBe(true);
                expect(ch).toBeGreaterThanOrEqual(0);
                expect(ch).toBeLessThanOrEqual(255);
            }
        }
    });
});
