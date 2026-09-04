/**
 * Réglages de génération embarqués avec un nuage enregistré, pour pouvoir
 * comparer plusieurs captures de la même zone sans avoir à deviner lequel
 * portait quel réglage.
 *
 * Volontairement un JSON libre (`Record<string, …>`) plutôt qu'une interface
 * figée : une entrée écrite par une version antérieure garde ses clés telles
 * quelles, une clé ajoutée plus tard n'apparaît que sur les nouvelles entrées,
 * et aucune des deux ne casse l'autre. En contrepartie, l'affichage doit
 * tolérer une clé inconnue — d'où le repli sur la clé brute ci-dessous.
 */

export type CaptureParamValue = string | number | boolean | number[];
export type CaptureParams = Readonly<Record<string, CaptureParamValue>>;

function strideLabel(v: CaptureParamValue): string {
    return typeof v === 'number' && v > 1 ? `1/${v}` : 'max';
}

function percentLabel(v: CaptureParamValue): string {
    if (typeof v !== 'number') return String(v);
    return v <= 0 ? 'off' : `${Math.round(v * 100)} %`;
}

function metersLabel(digits: number): (v: CaptureParamValue) => string {
    return (v) => (typeof v === 'number' ? `${v.toFixed(digits)} m` : String(v));
}

interface CaptureParamSpec {
    label: string;
    format?: (v: CaptureParamValue) => string;
}

/**
 * Libellés et mise en forme des clés connues. L'ordre d'insertion est l'ordre
 * d'affichage ; les clés absentes d'ici restent affichables (clé brute + valeur
 * générique), ce qui est tout l'intérêt du format libre.
 */
const CAPTURE_PARAM_SPECS: Readonly<Record<string, CaptureParamSpec>> = {
    stride: { label: 'Densité', format: strideLabel },
    gridMesh: { label: 'Surface', format: (v) => (v ? 'lissé' : 'brut') },
    gridCell: { label: 'Résolution', format: metersLabel(1) },
    poissonGroundStride: { label: 'Densité sol', format: strideLabel },
    poissonDepth: { label: 'Profondeur octree', format: (v) => `depth ${String(v)}` },
    poissonSamplesPerNode: { label: 'Échantillons/nœud' },
    poissonPointWeight: { label: 'Poids des points' },
    poissonNormalRobust: { label: 'Arêtes', format: percentLabel },
    poissonSharpen: { label: 'Netteté', format: percentLabel },
    poissonFlatBase: { label: 'Socle plat' },
};

function defaultFormat(v: CaptureParamValue): string {
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

export function formatCaptureParam(key: string, value: CaptureParamValue): string {
    return CAPTURE_PARAM_SPECS[key]?.format?.(value) ?? defaultFormat(value);
}

export function captureParamLabel(key: string): string {
    return CAPTURE_PARAM_SPECS[key]?.label ?? key;
}

export interface CaptureParamEntry {
    key: string;
    label: string;
    text: string;
}

/** Les réglages mis en forme, clés connues d'abord (dans l'ordre du barème). */
export function captureParamEntries(params: CaptureParams | undefined, keys?: readonly string[]): CaptureParamEntry[] {
    if (!params) return [];
    const known = Object.keys(CAPTURE_PARAM_SPECS).filter((k) => k in params);
    const unknown = Object.keys(params).filter((k) => !(k in CAPTURE_PARAM_SPECS)).sort((a, b) => a.localeCompare(b));
    const wanted = keys ? new Set(keys) : null;
    return [...known, ...unknown]
        .filter((key) => !wanted || wanted.has(key))
        .map((key) => ({ key, label: captureParamLabel(key), text: formatCaptureParam(key, params[key]) }));
}

/**
 * Empreinte stable d'un jeu de réglages, indépendante de l'ordre des clés.
 * Sert de suffixe à la clé de dédoublonnage des nuages enregistrés : deux
 * captures de la même zone avec des réglages différents doivent cohabiter,
 * sinon la seconde écrase la première et il n'y a plus rien à comparer.
 */
export function captureParamsSignature(params: CaptureParams | undefined): string {
    if (!params) return '';
    return Object.keys(params)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => {
            const v = params[k];
            return `${k}=${Array.isArray(v) ? [...v].sort((x, y) => x - y).join(',') : String(v)}`;
        })
        .join(';');
}

/**
 * Clés dont la valeur n'est pas la même partout — celles qui distinguent les
 * entrées les unes des autres. Une clé absente d'une entrée compte comme une
 * valeur à part entière, sinon un réglage apparu après coup passerait inaperçu.
 */
export function differingCaptureParamKeys(list: readonly (CaptureParams | undefined)[]): string[] {
    const values = new Map<string, Set<string>>();
    for (const params of list) {
        for (const key of Object.keys(params ?? {})) {
            if (!values.has(key)) values.set(key, new Set());
        }
    }
    for (const params of list) {
        for (const [key, seen] of values) {
            const v = params?.[key];
            seen.add(v === undefined ? '\u0000' : formatCaptureParam(key, v));
        }
    }
    return [...values].filter(([, seen]) => seen.size > 1).map(([key]) => key);
}
