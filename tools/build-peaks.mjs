#!/usr/bin/env node
/**
 * Builds `src/lib/peaksData.json`, the frozen list of named French summits the
 * panorama labels — replacing the two live WFS calls the app used to make on
 * every kilometre of eye movement.
 *
 * Why freeze it at all: the join it performs is expensive and its result never
 * changes. BD TOPO® is the only product carrying `importance`, IGN's notoriety
 * rank, and BD CARTO® is the only one carrying `cote`, the surveyed spot height
 * — under the SAME `cleabs`. Doing that join once here costs nothing at runtime
 * and, more importantly, lets three things happen that a live query cannot:
 *
 *   1. heights can come from SEVERAL sources. BD CARTO® publishes a cote for
 *      only ~20% of the summits we keep (6339 for the whole country); OSM and
 *      GeoNames cover a different fifth. Merging them is only affordable
 *      offline;
 *   2. every height is checked against RGE ALTI® at 1 m — ten times finer than
 *      the terrainrgb the app samples at runtime. The check that used to run on
 *      every sighting now runs once, on better data;
 *   3. a height the DEM contradicts is no longer simply dropped: the next
 *      source in the priority order gets its turn.
 *
 * Sources, in the order a height is trusted — see `HEIGHT_SOURCES`.
 *
 * Downloads are cached under `tools/build-peaks-cache/` so iterating on the
 * merge costs no network. Delete that directory to refetch.
 *
 * Usage: node tools/build-peaks.mjs [--refetch]
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const CACHE_DIR = fileURLToPath(new URL('./build-peaks-cache/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/lib/peaksData.json', import.meta.url));

const WFS_URL = 'https://data.geopf.fr/wfs/ows';
const TOPO_TYPENAME = 'BDTOPO_V3:detail_orographique';
const CARTO_TYPENAME = 'BDCARTO_V5:detail_orographique';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const GEONAMES_URL = 'https://download.geonames.org/export/dump/FR.zip';
const ALTI_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';

/** Overpass rejects a request with no User-Agent (HTTP 406). */
const USER_AGENT = 'open-cairn build-peaks (https://github.com/open-cairn)';

/** Coarsest notoriety rank kept: 5 and 6 name knolls you are standing on. */
const MAX_IMPORTANCE = 4;

/** Natures that name a top whether or not anyone has surveyed its height. */
const SUMMIT_NATURES = ['Sommet', 'Pic'];

/** Natures kept only when a height proves they name a point, not an area. */
const CULMINATION_NATURES = ['Montagne', 'Rochers', 'Crête', 'Escarpement'];

/** WFS page size. 33k features come down in nine pages of about a megabyte. */
const WFS_PAGE = 4000;

/**
 * The elevation service answers GET only, and 414s past ~250 points. It also
 * has a trap: past 31 points it stops reading the DEM point by point and
 * rasterises the request's bounding box instead, at a resolution that follows
 * the box, silently. Asking for 200 summits scattered over France returned the
 * Néron's 1297 m as 1131 m; the same point alone, or in a batch of 30 however
 * spread out, reads 1297.17 m. Batches of 30 cost 1100 requests instead of 110
 * and are exact. Sorting the points to keep each box small was measured worse:
 * summits are too sparse, and a 0.1° box holds four of them.
 */
const ALTI_BATCH = 30;

/**
 * Requests in flight. Batches of 30 mean 1100 of them for the ground alone, and
 * at 2.7 s each that is 49 minutes of waiting on latency rather than on data.
 * Six at a time is what makes the small batch affordable; the service is public,
 * so this stays modest.
 */
const ALTI_CONCURRENCY = 6;

/**
 * How far the ground may stand above a published height before that height is
 * taken to describe some other point.
 *
 * A cote is an exact measurement; what goes wrong is what it is attached to.
 * BD CARTO® hangs the 2596 m of the *Petite* Lance de Domène on the identifier
 * of the Grande Lance, whose own ground RGE ALTI® reads 168 m higher. The
 * margin is wide because a DEM can genuinely read high: névé standing on the
 * rock when the survey was flown, or a mast the bare-earth filter left on a
 * narrow top. Held against the reference dataset, heights more than 15 m under
 * their own ground are right 73% of the time against 96% for the bulk.
 */
const MAX_SURVEY_UNDERSHOOT_M = 15;

/**
 * And how far a height may stand above that ground.
 *
 * This bound is loose because standing well above the sampled ground is NORMAL:
 * the toponym is placed to hang a label on, often low on the slope, so a
 * prominent summit legitimately reads 150 to 400 m over it — and those are the
 * *most* reliable heights in the set (98% and 100% right). Only past 400 m does
 * accuracy collapse to 73%, which is where BD CARTO® hangs the 1864 m of some
 * other top on Tête Compasses, whose ground is 1248 m and whose real height OSM
 * puts at 1263 m.
 */
const MAX_SURVEY_OVERSHOOT_M = 400;

/**
 * How far a same-named point from an outside source may sit from the IGN
 * toponym and still be the same summit.
 *
 * A distance band taken on its own looks damning — past 600 m barely 45% of
 * matches agree with the reference. But that measurement predates the height
 * guard below, which is what actually rejects the wrong ones. Sweeping the
 * radius with the guard in place, accuracy and coverage both improve out to
 * 600 m (97.6% → 98.0% within 3 m, 50% → 52% of summits carrying a height)
 * and then flatten, so the wider radius costs nothing. BD TOPO® anchors a
 * ridge name well away from its top — "le Néron", "mont Saint-Eynard" and
 * "mont Rachais" all sit 600 m to 1.7 km from the summit they name.
 */
const MAX_NAME_MATCH_M = 600;

/**
 * How far a same-named point may sit and still be admitted once RGE ALTI® under
 * the point itself has confirmed it, and by how much the two may disagree.
 *
 * Distance alone cannot separate a misplaced toponym from a homonym on another
 * massif: over the 600 m to 1500 m band the two are mixed, and simply widening
 * the radius buys coverage with no evidence. The ground under the record does
 * separate them, because that band is bimodal — half of it stands within a few
 * metres of the height it publishes, half is hundreds of metres off. Held
 * against matches inside the radius, which are right, a 20 m tolerance keeps
 * 88% of them; here it admits 112 summits out of 184 candidates. "le Néron"
 * names a crest whose top is 618 m from its toponym — 18 m outside the radius,
 * which is why it carried no height at all — and reads 0.8 m off.
 */
const FAR_NAME_MATCH_M = 1_500;
const NODE_GROUND_TOLERANCE_M = 20;

const METRES_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

/** OSM and GeoNames cover metropolitan France; the DOM need their own boxes. */
const OSM_BOXES = [
    [41.0, -5.5, 51.5, 10.0],    // metropolitan France and Corsica
    [-21.5, 55.1, -20.8, 55.9],  // La Réunion
    [-13.1, 44.9, -12.6, 45.4],  // Mayotte
    [14.3, -61.3, 14.9, -60.7],  // Martinique
    [15.8, -61.9, 16.6, -60.9],  // Guadeloupe
    [2.0, -54.7, 6.0, -51.5],    // Guyane
];

/** GeoNames feature codes that name a top: peak, mountain, peaks. */
const GEONAMES_CODES = new Set(['PK', 'MT', 'PKS']);

const refetch = process.argv.includes('--refetch');

// ── Plumbing ─────────────────────────────────────────────────────────────────

/**
 * Memoise a producer's JSON result on disk; `--refetch` ignores what is there.
 *
 * A `signature` makes the entry depend on what it was derived from, kept in a
 * sidecar so the raw download caches keep their format. The anchors are walked
 * from the heights and the ground, and would otherwise survive a change to
 * either and hand back positions computed from data that no longer exists.
 */
async function cached(name, produce, signature) {
    mkdirSync(CACHE_DIR, { recursive: true });
    const path = `${CACHE_DIR}${name}.json`;
    const sigPath = `${CACHE_DIR}${name}.sig`;
    const fresh = signature === undefined
        || (existsSync(sigPath) && readFileSync(sigPath, 'utf8') === signature);
    if (!refetch && fresh && existsSync(path)) {
        const hit = JSON.parse(readFileSync(path, 'utf8'));
        console.log(`  ${name}: ${hit.length ?? Object.keys(hit).length} (cache)`);
        return hit;
    }
    const value = await produce();
    writeFileSync(path, JSON.stringify(value));
    if (signature !== undefined) writeFileSync(sigPath, signature);
    return value;
}

async function getJson(url, init) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, ...init });
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            return await res.json();
        } catch (error) {
            if (attempt === 4) throw new Error(`${url} → ${error.message}`);
            console.log(`    retry ${attempt} (${error.message})`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
    }
}

function distanceM(aLng, aLat, bLng, bLat) {
    const dLat = (bLat - aLat) * METRES_PER_DEG_LAT;
    const dLng = (bLng - aLng) * METRES_PER_DEG_LAT * Math.cos(((aLat + bLat) / 2) * DEG);
    return Math.hypot(dLat, dLng);
}

/** Accents, case and punctuation stripped, so "Le Néron" meets "le neron". */
function normalise(name) {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * One entry out of a zip, read through its central directory.
 *
 * Shelling out to `unzip` would mean trusting whatever `PATH` resolves to, for
 * a format whose directory is twenty lines of offsets.
 */
function unzipEntry(zip, wanted) {
    let eocd = zip.length - 22;
    while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
    if (eocd < 0) throw new Error('not a zip archive');
    let at = zip.readUInt32LE(eocd + 16);
    for (let i = zip.readUInt16LE(eocd + 10); i > 0; i -= 1) {
        const nameLen = zip.readUInt16LE(at + 28);
        const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
        const local = zip.readUInt32LE(at + 42);
        if (name === wanted) {
            const method = zip.readUInt16LE(at + 10);
            const size = zip.readUInt32LE(at + 20);
            const from = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
            const body = zip.subarray(from, from + size);
            return method === 0 ? body : inflateRawSync(body);
        }
        at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    throw new Error(`${wanted} not found in archive`);
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** Every page of a WFS query, `sortby` making the paging deterministic. */
async function wfsAll(typename, propertyname, cqlFilter) {
    const features = [];
    for (let start = 0; ; start += WFS_PAGE) {
        const params = new URLSearchParams({
            service: 'WFS', version: '2.0.0', request: 'GetFeature',
            typenames: typename, srsname: 'EPSG:4326', outputFormat: 'application/json',
            count: String(WFS_PAGE), startIndex: String(start),
            sortby: 'cleabs', propertyname, cql_filter: cqlFilter,
        });
        const page = await getJson(`${WFS_URL}?${params}`);
        features.push(...page.features);
        process.stdout.write(`\r    ${features.length} features`);
        if (page.features.length < WFS_PAGE) break;
    }
    process.stdout.write('\n');
    return features;
}

/** The named summits themselves: identity, position and notoriety rank. */
function fetchTopo() {
    const natures = [...SUMMIT_NATURES, ...CULMINATION_NATURES].map((n) => `'${n}'`).join(',');
    return cached('bdtopo', async () => {
        const features = await wfsAll(
            TOPO_TYPENAME, 'cleabs,toponyme,nature,importance,geometrie',
            `nature IN (${natures}) AND importance <= '${MAX_IMPORTANCE}'`,
        );
        return features.flatMap((f) => {
            const { cleabs, toponyme, nature, importance } = f.properties;
            const coords = f.geometry?.coordinates;
            if (!toponyme || !Array.isArray(coords)) return [];
            return [{
                id: cleabs,
                name: toponyme,
                lng: Number(coords[0].toFixed(5)),
                lat: Number(coords[1].toFixed(5)),
                nature,
                importance: Number(importance) || MAX_IMPORTANCE,
            }];
        });
    });
}

/** Surveyed spot heights, keyed by the `cleabs` both products share. */
function fetchCarto() {
    return cached('bdcarto', async () => {
        const features = await wfsAll(CARTO_TYPENAME, 'cleabs,cote', 'cote IS NOT NULL');
        const heights = {};
        for (const f of features) {
            const cote = Number(f.properties.cote);
            if (Number.isFinite(cote)) heights[f.properties.cleabs] = cote;
        }
        return heights;
    });
}

/** OSM peaks carrying an `ele`, the source with the widest useful coverage. */
function fetchOsm() {
    return cached('osm', async () => {
        const clauses = OSM_BOXES.flatMap(([s, w, n, e]) => [
            `node["natural"="peak"]["ele"](${s},${w},${n},${e});`,
            `node["natural"="volcano"]["ele"](${s},${w},${n},${e});`,
        ]).join('');
        const query = `[out:json][timeout:900];(${clauses});out body;`;
        console.log('    querying Overpass (a few minutes)…');
        const data = await getJson(OVERPASS_URL, {
            method: 'POST',
            body: new URLSearchParams({ data: query }),
        });
        return data.elements.flatMap((el) => {
            // `ele` is free text: "1867", "1867 m", "1,867" and worse all occur.
            const ele = Number(String(el.tags.ele).replace(',', '.').replace(/[^\d.-]/g, ''));
            if (!Number.isFinite(ele) || ele < -500 || ele > 5000 || !el.tags.name) return [];
            return [{ name: el.tags.name, lng: el.lon, lat: el.lat, m: Math.round(ele) }];
        });
    });
}

/**
 * GeoNames tops. Column 15 is the published elevation and column 16 the SRTM
 * reading — only the former is worth having, SRTM being 100 m out in the Alps.
 */
function fetchGeoNames() {
    return cached('geonames', async () => {
        const res = await fetch(GEONAMES_URL, { headers: { 'User-Agent': USER_AGENT } });
        const text = unzipEntry(Buffer.from(await res.arrayBuffer()), 'FR.txt').toString('utf8');
        return text.split('\n').flatMap((line) => {
            const c = line.split('\t');
            if (c[6] !== 'T' || !GEONAMES_CODES.has(c[7]) || !c[1]) return [];
            const m = Number(c[15]);
            if (!Number.isFinite(m) || m === 0) return [];
            return [{ name: c[1], lng: Number(c[5]), lat: Number(c[4]), m }];
        });
    });
}

/** RGE ALTI® at an arbitrary list of points, in batches the service answers well. */
async function sampleGround(points, label) {
    const out = new Array(points.length);
    const starts = [];
    for (let i = 0; i < points.length; i += ALTI_BATCH) starts.push(i);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < starts.length) {
            const start = starts[next];
            next += 1;
            const batch = points.slice(start, start + ALTI_BATCH);
            const params = new URLSearchParams({
                lon: batch.map((p) => p.lng).join('|'),
                lat: batch.map((p) => p.lat).join('|'),
                resource: 'ign_rge_alti_wld', delimiter: '|', zonly: 'true',
            });
            const data = await getJson(`${ALTI_URL}?${params}`);
            batch.forEach((p, k) => {
                const z = data.elevations[k];
                if (typeof z === 'number' && z > -1000) out[start + k] = Math.round(z * 10) / 10;
            });
            done += batch.length;
            process.stdout.write(`\r    ${label}: ${done} / ${points.length} sampled`);
        }
    };
    await Promise.all(Array.from({ length: ALTI_CONCURRENCY }, worker));
    process.stdout.write('\n');
    return out;
}

/** RGE ALTI® at each toponym, the yardstick every published height is held to. */
function fetchGround(peaks) {
    return cached('rgealti', async () => {
        const heights = await sampleGround(peaks, 'ground');
        const ground = {};
        peaks.forEach((p, i) => {
            if (heights[i] !== undefined) ground[p.id] = heights[i];
        });
        return ground;
    });
}

// ── Re-anchoring ─────────────────────────────────────────────────────────────

/**
 * How far the ground may sit under a summit's own published height before the
 * toponym is taken to be off the top.
 */
const ANCHOR_DRIFT_M = 40;

/** Past this, the walk has left the summit it started on; the move is abandoned. */
const MAX_ANCHOR_MOVE_M = 2_000;

/** First step of the uphill walk, and the step under which it gives up. */
const CLIMB_START_RADIUS_M = 250;
const CLIMB_MIN_RADIUS_M = 40;

/** Once the ground is this close to the published height, the top is reached. */
const CLIMB_TARGET_SLACK_M = 5;

/** Compass directions probed at each step. */
const CLIMB_DIRECTIONS = 8;

/** Enough for eight full steps of climb plus the three that shrink the radius. */
const MAX_CLIMB_ROUNDS = 16;

/**
 * A probe near a point. Rounded to 6 decimals — 0.1 m, far finer than a 1 m
 * DEM — because full-precision floats make each coordinate 20 characters and
 * a batch of 200 then overruns the service's URI limit.
 */
function offsetPoint(lng, lat, eastM, northM) {
    const round = (v) => Math.round(v * 1e6) / 1e6;
    return {
        lng: round(lng + eastM / (METRES_PER_DEG_LAT * Math.cos(lat * DEG))),
        lat: round(lat + northM / METRES_PER_DEG_LAT),
    };
}

function climbProbes(walkers) {
    const probes = [];
    for (const w of walkers) {
        for (let i = 0; i < CLIMB_DIRECTIONS; i += 1) {
            const angle = (2 * Math.PI * i) / CLIMB_DIRECTIONS;
            probes.push(offsetPoint(w.lng, w.lat,
                Math.sin(angle) * w.radiusM, Math.cos(angle) * w.radiusM));
        }
    }
    return probes;
}

/** Step every walker once, and return those with somewhere left to go. */
function climbStep(walkers, probes, heights) {
    const live = [];
    walkers.forEach((w, i) => {
        let best;
        for (let k = 0; k < CLIMB_DIRECTIONS; k += 1) {
            const z = heights[i * CLIMB_DIRECTIONS + k];
            if (z !== undefined && (best === undefined || z > best.z)) {
                best = { z, at: probes[i * CLIMB_DIRECTIONS + k] };
            }
        }
        if (best !== undefined && best.z > w.groundM) {
            w.lng = best.at.lng;
            w.lat = best.at.lat;
            w.groundM = best.z;
        } else {
            w.radiusM /= 2;
        }
        w.driftM = distanceM(w.fromLng, w.fromLat, w.lng, w.lat);
        const done = w.groundM >= w.targetM - CLIMB_TARGET_SLACK_M
            || w.radiusM < CLIMB_MIN_RADIUS_M
            || w.driftM > MAX_ANCHOR_MOVE_M;
        if (!done) live.push(w);
    });
    return live;
}

/**
 * Walk a toponym uphill until the ground under it matches the height its own
 * label carries.
 *
 * BD TOPO® anchors a ridge name where it reads well on a map, not on the top:
 * "Rocher de Chalves" sits 619 m south of its summit, on ground 156 m below the
 * 1845 m it is printed with, so the leader line points at a shoulder. That is
 * what the panorama showed, and what PeakFinder avoids by snapping every POI to
 * the highest DEM node around it.
 *
 * The published height is what makes the walk safe to run offline: it says how
 * far there is left to climb, so the walk has a target and stops at it rather
 * than wandering onto a higher neighbour. A walk that strays past
 * {@link MAX_ANCHOR_MOVE_M} is abandoned outright — better the old anchor than
 * a name moved onto the wrong mountain. 1784 of the 13294 heighted summits
 * qualify; the rest already stand within 40 m of their own ground.
 */
function reanchorAll(entries) {
    const signature = createHash('sha256')
        .update(`${ANCHOR_DRIFT_M}/${MAX_ANCHOR_MOVE_M}/${CLIMB_START_RADIUS_M}\n`)
        .update(entries.map((e) => `${e.peak.id}:${e.m}:${e.groundM}:${e.at ?? ''}`).join('\n'))
        .digest('hex');
    return cached('anchors', async () => {
        let walkers = entries
            .filter((e) => e.m !== null && e.groundM !== undefined && e.at === undefined
                && e.m - e.groundM > ANCHOR_DRIFT_M)
            .map((e) => ({
                id: e.peak.id, targetM: e.m, groundM: e.groundM,
                fromLng: e.peak.lng, fromLat: e.peak.lat,
                lng: e.peak.lng, lat: e.peak.lat,
                radiusM: CLIMB_START_RADIUS_M, driftM: 0,
            }));
        const all = walkers;
        console.log(`  ${walkers.length} anchors standing over ${ANCHOR_DRIFT_M} m`
            + ' under their own height');
        for (let round = 1; round <= MAX_CLIMB_ROUNDS && walkers.length > 0; round += 1) {
            const probes = climbProbes(walkers);
            walkers = climbStep(walkers, probes,
                await sampleGround(probes, `climb ${round} (${walkers.length} left)`));
        }
        const moved = {};
        let stalled = 0;
        for (const w of all) {
            // A walk that never got near its target found a shoulder, not the top:
            // le Néron's crest is narrow enough to stall one 119 m short, and
            // further from the summit than the toponym it started at.
            if (w.targetM - w.groundM > ANCHOR_DRIFT_M) { stalled += 1; continue; }
            if (w.driftM > 1 && w.driftM <= MAX_ANCHOR_MOVE_M) moved[w.id] = [w.lng, w.lat];
        }
        console.log(`  ${stalled} walks stalled short of their height and kept`
            + ' their old anchor');
        return moved;
    }, signature);
}

// ── Merge ────────────────────────────────────────────────────────────────────

function nameIndex(records) {
    const index = new Map();
    for (const r of records) {
        const key = normalise(r.name);
        const bucket = index.get(key);
        if (bucket) bucket.push(r); else index.set(key, [r]);
    }
    return index;
}

/** The nearest same-named record within reach, or null. */
function matchByName(index, peak, limitM = MAX_NAME_MATCH_M) {
    let best = null;
    let bestD = limitM;
    for (const r of index.get(normalise(peak.name)) ?? []) {
        const d = distanceM(peak.lng, peak.lat, r.lng, r.lat);
        if (d < bestD) { best = r; bestD = d; }
    }
    return best === null ? null : { ...best, awayM: bestD };
}

/**
 * Same-named points standing past {@link MAX_NAME_MATCH_M}, kept only when the
 * ground under the point reads the height it publishes.
 */
function admitFarMatches(peaks, indexes) {
    const signature = `m+at/${MAX_NAME_MATCH_M}/${FAR_NAME_MATCH_M}/${NODE_GROUND_TOLERANCE_M}`;
    return cached('farmatches', async () => {
        const candidates = [];
        for (const peak of peaks) {
            for (const [source, index] of Object.entries(indexes)) {
                const hit = matchByName(index, peak, FAR_NAME_MATCH_M);
                if (hit !== null && hit.awayM >= MAX_NAME_MATCH_M) {
                    candidates.push({ id: peak.id, source, m: hit.m, lng: hit.lng, lat: hit.lat });
                }
            }
        }
        const heights = await sampleGround(candidates, 'far matches');
        const admitted = {};
        candidates.forEach((c, i) => {
            const g = heights[i];
            if (g === undefined || Math.abs(c.m - g) > NODE_GROUND_TOLERANCE_M) return;
            admitted[c.id] ??= {};
            admitted[c.id][c.source] = { m: c.m, at: [c.lng, c.lat] };
        });
        console.log(`  ${Object.keys(admitted).length} of ${candidates.length}`
            + ' far matches stand on their own height');
        return admitted;
    }, signature);
}

/**
 * Published heights are trusted in this order, which measurement decided rather
 * than authority: held against the reference dataset, OSM is right on 99.9% of
 * the 9219 summits it covers, BD CARTO® on 86.4% of 3105 and GeoNames on 88%
 * of 1952.
 *
 * That OSM wins is partly circular — the reference itself draws on OSM, so the
 * two are not independent. The number that does not suffer from it is BD
 * CARTO®'s 86.4%: it shares no source with the reference, and one cote in seven
 * disagreeing by more than 3 m matches what we found by hand. Where OSM was
 * checkable against something neither side derives from — IGN's own geodetic
 * markers — it was right: Charmant Som 1867 against a marker at 1867.1 ± 0.5,
 * Grande Lance 2790 where the cote says 2596.
 */
const HEIGHT_SOURCES = ['osm', 'bdcarto', 'geonames'];

/** The first published height the ground under the summit does not contradict. */
function chooseHeight(offers, groundM) {
    for (const source of HEIGHT_SOURCES) {
        const m = offers[source];
        if (m === undefined) continue;
        if (groundM !== undefined && !plausible(m, groundM)) continue;
        return { m, source };
    }
    return null;
}

/** Neither buried under its own ground nor floating implausibly far over it. */
function plausible(m, groundM) {
    return groundM <= m + MAX_SURVEY_UNDERSHOOT_M && m <= groundM + MAX_SURVEY_OVERSHOOT_M;
}

/**
 * Every published height anyone offers for one summit, by source, and where a
 * far match proved itself — that point is the summit, measured, so it beats
 * anything the uphill walk could find.
 */
function collectOffers(peak, sources) {
    const offers = {};
    const provenAt = {};
    for (const [source, hit] of Object.entries(sources.far[peak.id] ?? {})) {
        offers[source] = hit.m;
        provenAt[source] = hit.at;
    }
    // A match inside the radius needs no corroboration and outranks a far one.
    const cote = sources.carto[peak.id];
    if (cote !== undefined) { offers.bdcarto = cote; delete provenAt.bdcarto; }
    const osmHit = matchByName(sources.osm, peak);
    if (osmHit) { offers.osm = osmHit.m; delete provenAt.osm; }
    const gnHit = matchByName(sources.geonames, peak);
    if (gnHit) { offers.geonames = gnHit.m; delete provenAt.geonames; }
    return { offers, provenAt };
}

function bump(counter, key) {
    counter[key] = (counter[key] ?? 0) + 1;
}

function mergePeaks(sources) {
    const summitNatures = new Set(SUMMIT_NATURES);
    const stats = { chosen: {}, rejected: {}, heightless: 0, dropped: 0 };
    const kept = [];
    for (const peak of sources.topo) {
        const { offers, provenAt } = collectOffers(peak, sources);
        const groundM = sources.ground[peak.id];
        const chosen = chooseHeight(offers, groundM);

        for (const source of HEIGHT_SOURCES) {
            if (groundM !== undefined && offers[source] !== undefined
                && !plausible(offers[source], groundM)) {
                bump(stats.rejected, source);
            }
        }
        if (chosen) bump(stats.chosen, chosen.source);
        else stats.heightless += 1;

        // Without a height, a `Montagne` or a `Crête` is an area name whose point
        // sits in the middle of nothing one can aim at.
        if (!chosen && !summitNatures.has(peak.nature)) stats.dropped += 1;
        else kept.push({ peak, m: chosen?.m ?? null, groundM, at: chosen && provenAt[chosen.source] });
    }
    return { kept, stats };
}

/** The shipped shape: one flat row per summit, sorted so the file diffs well. */
function toRows(kept, anchors) {
    const out = kept.map(({ peak, m, at }) => {
        const [lng, lat] = at ?? anchors[peak.id] ?? [peak.lng, peak.lat];
        return [peak.name, lng, lat, peak.importance, m];
    });
    out.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
    return out;
}

async function main() {
    console.log('BD TOPO® — named summits');
    const topo = await fetchTopo();
    console.log('BD CARTO® — surveyed spot heights');
    const carto = await fetchCarto();
    console.log('OpenStreetMap — peaks with an elevation');
    const osm = nameIndex(await fetchOsm());
    console.log('GeoNames — peaks with an elevation');
    const geonames = nameIndex(await fetchGeoNames());
    console.log('RGE ALTI® — ground under every toponym');
    const ground = await fetchGround(topo);
    console.log('RGE ALTI® — same-named points past the match radius');
    const far = await admitFarMatches(topo, { osm, geonames });

    const { kept, stats } = mergePeaks({ topo, carto, osm, geonames, ground, far });
    console.log('RGE ALTI® — walking misplaced anchors uphill');
    const anchors = await reanchorAll(kept);
    const out = toRows(kept, anchors);
    writeFileSync(OUT, JSON.stringify(out) + '\n');

    const withHeight = out.filter((p) => p[4] !== null).length;
    console.log(`\n${topo.length} BD TOPO® summits in, ${out.length} out`
        + ` (${stats.dropped} area names dropped for want of a height)`);
    console.log('heights chosen:', stats.chosen, '— none:', stats.heightless);
    console.log('heights the ground contradicted:', stats.rejected);
    console.log(`${Object.keys(anchors).length} anchors walked onto their top`);
    console.log(`${withHeight} of ${out.length} labelled with an altitude`
        + ` (${(100 * withHeight / out.length).toFixed(0)}%)`);
    console.log(`→ ${OUT} (${(readFileSync(OUT).length / 1e6).toFixed(2)} MB)`);
}

await main();
