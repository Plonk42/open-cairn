import { describe, expect, it } from 'vitest';
import { atmosphereFromSun, type AtmosphereParams } from './lidarAtmosphere';
import { skyFromAtmosphere } from './skyPaint';

const noon: AtmosphereParams = {
    sunDir: [0.2, -0.3, 0.93],
    sunColor: [1, 0.96, 0.9],
    sunIntensity: 1,
    flat: 0,
    ambient: 1,
    sunStrength: 1,
};

/** `rgb(r, g, b)` → `[r, g, b]`. */
function rgb(css: string): [number, number, number] {
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(css);
    if (!m) throw new Error(`not an rgb() colour: ${css}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe('skyFromAtmosphere', () => {
    it('paints a blue zenith at noon', () => {
        const [r, g, b] = rgb(skyFromAtmosphere(atmosphereFromSun(noon), 1)['sky-color']);
        expect(b).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(r);
        // Deep sky, not a washed-out pastel.
        expect(r).toBeLessThan(140);
        expect(b).toBeGreaterThan(140);
    });

    it('keeps the horizon brighter and paler than the zenith', () => {
        const sky = skyFromAtmosphere(atmosphereFromSun(noon), 1);
        const [zr, , zb] = rgb(sky['sky-color']);
        const [hr, , hb] = rgb(sky['horizon-color']);
        expect(hb).toBeGreaterThan(zb);
        // Paleness = how close red has caught up with blue.
        expect(hr / hb).toBeGreaterThan(zr / zb);
    });

    it('fogs the terrain with the horizon colour so the two meet seamlessly', () => {
        const sky = skyFromAtmosphere(atmosphereFromSun(noon), 1);
        expect(sky['fog-color']).toBe(sky['horizon-color']);
    });

    it('darkens with the sun', () => {
        const dusk = { ...noon, sunDir: [0.99, 0, 0.05] as const, sunIntensity: 0.2 };
        const [, , dayB] = rgb(skyFromAtmosphere(atmosphereFromSun(noon), 1)['horizon-color']);
        const [, , duskB] = rgb(skyFromAtmosphere(atmosphereFromSun(dusk), 1)['horizon-color']);
        expect(duskB).toBeLessThan(dayB);
    });

    it('follows the exposure slider', () => {
        const atmo = atmosphereFromSun(noon);
        const [, , dim] = rgb(skyFromAtmosphere(atmo, 0.5)['sky-color']);
        const [, , bright] = rgb(skyFromAtmosphere(atmo, 2)['sky-color']);
        expect(bright).toBeGreaterThan(dim);
    });
});
