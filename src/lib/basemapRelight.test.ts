import { describe, expect, it } from 'vitest';

import { basemapRelight, NEUTRAL_RELIGHT } from '@/lib/basemapRelight';
import type { AtmosphereParams } from '@/lib/lidarAtmosphere';

const base: AtmosphereParams = {
    sunDir: [0.2, -0.3, 0.93],
    sunColor: [1, 0.96, 0.9],
    sunIntensity: 1,
    flat: 0,
    ambient: 1,
    sunStrength: 1,
};

const at = (sunUp: number, intensity = 1): AtmosphereParams => ({
    ...base,
    sunDir: [0.2, -0.3, sunUp],
    sunIntensity: intensity,
});

describe('basemapRelight', () => {
    it('leaves a near-noon basemap essentially as shot', () => {
        const r = basemapRelight(at(0.95), 1);
        expect(r.brightnessMax).toBeGreaterThan(0.9);
        expect(r.brightnessMin).toBeLessThan(0.1);
        expect(r.saturation).toBeGreaterThan(-0.1);
    });

    it('darkens the basemap as the sun drops', () => {
        const noon = basemapRelight(at(0.95), 1);
        const evening = basemapRelight(at(0.25), 0.6);
        const dusk = basemapRelight(at(-0.05, 0.05), 1);
        expect(evening.brightnessMax).toBeLessThan(noon.brightnessMax);
        expect(dusk.brightnessMax).toBeLessThan(evening.brightnessMax);
    });

    it('flattens and desaturates once only skylight is left', () => {
        const noon = basemapRelight(at(0.95), 1);
        const dusk = basemapRelight(at(-0.05, 0.05), 1);
        // Shadows fill in: the black point rises relative to the white point.
        expect(dusk.brightnessMin / dusk.brightnessMax)
            .toBeGreaterThan(noon.brightnessMin / noon.brightnessMax);
        expect(dusk.saturation).toBeLessThan(noon.saturation);
        expect(dusk.saturation).toBeGreaterThanOrEqual(-1);
    });

    it('never takes the basemap to pure black', () => {
        const night = basemapRelight({ ...at(-0.6, 0), ambient: 0 }, 1);
        expect(night.brightnessMax).toBeGreaterThan(0);
        expect(night.brightnessMin).toBeLessThanOrEqual(night.brightnessMax);
    });

    it('darkens with a low exposure but cannot brighten past the photo', () => {
        expect(basemapRelight(at(0.95), 0.4).brightnessMax)
            .toBeLessThan(basemapRelight(at(0.95), 1).brightnessMax);
        expect(basemapRelight(at(0.95), 3).brightnessMax).toBe(NEUTRAL_RELIGHT.brightnessMax);
    });

    it('stays inside the ranges MapLibre accepts', () => {
        for (const up of [-1, -0.2, 0, 0.3, 0.7, 1]) {
            const r = basemapRelight(at(up), 1);
            expect(r.brightnessMin).toBeGreaterThanOrEqual(0);
            expect(r.brightnessMax).toBeLessThanOrEqual(1);
            expect(r.saturation).toBeGreaterThanOrEqual(-1);
            expect(r.saturation).toBeLessThanOrEqual(1);
        }
    });
});
