// ─────────────────────────────────────────────────────────────────────────────
// Named summits around a standpoint, read from a file built offline.
//
// This was two live WFS queries per kilometre of eye movement — BD TOPO® for
// the summits and their `importance` rank, BD CARTO® for the `cote`, joined on
// the `cleabs` both products share. The join is expensive and its answer never
// changes, so `tools/build-peaks.mjs` now does it once and writes the result
// into `peaksData.json`. That bought three things a live query could not:
//
//   - heights from SEVERAL sources. BD CARTO® publishes a cote for barely a
//     fifth of the summits we keep; OSM and GeoNames cover a different fifth,
//     and merging them is only affordable offline;
//   - every height checked against RGE ALTI® at 1 m rather than against the
//     terrainrgb the app samples at ~10 m. The check that used to run on every
//     sighting — and could only ever delete a height — now runs once, on better
//     data, and lets the next source have its turn instead;
//   - no network on the path to a label, and no dependency on the Géoplateforme
//     answering when the eye lands.
//
// The price is freshness: the file is frozen until someone reruns the tool. For
// surveyed summits, whose heights do not move from one decade to the next, that
// is a price of zero.
//
// Coverage is French, and only just past the border: the Miravidi and the Becca
// du Lac are in, the Gran Paradiso is not. A panorama facing Italy or the Valais
// will be labelled on its French half only.
// ─────────────────────────────────────────────────────────────────────────────

import peaksUrl from '@/lib/peaksData.json?url';

/** Beyond this the haze wins and a name cannot be checked against anything. */
export const PEAKS_RADIUS_M = 60_000;

const METRES_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

export interface Peak {
    /** Row number in the data file: stable within a build, and only a list key. */
    id: string;
    name: string;
    lng: number;
    lat: number;
    /** IGN notoriety rank, 1 (highest) … 4. */
    importance: number;
    /** Published spot height in metres, or null when no source carries one. */
    spotHeightM: number | null;
}

/** One row of the data file. Positional: naming the fields costs 130 kB gzipped. */
type PeakRow = [
    name: string,
    lng: number,
    lat: number,
    importance: number,
    spotHeightM: number | null,
];


/**
 * In flight or resolved, shared by every caller.
 *
 * Deliberately takes no `AbortSignal`: one caller giving up would reject the
 * promise every later caller is waiting on. The file is a static asset a few
 * hundred kilobytes wide, and the overlay already discards a result whose eye
 * has moved on, so there is nothing worth cancelling.
 */
let pending: Promise<Peak[]> | null = null;

/** Every named French summit, downloaded once and kept for the session. */
export function loadPeaks(): Promise<Peak[]> {
    pending ??= fetch(peaksUrl)
        .then((res) => {
            if (!res.ok) throw new Error(`peaksData.json → ${res.status} ${res.statusText}`);
            return res.json() as Promise<PeakRow[]>;
        })
        .then((rows) => rows.map(([name, lng, lat, importance, spotHeightM], i): Peak => ({
            id: String(i), name, lng, lat, importance, spotHeightM,
        })))
        .catch((err: unknown) => {
            // Let a later idle try again rather than cache the failure for good.
            pending = null;
            throw err;
        });
    return pending;
}

/**
 * The summits inside a square box of `radiusM` around a spot.
 *
 * A box, not a disc: `selectCandidates` measures the real distance anyway, and
 * this only exists to keep the ray budget from being sorted over the whole
 * country on every idle.
 */
export function peaksWithin(
    peaks: readonly Peak[],
    lng: number,
    lat: number,
    radiusM: number,
): Peak[] {
    const dLat = radiusM / METRES_PER_DEG_LAT;
    const dLng = dLat / Math.max(0.05, Math.cos(lat * DEG));
    return peaks.filter((p) => Math.abs(p.lat - lat) <= dLat && Math.abs(p.lng - lng) <= dLng);
}

