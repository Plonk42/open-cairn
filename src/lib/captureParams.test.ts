import { describe, expect, it } from 'vitest';

import { captureParamEntries, captureParamsSignature } from './captureParams';

describe('captureParamsSignature', () => {
    it("ne dépend pas de l'ordre des clés", () => {
        const a = captureParamsSignature({ poissonDepth: 9, poissonSharpen: 0.5 });
        const b = captureParamsSignature({ poissonSharpen: 0.5, poissonDepth: 9 });
        expect(a).toBe(b);
    });

    it("ne dépend pas de l'ordre d'un tableau", () => {
        expect(captureParamsSignature({ classes: [2, 5, 6] })).toBe(captureParamsSignature({ classes: [6, 2, 5] }));
    });

    it('sépare deux réglages différents', () => {
        expect(captureParamsSignature({ poissonDepth: 9 })).not.toBe(captureParamsSignature({ poissonDepth: 10 }));
    });

    it('rend une chaîne vide sans réglages', () => {
        expect(captureParamsSignature(undefined)).toBe('');
    });
});

describe('captureParamEntries', () => {
    it('met en forme les valeurs connues en français', () => {
        const entries = captureParamEntries({
            stride: 4,
            poissonSharpen: 0.5,
            poissonFlatBase: true,
            gridCell: 1.5,
        });
        expect(entries.map((e) => `${e.label} ${e.text}`)).toEqual([
            'Densité 1/4',
            'Résolution 1.5 m',
            'Netteté 50 %',
            'Socle plat oui',
        ]);
    });

    it('retombe sur la clé brute pour un réglage inconnu', () => {
        expect(captureParamEntries({ futurReglage: 3 })).toEqual([
            { key: 'futurReglage', label: 'futurReglage', text: '3' },
        ]);
    });
});
