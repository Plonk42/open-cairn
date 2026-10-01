import { describe, expect, it } from 'vitest';
import { clampHashPitch } from './mapHash';

describe('clampHashPitch', () => {
    it('clamps a pitch above the ceiling', () => {
        expect(clampHashPitch('#13.05/45.17732/5.76467/128.6/97', 90)).toBe('#13.05/45.17732/5.76467/128.6/90');
    });

    it.each([
        ['pitch within bounds', '#13.05/45.17732/5.76467/128.6/85'],
        ['no pitch component', '#13.05/45.17732/5.76467/128.6'],
        ['no bearing or pitch', '#13.05/45.17732/5.76467'],
        ['unrelated hash (e.g. a share link)', '#share=abc123'],
        ['viewpoint hash looking above the horizon', '#vp=6.912345/45.901234/2843.6/214.7/96.4/23.5/10'],
        ['empty hash', ''],
    ])('leaves a hash with %s untouched', (_label, hash) => {
        expect(clampHashPitch(hash, 90)).toBe(hash);
    });
});
