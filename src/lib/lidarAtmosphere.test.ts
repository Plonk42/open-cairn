import { describe, it, expect } from 'vitest';
import { atmosphereFromSun, type AtmosphereParams } from './lidarAtmosphere';

const noon: AtmosphereParams = {
    sunDir: [0.2, -0.3, 0.93],
    sunColor: [1, 0.98, 0.95],
    sunIntensity: 1,
    flat: 0,
    ambient: 1,
    sunStrength: 1,
};

describe('atmosphereFromSun', () => {
    it('gives a distinctly blue sky ambient at midday', () => {
        const a = atmosphereFromSun(noon);
        expect(a.sky[2]).toBeGreaterThan(a.sky[1]);
        expect(a.sky[1]).toBeGreaterThan(a.sky[0]);
    });

    it('makes the ground bounce warmer than the sky', () => {
        const a = atmosphereFromSun(noon);
        const skyRatio = a.sky[0] / a.sky[2];
        const bounceRatio = a.bounce[0] / a.bounce[2];
        expect(bounceRatio).toBeGreaterThan(skyRatio);
    });

    it('puts sunlit snow well above 1.0 and shadowed snow well below it', () => {
        const a = atmosphereFromSun(noon);
        const albedo = 0.85;
        // Up-facing snow, sun overhead: ambient is the full sky term.
        const lit = albedo * (a.sky[1] + a.sun[1]);
        const shadow = albedo * a.sky[1];
        // Over 1.0 so the tone curve has headroom to roll off, but not so far
        // past the shoulder that every lit surface flattens to the same white.
        expect(lit).toBeGreaterThan(1.2);
        expect(lit).toBeLessThan(2.2);
        expect(shadow).toBeLessThan(0.35);
        // The high-contrast alpine look needs roughly a 5:1 to 10:1 ratio.
        expect(lit / shadow).toBeGreaterThan(4);
        expect(lit / shadow).toBeLessThan(12);
    });

    it('scales the direct term with sunStrength and the ambient with ambient', () => {
        const base = atmosphereFromSun(noon);
        const bright = atmosphereFromSun({ ...noon, sunStrength: 2 });
        const lifted = atmosphereFromSun({ ...noon, ambient: 2 });
        expect(bright.sun[1]).toBeCloseTo(base.sun[1] * 2, 5);
        expect(bright.sky[1]).toBeCloseTo(base.sky[1], 5);
        expect(lifted.sky[1]).toBeCloseTo(base.sky[1] * 2, 5);
    });

    it('dims and desaturates the sky as the sun drops to the horizon', () => {
        const high = atmosphereFromSun(noon);
        const low = atmosphereFromSun({ ...noon, sunDir: [0.99, 0, 0.05] });
        expect(low.sky[2]).toBeLessThan(high.sky[2]);
        expect(low.sky[2] / low.sky[0]).toBeLessThan(high.sky[2] / high.sky[0]);
    });

    it('keeps a usable ambient at night so the cloud never goes black', () => {
        const night = atmosphereFromSun({ ...noon, sunDir: [0.5, 0.5, -0.7], sunIntensity: 0 });
        expect(night.sun[0]).toBe(0);
        expect(night.sky[2]).toBeGreaterThan(0.02);
    });

    it('removes the colour cast in flat (neutral) lighting mode', () => {
        const a = atmosphereFromSun({ ...noon, flat: 1 });
        const spread = Math.max(...a.sky) - Math.min(...a.sky);
        expect(spread).toBeLessThan(0.1);
        expect(a.sun[0]).toBeCloseTo(a.sun[2], 6);
    });

    it('makes the haze brighter than the sky it scatters', () => {
        const a = atmosphereFromSun(noon);
        expect(a.haze[2]).toBeGreaterThan(a.sky[2]);
    });
});
