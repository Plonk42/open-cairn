import { describe, expect, it } from 'vitest';
import { autoResolutionM, copcMaxLevel, densityAt, estimateCapture, RESOLUTION_STOPS_M } from './lidarResolution';

/** Root spacing measured on LHD_FXX_1007_6545 (1 km² IGN LiDAR HD tile). */
const IGN_ROOT_SPACING_M = 6.8;

describe('copcMaxLevel', () => {
    it('maps each slider stop to one level of the measured IGN pyramid', () => {
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 6.8)).toBe(0);
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 3.4)).toBe(1);
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 1.7)).toBe(2);
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 0.85)).toBe(3);
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 0.43)).toBe(4);
    });

    it('tolerates a tile spacing slightly off the stop it is matched to', () => {
        // Observed root spacing is 6.802721 m: a plain ceil would cost a level.
        expect(copcMaxLevel(6.802721, 6.8)).toBe(0);
    });

    it('keeps every level at the native density', () => {
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 0)).toBe(Infinity);
    });

    it('never returns data coarser than asked', () => {
        // 5 m sits between levels 0 (6.8 m) and 1 (3.4 m): the finer one wins.
        expect(copcMaxLevel(IGN_ROOT_SPACING_M, 5)).toBe(1);
    });
});

describe('autoResolutionM', () => {
    it('leaves a small zone at the native density', () => {
        expect(autoResolutionM(200, 200)).toBe(0);
    });

    it('coarsens as the zone grows', () => {
        const chosen = [800, 2000, 5000].map((s) => autoResolutionM(s, s));
        for (let i = 1; i < chosen.length; i++) expect(chosen[i]).toBeGreaterThan(chosen[i - 1]);
    });

    it('keeps every zone size within the download budget', () => {
        for (const side of [100, 500, 1000, 2500, 5000]) {
            const r = autoResolutionM(side, side);
            expect(estimateCapture(side, side, r).points).toBeLessThanOrEqual(6_000_000);
        }
    });

    it('only ever picks an offered stop', () => {
        expect(RESOLUTION_STOPS_M).toContain(autoResolutionM(3000, 1200));
    });
});

describe('densityAt', () => {
    it('caps at the native density however fine the request', () => {
        expect(densityAt(0.1)).toBe(densityAt(0));
    });
});
