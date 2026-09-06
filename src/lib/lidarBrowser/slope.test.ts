import { DEFAULT_PALETTE, vertexColor, type PaletteSettings } from '@/lib/lidarBrowser/slope';
import { describe, expect, it } from 'vitest';

/** `vertexColor` sur la palette par défaut (Terrain, calcaire, 2700 m). */
const color = (
    nx: number, ny: number, nz: number, z: number,
    palette: Partial<PaletteSettings> = {},
): [number, number, number] => vertexColor(nx, ny, nz, z, { ...DEFAULT_PALETTE, ...palette });

/** Normale d'une pente d'inclinaison `d`, orientée est : aucun décalage d'exposition. */
const slope = (
    d: number, z: number, palette: Partial<PaletteSettings> = {},
): [number, number, number] => {
    const r = (d * Math.PI) / 180;
    return color(Math.sin(r), 0, Math.cos(r), z, palette);
};

const lum = (c: readonly [number, number, number]): number => (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255;

describe('vertexColor', () => {
    it('returns integer RGB channels in [0, 255]', () => {
        for (const z of [800, 1800, 2400, 3600]) {
            const c = color(0.5, 0.5, 0.7, z);
            expect(c).toHaveLength(3);
            for (const ch of c) {
                expect(Number.isInteger(ch)).toBe(true);
                expect(ch).toBeGreaterThanOrEqual(0);
                expect(ch).toBeLessThanOrEqual(255);
            }
        }
    });

    it('clamps slopes beyond the rock ramp to the last stop', () => {
        expect(color(1, 0, 0, 1800)).toEqual([128, 124, 116]);
    });

    it('normalizes the input normal before computing slope', () => {
        expect(color(0, 0, 5, 1000)).toEqual(color(0, 0, 1, 1000));
    });

    it('treats downward normals the same as upward (uses |nz|)', () => {
        expect(color(0, 0, -1, 1000)).toEqual(color(0, 0, 1, 1000));
    });

    it('colours a flat upward-facing point as alpine meadow', () => {
        const flat = color(0, 0, 1, 1000);
        expect(flat[1]).toBeGreaterThan(flat[0]);
        expect(flat[1]).toBeGreaterThan(flat[2] + 50);
    });

    it('keeps alpine turf on a 35° shoulder and bares the rock only above', () => {
        // Sur la Dent de Crolles l'épaulement herbeux est mesuré à 30-35° par la
        // carte de pente : il doit rester vert, la roche n'apparaît qu'au-delà.
        const shoulder = slope(33, 1800);
        expect(shoulder[1]).toBeGreaterThan(shoulder[2] + 35);
        const band = slope(55, 1800);
        expect(band[2]).toBeGreaterThan(band[1] - 20);
        expect(lum(band)).toBeGreaterThan(lum(shoulder));
    });

    it('stays in the physical reflectance range', () => {
        // Meadow ρ ≈ 0.20, clean limestone ρ ≈ 0.40 — i.e. sRGB luminance around
        // 0.5 and 0.66. Anything brighter saturates to white as soon as the
        // photorealistic path adds the sun on top of it.
        expect(lum(color(0, 0, 1, 1000))).toBeLessThan(0.55);
        expect(lum(slope(45, 1000))).toBeLessThan(0.72);
    });

    it('bakes no aspect shading: a north and a south face of the same rock match', () => {
        // Même pente, même altitude, orientations opposées — bien en dessous de
        // la ligne de neige, donc son décalage d'exposition ne peut pas jouer.
        expect(color(0, 0.9, 0.44, 1200)).toEqual(color(0, -0.9, 0.44, 1200));
    });

    it('puts alpine meadow, not bare rock, on a gentle slope at Chartreuse altitude', () => {
        const shoulder = color(0, 0.5, 0.87, 2000);
        expect(shoulder[1]).toBeGreaterThan(shoulder[0]);
        expect(shoulder[1]).toBeGreaterThan(shoulder[2] + 40);
    });

    it('leaves no snow at Dent de Crolles altitude, whatever the aspect', () => {
        for (const [nx, ny] of [[0, 1], [0, -1], [1, 0]] as const) {
            const c = color(nx * 0.3, ny * 0.3, 0.95, 2062);
            expect(lum(c)).toBeLessThan(0.6);
        }
    });

    it('puts bright snow on high gentle ground and bare rock on a high vertical wall', () => {
        const snowfield = color(0, 0, 1, 3200, { rock: 'granite' });
        const wall = color(1, 0, 0, 3200, { rock: 'granite' });
        expect(lum(snowfield)).toBeGreaterThan(0.85);
        expect(lum(wall)).toBeLessThan(0.35);
    });

    it('holds snow lower on north faces than on south faces', () => {
        // 3000 m, 45° : au-dessus de la limite des neiges décalée au nord, en
        // dessous de celle décalée au sud.
        expect(lum(color(0, 1, 1, 3000))).toBeGreaterThan(lum(color(0, -1, 1, 3000)));
    });

    it('colours flat ground green and near-vertical faces a bright violet/pink (slope preset)', () => {
        const flat = color(0, 0, 1, 1000, { preset: 'slope' });
        expect(flat).toEqual([34, 139, 58]);
        const vertical = color(1, 0, 0, 1000, { preset: 'slope' });
        expect(vertical).toEqual([236, 160, 240]);
        // The steep end must stay bright/legible, not fade toward black.
        expect(Math.max(...vertical)).toBeGreaterThan(150);
    });
});

describe('snow line', () => {
    it('pulls the vegetation cover back and pales the ground as it comes down', () => {
        // Même pente, même altitude : seul le réglage change. Plus la ligne de
        // neige descend, plus la prairie est proche de sa limite climatique :
        // elle pâlit, perd son vert, puis cède la place au caillou.
        const lush = color(0, 0, 1, 1800, { snowLine: 3400 });
        const bare = color(0, 0, 1, 1800, { snowLine: 2000 });
        expect(lum(bare)).toBeGreaterThan(lum(lush));
        expect(bare[1] - bare[2]).toBeLessThan(lush[1] - lush[2]);
    });

    it('leaves the bare rock of the cliff bands alone', () => {
        expect(color(1, 0, 0.2, 1800, { snowLine: 3400 })).toEqual(color(1, 0, 0.2, 1800, { snowLine: 2000 }));
    });

    it('moves the snow with the setting', () => {
        // 2200 m, terrain doux : sous la ligne par défaut (alpage), très
        // au-dessus d'une ligne abaissée à 1500 m (névé). C'est ce réglage, et
        // non un preset, qui fait la saison.
        expect(lum(color(0, 0, 1, 2200, { snowLine: 2700 }))).toBeLessThan(0.6);
        expect(lum(color(0, 0, 1, 2200, { snowLine: 1500 }))).toBeGreaterThan(0.8);
    });
});

describe('snow amount', () => {
    it('plasters the slope further as the pack thickens', () => {
        const thin = lum(slope(50, 3400, { snowAmount: 0 }));
        const mid = lum(slope(50, 3400, { snowAmount: 0.5 }));
        const thick = lum(slope(50, 3400, { snowAmount: 1 }));
        expect(thin).toBeLessThan(mid);
        expect(mid).toBeLessThan(thick);
    });

    it('reaches a steep wall that no snow line can whiten', () => {
        // La raison d'être du curseur : sous la pente limite, descendre la ligne
        // de neige ne change rien du tout à une paroi.
        expect(slope(65, 3400, { snowLine: 1200 })).toEqual(slope(65, 3400, { snowLine: 3000 }));
        expect(lum(slope(65, 3400, { snowAmount: 1 }))).toBeGreaterThan(lum(slope(65, 3400)) + 0.1);
    });

    it('sharpens the lower limit instead of trailing off in scattered patches', () => {
        // 300 m au-dessus de la ligne, sur un replat orienté est pour écarter le
        // décalage d'exposition : déjà couvert sous un gros manteau, encore à
        // moitié nu sous un manteau maigre.
        expect(lum(slope(5, 3000, { snowAmount: 1 }))).toBeGreaterThan(0.85);
        expect(lum(slope(5, 3000, { snowAmount: 0 }))).toBeLessThan(0.75);
    });

    it('leaves the alpine meadow alone', () => {
        // L'alpage se cale sur le climat du massif, pas sur les chutes de l'hiver.
        expect(color(0, 0, 1, 1800, { snowAmount: 0 })).toEqual(color(0, 0, 1, 1800, { snowAmount: 1 }));
    });
});

describe('lithology', () => {
    // 2600 m avec la ligne par défaut : au-dessus de l'alpage, en dessous des
    // névés — de la roche nue, et rien d'autre.
    it('darkens from limestone to granite to schist at equal slope', () => {
        const limestone = lum(slope(40, 2600, { rock: 'limestone' }));
        const granite = lum(slope(40, 2600, { rock: 'granite' }));
        const schist = lum(slope(40, 2600, { rock: 'schist' }));
        expect(limestone).toBeGreaterThan(granite);
        expect(granite).toBeGreaterThan(schist);
        // Un schiste ardoisier réfléchit environ deux fois moins qu'un calcaire lavé.
        expect(schist).toBeLessThan(limestone * 0.65);
    });

    it('brightens limestone with slope but darkens granite and schist', () => {
        // Le profil de la rampe est aussi caractéristique que la teinte : le
        // calcaire s'éclaircit sur les barres verticales, lavées par le
        // ruissellement, là où le cristallin et le schiste laissent voir la
        // cassure fraîche à mesure que la patine s'en va.
        expect(lum(slope(58, 2600, { rock: 'limestone' })))
            .toBeGreaterThan(lum(slope(30, 2600, { rock: 'limestone' })));
        expect(lum(slope(55, 2600, { rock: 'granite' })))
            .toBeLessThan(lum(slope(25, 2600, { rock: 'granite' })));
        expect(lum(slope(55, 2600, { rock: 'schist' })))
            .toBeLessThan(lum(slope(25, 2600, { rock: 'schist' })));
    });

    it('never falls below the darkest plausible rock reflectance', () => {
        // ρ ≈ 0.15 est le plancher d'une roche réelle : en dessous, le rendu
        // photoréaliste ne peut plus rien en tirer, la paroi devient un trou noir.
        for (const rock of ['limestone', 'granite', 'schist'] as const) {
            for (const d of [0, 30, 60, 90]) {
                expect(lum(slope(d, 2600, { rock }))).toBeGreaterThan(0.2);
            }
        }
    });

    it('does not tint the snow', () => {
        expect(color(0, 0, 1, 3400, { rock: 'limestone' })).toEqual(color(0, 0, 1, 3400, { rock: 'schist' }));
    });
});
