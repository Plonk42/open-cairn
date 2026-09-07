import { DEFAULT_PALETTE, vertexColor, type PaletteSettings } from '@/lib/lidarBrowser/slope';
import { describe, expect, it } from 'vitest';

/** `vertexColor` on the default palette (Terrain, limestone, 2700 m). */
const color = (
    nx: number, ny: number, nz: number, z: number,
    palette: Partial<PaletteSettings> = {},
): [number, number, number] => vertexColor(nx, ny, nz, z, { ...DEFAULT_PALETTE, ...palette });

/** Normal of a slope of inclination `d`, facing east: no aspect shift at all. */
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
        // On the Dent de Crolles the grassy shoulder is measured at 30-35° by
        // the slope map: it must stay green, the rock only shows up above that.
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
        // Same slope, same altitude, opposite aspects — well below the snow
        // line, so its aspect shift cannot come into play.
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
        // 3000 m, 45°: above the snow line shifted north, below the one shifted
        // south.
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
        // Same slope, same altitude: only the setting changes. The lower the
        // snow line, the closer the meadow is to its climatic limit: it pales,
        // loses its green, then gives way to stone.
        const lush = color(0, 0, 1, 1800, { snowLine: 3400 });
        const bare = color(0, 0, 1, 1800, { snowLine: 2000 });
        expect(lum(bare)).toBeGreaterThan(lum(lush));
        expect(bare[1] - bare[2]).toBeLessThan(lush[1] - lush[2]);
    });

    it('leaves the bare rock of the cliff bands alone', () => {
        expect(color(1, 0, 0.2, 1800, { snowLine: 3400 })).toEqual(color(1, 0, 0.2, 1800, { snowLine: 2000 }));
    });

    it('moves the snow with the setting', () => {
        // 2200 m, gentle ground: below the default line (alpine pasture), well
        // above a line lowered to 1500 m (snowfield). It is this setting, and
        // not a preset, that makes the season.
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
        // The whole point of the slider: below the limit slope, lowering the
        // snow line changes nothing at all on a wall.
        expect(slope(65, 3400, { snowLine: 1200 })).toEqual(slope(65, 3400, { snowLine: 3000 }));
        expect(lum(slope(65, 3400, { snowAmount: 1 }))).toBeGreaterThan(lum(slope(65, 3400)) + 0.1);
    });

    it('sharpens the lower limit instead of trailing off in scattered patches', () => {
        // 300 m above the line, on an east-facing flat to rule out the aspect
        // shift: already covered under a thick pack, still half bare under a
        // thin one.
        expect(lum(slope(5, 3000, { snowAmount: 1 }))).toBeGreaterThan(0.85);
        expect(lum(slope(5, 3000, { snowAmount: 0 }))).toBeLessThan(0.75);
    });

    it('leaves the alpine meadow alone', () => {
        // The alpine pasture follows the climate of the massif, not the
        // winter's snowfalls.
        expect(color(0, 0, 1, 1800, { snowAmount: 0 })).toEqual(color(0, 0, 1, 1800, { snowAmount: 1 }));
    });
});

describe('lithology', () => {
    // 2600 m with the default line: above the pasture, below the snowfields —
    // bare rock, and nothing else.
    it('darkens from limestone to granite to schist at equal slope', () => {
        const limestone = lum(slope(40, 2600, { rock: 'limestone' }));
        const granite = lum(slope(40, 2600, { rock: 'granite' }));
        const schist = lum(slope(40, 2600, { rock: 'schist' }));
        expect(limestone).toBeGreaterThan(granite);
        expect(granite).toBeGreaterThan(schist);
        // A slaty schist reflects about half as much as a washed limestone.
        expect(schist).toBeLessThan(limestone * 0.65);
    });

    it('brightens limestone with slope but darkens granite and schist', () => {
        // The profile of the ramp is as characteristic as the hue: limestone
        // brightens on the vertical bands, washed by runoff, where crystalline
        // rock and schist expose the fresh break as the patina wears off.
        expect(lum(slope(58, 2600, { rock: 'limestone' })))
            .toBeGreaterThan(lum(slope(30, 2600, { rock: 'limestone' })));
        expect(lum(slope(55, 2600, { rock: 'granite' })))
            .toBeLessThan(lum(slope(25, 2600, { rock: 'granite' })));
        expect(lum(slope(55, 2600, { rock: 'schist' })))
            .toBeLessThan(lum(slope(25, 2600, { rock: 'schist' })));
    });

    it('never falls below the darkest plausible rock reflectance', () => {
        // ρ ≈ 0.15 is the floor of a real rock: below that, the photorealistic
        // rendering can do nothing with it and the wall becomes a black hole.
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
