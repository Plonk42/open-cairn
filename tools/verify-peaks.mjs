#!/usr/bin/env node
/**
 * Holds `src/lib/peaksData.json` against a third-party reference dataset.
 *
 * The reference is a POI table that is NOT part of this repository and is never
 * redistributed with it — `data/` is gitignored. It exists on one machine, as a
 * yardstick, and nothing in the build depends on it: this script is a check you
 * run by hand after `build-peaks.mjs`, not a gate.
 *
 * What it can and cannot tell you: an agreement means two independent chains
 * reached the same number, which is the only evidence available short of
 * climbing the mountain. A disagreement means one of them is wrong, and the
 * script does not know which — it prints the case so a human can look.
 *
 * Usage: node tools/verify-peaks.mjs [data/pois.csv]
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PEAKS = fileURLToPath(new URL('../src/lib/peaksData.json', import.meta.url));
const DEFAULT_REFERENCE = fileURLToPath(new URL('../data/pois.csv', import.meta.url));

/** Same rule as the builder: names are locally unique, nearest wins. */
const MAX_NAME_MATCH_M = 1000;

/** Buckets the disagreements are reported in, in metres. */
const BANDS = [0, 1, 3, 10, 30, 100];

const METRES_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

function normalise(name) {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distanceM(aLng, aLat, bLng, bLat) {
    const dLat = (bLat - aLat) * METRES_PER_DEG_LAT;
    const dLng = (bLng - aLng) * METRES_PER_DEG_LAT * Math.cos(((aLat + bLat) / 2) * DEG);
    return Math.hypot(dLat, dLng);
}

/** Minimal RFC 4180 reader: the reference has quoted names carrying commas. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c !== '"') field += c;
            else if (text[i + 1] === '"') { field += '"'; i += 1; }
            else quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift();
    return rows.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k]])));
}

function nameIndex(records) {
    const index = new Map();
    for (const r of records) {
        const bucket = index.get(r.key);
        if (bucket) bucket.push(r); else index.set(r.key, [r]);
    }
    return index;
}

function matchByName(index, lng, lat, key) {
    let best = null;
    let bestD = MAX_NAME_MATCH_M;
    for (const r of index.get(key) ?? []) {
        const d = distanceM(lng, lat, r.lng, r.lat);
        if (d < bestD) { best = r; bestD = d; }
    }
    return best;
}

function report(deltas) {
    const sorted = [...deltas].sort((a, b) => a.delta - b.delta);
    console.log('\nagreement on the summits both sides carry a height for:');
    let from = 0;
    for (const band of BANDS) {
        const n = sorted.filter((d) => d.delta > from && d.delta <= band).length;
        if (band > 0) {
            console.log(`  ${String(from).padStart(3)} < |Δ| ≤ ${String(band).padEnd(4)}`
                + ` ${String(n).padStart(6)}  ${(100 * n / sorted.length).toFixed(1)}%`);
        } else {
            const exact = sorted.filter((d) => d.delta === 0).length;
            console.log(`  exact match        ${String(exact).padStart(6)}`
                + `  ${(100 * exact / sorted.length).toFixed(1)}%`);
        }
        from = band;
    }
    const far = sorted.filter((d) => d.delta > BANDS.at(-1));
    console.log(`  |Δ| > ${BANDS.at(-1)}         ${String(far.length).padStart(6)}`
        + `  ${(100 * far.length / sorted.length).toFixed(1)}%`);
    const within = sorted.filter((d) => d.delta <= 3).length;
    console.log(`\nwithin 3 m: ${(100 * within / sorted.length).toFixed(1)}%`);

    console.log('\nthe twenty widest disagreements — one of the two is wrong:');
    for (const d of sorted.slice(-20).reverse()) {
        console.log(`  ${d.name.padEnd(34).slice(0, 34)} ours ${String(d.ours).padStart(5)}`
            + `   reference ${String(d.theirs).padStart(5)}   Δ ${String(d.delta).padStart(5)}`);
    }
}

function main() {
    const referencePath = process.argv[2] ?? DEFAULT_REFERENCE;
    if (!existsSync(referencePath)) {
        console.error(`No reference dataset at ${referencePath}.`);
        console.error('It is deliberately not in the repository; pass a path as argv[2].');
        process.exit(1);
    }
    const peaks = JSON.parse(readFileSync(PEAKS, 'utf8'));
    const reference = nameIndex(parseCsv(readFileSync(referencePath, 'utf8'))
        .filter((r) => r.name && r.ele)
        .map((r) => ({ key: normalise(r.name), lng: Number(r.lon), lat: Number(r.lat), m: Number(r.ele) })));

    const deltas = [];
    let matched = 0;
    let oursOnly = 0;
    let theirsOnly = 0;
    for (const [name, lng, lat, , spotHeightM] of peaks) {
        const hit = matchByName(reference, lng, lat, normalise(name));
        if (!hit) {
            if (spotHeightM !== null) oursOnly += 1;
            continue;
        }
        matched += 1;
        if (spotHeightM === null) { theirsOnly += 1; continue; }
        deltas.push({ name, ours: spotHeightM, theirs: hit.m, delta: Math.abs(spotHeightM - hit.m) });
    }

    const withHeight = peaks.filter((p) => p[4] !== null).length;
    console.log(`${peaks.length} summits in peaksData.json,`
        + ` ${withHeight} with an altitude (${(100 * withHeight / peaks.length).toFixed(0)}%)`);
    console.log(`${matched} found in the reference (${(100 * matched / peaks.length).toFixed(0)}%)`);
    console.log(`  ${deltas.length} comparable — both sides publish a height`);
    console.log(`  ${theirsOnly} the reference heights and we do not`);
    console.log(`${oursOnly} we height and the reference does not carry at all`);
    report(deltas);
}

main();
