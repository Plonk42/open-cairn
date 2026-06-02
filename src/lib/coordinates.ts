/**
 * Parser for free-form GPS coordinate input typed into the search box.
 *
 * Supported formats (lat first by default; hemisphere letters override):
 *   45.8326, 6.8652            (decimal degrees)
 *   45.8326 6.8652             (whitespace)
 *   -45.83 -6.86               (signed decimal)
 *   45.8326°N, 6.8652°E        (decimal with hemisphere)
 *   N45.8326 E6.8652           (leading hemisphere)
 *   45°49'57.4"N 6°51'54.7"E   (DMS)
 *   45°49.957'N 6°51.912'E     (DDM, degrees + decimal minutes)
 *   45 49 57 N, 6 51 54 E      (space-separated DMS)
 *
 * Tolerates Unicode prime/double-prime (′ ″), curly quotes, and non-breaking
 * spaces, since copy-paste from Wikipedia / Google Maps often produces them.
 */

export interface ParsedCoordinate {
    lng: number;
    lat: number;
    /** Short display label, e.g. "45.83260°N, 6.86520°E". */
    label: string;
}

// Unicode prime (U+2032), double prime (U+2033), curly quotes, modifier letter
// apostrophes — all collapse to ASCII ' or " before parsing.
const PRIMES = /[\u2032\u2018\u2019\u02B9\u02BC]/g;       // → '
const DOUBLE_PRIMES = /[\u2033\u201C\u201D\u02BA]/g;       // → "
// NBSP, narrow NBSP, thin space, etc.
const UNICODE_WS = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalize(input: string): string {
    return input
        .replace(PRIMES, "'")
        .replace(DOUBLE_PRIMES, '"')
        .replace(UNICODE_WS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseCoordinates(input: string): ParsedCoordinate | null {
    const s = normalize(input);
    if (!s) return null;

    const parts = splitTwoCoords(s);
    if (!parts) return null;

    const a = parseSingle(parts[0]);
    const b = parseSingle(parts[1]);
    if (!a || !b) return null;

    // Explicit hemisphere wins; otherwise convention is lat,lng.
    const aIsLng = a.axis === 'lng' || b.axis === 'lat';
    const lat = aIsLng ? b.value : a.value;
    const lng = aIsLng ? a.value : b.value;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    return { lat, lng, label: formatLatLng(lat, lng) };
}

function splitTwoCoords(s: string): [string, string] | null {
    // Comma / semicolon: unambiguous.
    const sep = /[,;]/.exec(s);
    if (sep) {
        const i = sep.index;
        return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
    // Hemisphere as terminator: `45.83N 6.86E`, `45°49'N 6°51'E`
    const trail = /^(.*?[NSEWnsew])\s+(\S.*)$/.exec(s);
    if (trail) return [trail[1].trim(), trail[2].trim()];
    // Hemisphere at the start of each: `N45.83 E6.86`
    const lead = /^([NSEWnsew]\s*\S+)\s+([NSEWnsew]\s*\S+)$/.exec(s);
    if (lead) return [lead[1].trim(), lead[2].trim()];
    // Two whitespace-separated decimal numbers.
    const dec = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(s);
    if (dec) return [dec[1], dec[2]];
    return null;
}

interface ParsedSingle {
    value: number;
    axis?: 'lat' | 'lng';
}

function parseSingle(raw: string): ParsedSingle | null {
    let body = raw.trim();
    if (!body) return null;

    // Peel off an optional hemisphere letter from either end.
    let hem: string | null = null;
    const lead = /^([NSEWnsew])\s*(.+)$/.exec(body);
    if (lead) {
        hem = lead[1].toUpperCase();
        body = lead[2].trim();
    } else {
        const trail = /^(.+?)\s*([NSEWnsew])\s*$/.exec(body);
        if (trail) {
            hem = trail[2].toUpperCase();
            body = trail[1].trim();
        }
    }

    // Replace unit markers (°, ', ", d/m/s) with whitespace, then tokenize.
    // Works uniformly for decimal degrees, DDM, and DMS.
    const tokens = body
        .replace(/[°'"dDmMsS]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (tokens.length === 0 || tokens.length > 3) return null;
    const nums = tokens.map((t) => Number.parseFloat(t));
    if (nums.some((n) => !Number.isFinite(n))) return null;

    const [d, m = 0, sec = 0] = nums;
    if (m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
    const sign = tokens[0].startsWith('-') ? -1 : 1;
    const value = (Math.abs(d) + m / 60 + sec / 3600) * sign;
    return finalize(value, hem);
}

function finalize(value: number, hem: string | null): ParsedSingle | null {
    if (!Number.isFinite(value)) return null;
    let v = value;
    if (hem === 'S' || hem === 'W') v = -Math.abs(v);
    else if (hem === 'N' || hem === 'E') v = Math.abs(v);
    let axis: 'lat' | 'lng' | undefined;
    if (hem === 'N' || hem === 'S') axis = 'lat';
    else if (hem === 'E' || hem === 'W') axis = 'lng';
    return { value: v, axis };
}

function formatLatLng(lat: number, lng: number): string {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(5)}°${ns}, ${Math.abs(lng).toFixed(5)}°${ew}`;
}
