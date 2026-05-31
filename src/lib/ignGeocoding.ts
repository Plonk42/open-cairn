/**
 * IGN Géoplateforme geocoding (autocomplete + search).
 *
 * Public, key-less endpoint:
 *   https://data.geopf.fr/geocodage/completion?text=...&type=PositionOfInterest,StreetAddress
 *
 * Docs: https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
 */

const IGN_COMPLETION_URL = 'https://data.geopf.fr/geocodage/completion';
const IGN_SEARCH_URL = 'https://data.geopf.fr/geocodage/search';

export type IgnSuggestionKind = 'PositionOfInterest' | 'StreetAddress' | 'Address' | string;

export interface IgnSuggestion {
    /** Display label. */
    fulltext: string;
    /** Longitude (WGS84). */
    lng: number;
    /** Latitude (WGS84). */
    lat: number;
    /** City / commune name when available. */
    city?: string;
    /** Result kind ("commune", "village", "lieu-dit", "préfecture"…). */
    kind?: string;
    /** "PositionOfInterest" or "StreetAddress". */
    type?: IgnSuggestionKind;
    /** Optional zip code when provided by the API. */
    zipcode?: string;
    /** Optional bbox [w,s,e,n] (only when fetched via search). */
    bbox?: [number, number, number, number];
}

interface CompletionRaw {
    status: string;
    results: Array<{
        country?: string;
        x: number;
        y: number;
        city?: string;
        kind?: string;
        zipcode?: string;
        fulltext: string;
        classification?: number;
        poiType?: string[];
        street?: string;
    }>;
}

export async function ignAutocomplete(
    text: string,
    signal?: AbortSignal,
    options?: { maxResults?: number; types?: IgnSuggestionKind[] },
): Promise<IgnSuggestion[]> {
    const trimmed = text.trim();
    if (trimmed.length < 2) return [];
    const params = new URLSearchParams({
        text: trimmed,
        maximumResponses: String(options?.maxResults ?? 8),
        type: (options?.types ?? ['PositionOfInterest', 'StreetAddress']).join(','),
    });
    const response = await fetch(`${IGN_COMPLETION_URL}?${params.toString()}`, { signal });
    if (!response.ok) throw new Error(`IGN completion ${response.status}`);
    const raw = (await response.json()) as CompletionRaw;
    if (!raw?.results) return [];
    return raw.results.map((r) => ({
        fulltext: r.fulltext,
        lng: r.x,
        lat: r.y,
        city: r.city,
        kind: r.kind,
        zipcode: r.zipcode,
    }));
}

interface SearchRaw {
    features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
            label?: string;
            city?: string;
            postcode?: string;
            type?: string;
            extent?: [number, number, number, number]; // [w,s,e,n]
        };
    }>;
}

/** Geocode a free-form query (used when the user submits without picking a suggestion). */
export async function ignSearch(text: string, signal?: AbortSignal): Promise<IgnSuggestion | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const params = new URLSearchParams({
        q: trimmed,
        limit: '1',
        index: 'address,poi',
    });
    const response = await fetch(`${IGN_SEARCH_URL}?${params.toString()}`, { signal });
    if (!response.ok) throw new Error(`IGN search ${response.status}`);
    const raw = (await response.json()) as SearchRaw;
    const feature = raw.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!feature || !coords) return null;
    const ext = feature.properties?.extent;
    return {
        fulltext: feature.properties?.label ?? trimmed,
        lng: coords[0],
        lat: coords[1],
        city: feature.properties?.city,
        kind: feature.properties?.type,
        zipcode: feature.properties?.postcode,
        bbox: ext && ext.length === 4 ? ext : undefined,
    };
}

const IGN_REVERSE_URL = 'https://data.geopf.fr/geocodage/reverse';

interface ReverseRaw {
    features?: Array<{
        properties?: {
            label?: string;
            city?: string | string[];
            name?: string | string[];
            toponym?: string;
            postcode?: string | string[];
        };
    }>;
}

function firstString(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

// IGN returns these generic family labels for unnamed features (e.g. an
// unnamed fountain comes back as toponym="Détail hydrographique"). Skip them.
function isGenericToponym(value: string | undefined): boolean {
    return !!value && /^Détail\s/i.test(value);
}

function pickFeatureLabel(props: NonNullable<NonNullable<ReverseRaw['features']>[number]['properties']>): string | null {
    // When IGN's `toponym` is a generic family placeholder (e.g. "Détail hydrographique"),
    // the feature has no proper name and `name` is just the object kind ("Fontaine",
    // "Borne", "Croix"…), so skip the whole feature rather than falling back to it.
    if (isGenericToponym(props.toponym)) return null;
    return props.toponym || firstString(props.name) || firstString(props.city) || props.label || null;
}

// Narrow IGN POI subcategories — only named places we want as route names:
// sommets, cols, lacs, lieux-dits habités. Avoids fontaines, croix, parkings,
// quartiers, cours d'eau anonymes, etc.
const SCAN25_POI_CATEGORIES = [
    'sommet',
    'col',
    'lac',
    'lieu-dit habité',
].join(',');

// IGN reverse caps searchgeom Circle radius at 500 m. Used to widen the
// default lookup so we don't miss a named summit/lake a few hundred meters away.
const SCAN25_SEARCH_RADIUS_M = 500;

async function ignReverseTop(
    lng: number,
    lat: number,
    extraParams: Record<string, string>,
    signal?: AbortSignal,
): Promise<string | null> {
    const params = new URLSearchParams({
        lon: String(lng),
        lat: String(lat),
        limit: '5',
        ...extraParams,
    });
    const response = await fetch(`${IGN_REVERSE_URL}?${params.toString()}`, { signal });
    if (!response.ok) return null;
    const raw = (await response.json()) as ReverseRaw;
    for (const feature of raw.features ?? []) {
        const label = feature.properties ? pickFeatureLabel(feature.properties) : null;
        if (label) return label;
    }
    return null;
}

/**
 * Reverse geocode a coordinate to a short SCAN 25-style toponym.
 * Looks for nearby named features (col, sommet, lac, hameau, lieu-dit…) within
 * 500 m and falls back to the commune. Returns null when nothing relevant is close.
 */
export async function ignReverse(lng: number, lat: number, signal?: AbortSignal): Promise<string | null> {
    try {
        const searchgeom = JSON.stringify({
            type: 'Circle',
            coordinates: [lng, lat],
            radius: SCAN25_SEARCH_RADIUS_M,
        });
        const topo = await ignReverseTop(
            lng,
            lat,
            { index: 'poi', category: SCAN25_POI_CATEGORIES, searchgeom },
            signal,
        );
        if (topo) return topo;
        return await ignReverseTop(lng, lat, { index: 'poi', category: 'administratif' }, signal);
    } catch {
        return null;
    }
}
