import { describe, expect, it } from 'vitest';

import { captureParamEntries, captureParamsSignature, differingCaptureParamKeys } from './captureParams';

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

describe('differingCaptureParamKeys', () => {
    it('ne retient que les clés qui varient', () => {
        const keys = differingCaptureParamKeys([
            { poissonDepth: 9, poissonSharpen: 0.5, shader: 'base' },
            { poissonDepth: 10, poissonSharpen: 0.5, shader: 'base' },
        ]);
        expect(keys).toEqual(['poissonDepth']);
    });

    it("traite une clé absente comme une valeur à part", () => {
        const keys = differingCaptureParamKeys([{ poissonDepth: 9 }, {}]);
        expect(keys).toEqual(['poissonDepth']);
    });

    it('ne retient rien quand tout est identique', () => {
        expect(differingCaptureParamKeys([{ poissonDepth: 9 }, { poissonDepth: 9 }])).toEqual([]);
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

    it('peut se restreindre à un sous-ensemble de clés', () => {
        const entries = captureParamEntries({ stride: 4, poissonDepth: 9 }, ['poissonDepth']);
        expect(entries).toHaveLength(1);
        expect(entries[0].key).toBe('poissonDepth');
    });
});
