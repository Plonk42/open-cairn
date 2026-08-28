import { parseCoordinates } from '@/lib/coordinates';
import { describe, expect, it } from 'vitest';

describe('parseCoordinates', () => {
    it('returns null for empty or junk input', () => {
        expect(parseCoordinates('')).toBeNull();
        expect(parseCoordinates('   ')).toBeNull();
        expect(parseCoordinates('hello world')).toBeNull();
    });

    it('parses comma-separated decimal degrees as lat,lng', () => {
        const r = parseCoordinates('45.8326, 6.8652');
        expect(r).not.toBeNull();
        expect(r!.lat).toBeCloseTo(45.8326, 4);
        expect(r!.lng).toBeCloseTo(6.8652, 4);
    });

    it('parses whitespace-separated decimals', () => {
        const r = parseCoordinates('45.8326 6.8652');
        expect(r!.lat).toBeCloseTo(45.8326, 4);
        expect(r!.lng).toBeCloseTo(6.8652, 4);
    });

    it('parses signed decimals', () => {
        const r = parseCoordinates('-45.83 -6.86');
        expect(r!.lat).toBeCloseTo(-45.83, 2);
        expect(r!.lng).toBeCloseTo(-6.86, 2);
    });

    it('honors hemisphere letters even when order is lng,lat', () => {
        const r = parseCoordinates('6.8652°E, 45.8326°N');
        expect(r!.lat).toBeCloseTo(45.8326, 4);
        expect(r!.lng).toBeCloseTo(6.8652, 4);
    });

    it('parses leading-hemisphere form', () => {
        const r = parseCoordinates('N45.8326 E6.8652');
        expect(r!.lat).toBeCloseTo(45.8326, 4);
        expect(r!.lng).toBeCloseTo(6.8652, 4);
    });

    it('applies southern/western hemispheres as negative', () => {
        const r = parseCoordinates('45.83S 6.86W');
        expect(r!.lat).toBeCloseTo(-45.83, 2);
        expect(r!.lng).toBeCloseTo(-6.86, 2);
    });

    it('parses DMS notation with unicode primes', () => {
        const r = parseCoordinates('45°49′57.4″N 6°51′54.7″E');
        expect(r!.lat).toBeCloseTo(45 + 49 / 60 + 57.4 / 3600, 4);
        expect(r!.lng).toBeCloseTo(6 + 51 / 60 + 54.7 / 3600, 4);
    });

    it('parses degrees + decimal minutes (DDM)', () => {
        const r = parseCoordinates("45°49.957'N 6°51.912'E");
        expect(r!.lat).toBeCloseTo(45 + 49.957 / 60, 4);
        expect(r!.lng).toBeCloseTo(6 + 51.912 / 60, 4);
    });

    it('parses leading-hemisphere DDM without a comma separator', () => {
        const r = parseCoordinates('N 45° 14.194 E 005° 41.209');
        expect(r!.lat).toBeCloseTo(45 + 14.194 / 60, 4);
        expect(r!.lng).toBeCloseTo(5 + 41.209 / 60, 4);
    });

    it('rejects out-of-range latitude', () => {
        expect(parseCoordinates('120, 6')).toBeNull();
    });

    it('rejects out-of-range longitude', () => {
        expect(parseCoordinates('45, 200')).toBeNull();
    });

    it('rejects minutes or seconds at or above 60', () => {
        expect(parseCoordinates('45°60\'00"N 6°00\'00"E')).toBeNull();
    });

    it('produces a human-readable label', () => {
        const r = parseCoordinates('45.8326, 6.8652');
        expect(r!.label).toBe('45.83260°N, 6.86520°E');
    });
});
