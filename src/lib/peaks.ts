// ─────────────────────────────────────────────────────────────────────────────
// Named summits around a standpoint, from the IGN BD TOPO® and BD CARTO®.
//
// `detail_orographique` exists in BOTH products, under the SAME `cleabs`
// identifier. That pairing is what this module is built on, because each side
// holds exactly one of the two things a panorama needs:
//
//   - BD TOPO® is the dense one, and the only one carrying `importance`, IGN's
//     notoriety rank (1 = most notorious … 6). It is the only sane way to thin
//     a panorama: around Chamonix a ±80 km box holds 1655 summits at rank ≤ 4;
//   - BD CARTO® is the generalised one, and the only one carrying `cote`, the
//     spot height printed on the map — the surveyed altitude of the summit.
//
// Why the height cannot come from a DEM: the toponym's point is placed to hang
// a label on, not on the top. Sampled against RGE ALTI® 1 m it reads
// Chamechaude −9 m, Grand Som −12 m, Mont Saint-Eynard −9 m, le Néron −183 m,
// and taking the local maximum over 400 m around it recovers none of them. An
// altitude is a hiking decision, so it is BD CARTO®'s `cote` or nothing:
// `spotHeightM` is null on the two thirds of summits IGN gives no spot height
// for, and those are labelled with their name alone.
//
// The nature filter falls out of the same join. `Sommet` and `Pic` ARE tops by
// definition. `Montagne`, `Rochers`, `Crête` and `Escarpement` sometimes name a
// culminating point (la Meije, la Grande Sure, les Lances de Malissard) and
// sometimes an area ("Massif de la Chartreuse", "les Grandes Rousses"); a spot
// height is precisely the evidence that separates the two, so those four are
// kept only when BD CARTO® gives them one. Over the northern Alps that adds
// ~110 real tops and no area label.
//
// Coverage is French, and only just past the border: the Miravidi and the Becca
// du Lac are in, the Gran Paradiso is not. A panorama facing Italy or the Valais
// will be labelled on its French half only.
//
// Same host and the same keyless WFS as the LiDAR tile index (`lidarBrowser/
// wfs.ts`), CORS confirmed from any origin.
// ─────────────────────────────────────────────────────────────────────────────

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TOPO_TYPENAME = 'BDTOPO_V3:detail_orographique';
const CARTO_TYPENAME = 'BDCARTO_V5:detail_orographique';

/** Beyond this the haze wins and a name cannot be checked against anything. */
export const PEAKS_RADIUS_M = 60_000;

/**
 * Coarsest rank fetched. 5 and 6 name knolls and shoulders — at any distance
 * where they are legible you are standing on them.
 */
const MAX_IMPORTANCE = 4;

/** A 60 km box holds ~800 features at rank ≤ 4 in the Alps; this is the net. */
const MAX_FEATURES = 4000;

const METRES_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

/** Natures that name a top whether or not IGN has surveyed its height. */
const SUMMIT_NATURES = new Set(['Sommet', 'Pic']);

/** Natures kept only when a spot height proves they name a point, not an area. */
const CULMINATION_NATURES = ['Montagne', 'Rochers', 'Crête', 'Escarpement'];

export interface Peak {
    /** IGN's own stable identifier (`cleabs`), shared by both products. */
    id: string;
    name: string;
    lng: number;
    lat: number;
    /** IGN notoriety rank, 1 (highest) … 6. */
    importance: number;
    /** BD CARTO® spot height in metres, or null when IGN publishes none. */
    spotHeightM: number | null;
}

function boundingBox(lng: number, lat: number, radiusM: number): string {
    const dLat = radiusM / METRES_PER_DEG_LAT;
    const dLng = dLat / Math.max(0.05, Math.cos(lat * DEG));
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(5)).join(',');
}

/**
 * One `GetFeature` call, returning the raw feature array.
 *
 * The bbox travels inside `cql_filter`, never in the `bbox` parameter: the IGN
 * WFS rejects the two together ("bbox and cql_filter both specified but are
 * mutually exclusive"), and every caller here needs a filter anyway.
 */
async function getFeatures(
    typename: string,
    propertyname: string,
    cqlFilter: string,
    signal?: AbortSignal,
): Promise<unknown[]> {
    const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typenames: typename,
        srsname: 'EPSG:4326',
        outputFormat: 'application/json',
        count: String(MAX_FEATURES),
        propertyname,
        cql_filter: cqlFilter,
    });
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal,
    });
    if (!res.ok) throw new Error(`WFS GetFeature failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as { features?: unknown[] };
    return Array.isArray(data.features) ? data.features : [];
}

/**
 * The surveyed heights of the box, keyed by `cleabs`.
 *
 * Asking for `cleabs,cote` alone makes the WFS answer with a null geometry,
 * which is the whole point: this is a lookup table, ~17 kB for a 60 km box.
 */
async function fetchSpotHeights(bbox: string, signal?: AbortSignal): Promise<Map<string, number>> {
    const features = await getFeatures(
        CARTO_TYPENAME,
        'cleabs,cote',
        `cote IS NOT NULL AND BBOX(geometrie,${bbox},'EPSG:4326')`,
        signal,
    );
    const heights = new Map<string, number>();
    for (const raw of features) {
        const props = (raw as { properties?: { cleabs?: unknown; cote?: unknown } }).properties;
        if (typeof props?.cleabs !== 'string') continue;
        const cote = Number(props.cote);
        if (Number.isFinite(cote)) heights.set(props.cleabs, cote);
    }
    return heights;
}

function parseFeature(raw: unknown, spotHeights: ReadonlyMap<string, number>): Peak | null {
    const f = raw as {
        properties?: { cleabs?: unknown; toponyme?: unknown; nature?: unknown; importance?: unknown };
        geometry?: { coordinates?: unknown };
    };
    const cleabs = f.properties?.cleabs;
    const name = f.properties?.toponyme;
    const nature = f.properties?.nature;
    if (typeof cleabs !== 'string' || typeof name !== 'string' || !name) return null;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [lng, lat] = coords as number[];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const spotHeightM = spotHeights.get(cleabs) ?? null;
    // Without a spot height, a `Montagne` or a `Crête` is an area name whose
    // point sits in the middle of nothing one can aim at.
    if (spotHeightM === null && !(typeof nature === 'string' && SUMMIT_NATURES.has(nature))) {
        return null;
    }
    const importance = Number(f.properties?.importance);
    return {
        id: cleabs,
        name,
        lng,
        lat,
        importance: Number.isFinite(importance) ? importance : MAX_IMPORTANCE,
        spotHeightM,
    };
}

/** Every named summit within `radiusM` of a spot, surveyed heights joined in. */
export async function fetchPeaks(
    lng: number,
    lat: number,
    radiusM: number,
    signal?: AbortSignal,
): Promise<Peak[]> {
    const bbox = boundingBox(lng, lat, radiusM);
    const natures = [...SUMMIT_NATURES, ...CULMINATION_NATURES].map((n) => `'${n}'`).join(',');
    const [features, spotHeights] = await Promise.all([
        getFeatures(
            TOPO_TYPENAME,
            'cleabs,toponyme,nature,importance,geometrie',
            `nature IN (${natures}) AND importance <= '${MAX_IMPORTANCE}' `
            + `AND BBOX(geometrie,${bbox},'EPSG:4326')`,
            signal,
        ),
        fetchSpotHeights(bbox, signal),
    ]);
    const peaks: Peak[] = [];
    for (const raw of features) {
        const peak = parseFeature(raw, spotHeights);
        if (peak) peaks.push(peak);
    }
    return peaks;
}
