/**
 * Generation settings embedded with a saved cloud, so several captures of the
 * same area can be compared without having to guess which one carried which
 * setting.
 *
 * Deliberately a free-form JSON (`Record<string, …>`) rather than a frozen
 * interface: an entry written by an earlier version keeps its keys as they are,
 * a key added later only shows up on new entries, and neither breaks the other.
 * In exchange, the display must tolerate an unknown key — hence the fallback to
 * the raw key below.
 */

export type CaptureParamValue = string | number | boolean | number[];
export type CaptureParams = Readonly<Record<string, CaptureParamValue>>;

/** Generation mode; `LidarMode` and `LidarCloudMode` are aliases of it. */
export type CaptureMode = 'shaded' | 'delaunay' | 'poisson';

/**
 * Everything needed to replay a capture. The settings alone are not enough:
 * without the extent one knows how to generate, not where — hence the extent
 * and the settings in the same object, the one a cloud saved as a scene embeds
 * and that « Recapturer » applies.
 */
export interface CaptureRecord {
    mode: CaptureMode;
    centerLng: number;
    centerLat: number;
    /** Dimensions of the capture rectangle (m). */
    widthM: number;
    lengthM: number;
    params?: CaptureParams;
}

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
 * Labels and formatting of the known keys. Insertion order is display order;
 * keys missing from here remain displayable (raw key + generic value), which is
 * the whole point of the free-form format.
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

/** The formatted settings, known keys first (in the order of the spec table). */
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
 * Stable fingerprint of a set of settings, independent of key order. Used as a
 * suffix of the dedup key of saved clouds: two captures of the same area with
 * different settings must coexist, otherwise the second overwrites the first
 * and there is nothing left to compare.
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
 * Keys whose value is not the same everywhere — the ones that tell the entries
 * apart. A key missing from an entry counts as a value in its own right,
 * otherwise a setting introduced afterwards would go unnoticed.
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
