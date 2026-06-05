/**
 * Cliff cross-section / profile slicing tool for climbers.
 *
 * Given a loaded LiDAR point cloud and a 2-point ground line, project every
 * point that lies inside a vertical-plane corridor onto the slice plane,
 * producing a 2D profile (distance along line, elevation) — like an
 * "MRI cut" through the rock. Then provide rope-length math between
 * climber-defined belay stations.
 */

import type { LngLatTuple } from './geo';
import type { LidarMeshData } from './lidarCloud';

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEGREE_LAT = 111_319.491;

/** A single point projected onto the vertical slice plane. */
export interface SliceProfilePoint {
    /** Horizontal distance along the slice line, meters from start. */
    d: number;
    /** Elevation (z), meters above sea level. */
    e: number;
    /** Signed perpendicular distance to the slice plane, meters. */
    depth: number;
    /** ASPRS LAS classification of the point. */
    cls: number;
    /** Index into the original cloud positions array (for back-references). */
    idx: number;
}

export interface SliceProfile {
    start: LngLatTuple;
    end: LngLatTuple;
    /** Length of the slice line on the ground, meters. */
    length: number;
    /** Half-width of the corridor sampled either side of the plane, meters. */
    halfCorridor: number;
    /** Projected points, NOT sorted (preserves original cloud order). */
    points: SliceProfilePoint[];
    /** Same points sorted ascending by d, used for envelope queries. */
    sorted: SliceProfilePoint[];
    /** Min / max elevation in the profile. */
    eMin: number;
    eMax: number;
}

/** A climber-defined belay station / anchor on the cliff profile. */
export interface CliffStation {
    id: string;
    /** Distance along the slice line, meters. */
    d: number;
    /** Elevation, meters. */
    e: number;
    /** Optional human label (e.g. "R1", "Relais"). */
    label?: string;
}

/** Metrics for the rope segment between two consecutive stations. */
export interface RopeSegment {
    fromId: string;
    toId: string;
    /** Horizontal run, meters. */
    run: number;
    /** Vertical change (positive = up), meters. */
    rise: number;
    /** Direct 3D Euclidean distance between A and B, meters. */
    direct: number;
    /** Recommended rope length: direct × (1 + safetyMargin), meters. */
    rope: number;
    /** Mean angle of the segment from horizontal, in degrees (90 = vertical, >90 = overhang). */
    angle: number;
    /** True if the segment slopes upward yet horizontally moves backward (negative run while gaining height — overhang). */
    overhang: boolean;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Local equirectangular projection                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Project a lng/lat onto a local east/north meter frame whose origin is
 * (refLng, refLat). Same small-angle approximation already used in
 * `lidarPreviewGeoJson` — accurate to ~ 0.1 % over a few km at French latitudes.
 */
export function lngLatToLocalMeters(lng: number, lat: number, refLng: number, refLat: number): [number, number] {
    const cosLat = Math.cos(refLat * DEG_TO_RAD);
    const east = (lng - refLng) * METERS_PER_DEGREE_LAT * cosLat;
    const north = (lat - refLat) * METERS_PER_DEGREE_LAT;
    return [east, north];
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Profile extraction                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Minimal point-source contract used by the slice extractor. Both the shaded
 * cloud (`LidarShadedCloudData`) and a mesh (`LidarMeshData`) satisfy it once
 * we know how many points to read from `positions`. Mesh vertices are treated
 * as ground points (class 2) by default since the mesh paths only mesh ground.
 */
export interface SliceSource {
    centerLng: number;
    centerLat: number;
    /** Interleaved (dx_east_m, dy_north_m, alt_m) Float32. */
    positions: Float32Array;
    /** Optional ASPRS classification per point. If absent every point uses `defaultClass`. */
    classifications?: Uint8Array;
    /** How many points to read from `positions`. */
    pointCount: number;
    /** Class assigned to points that have no classification array (default 2 = Ground). */
    defaultClass?: number;
}

/** Adapt a mesh to a slice source — vertices are tagged as class 2 (ground). */
export function meshAsSliceSource(mesh: LidarMeshData): SliceSource {
    return {
        centerLng: mesh.centerLng,
        centerLat: mesh.centerLat,
        positions: mesh.positions,
        pointCount: mesh.vertexCount,
        defaultClass: 2,
    };
}

interface SliceFrame {
    sx: number; sy: number;
    tx: number; ty: number;
    nx: number; ny: number;
    length: number;
}

function collectSlicePoints(
    source: SliceSource,
    frame: SliceFrame,
    halfCorridor: number,
    classFilter: ReadonlySet<number> | null,
): { out: SliceProfilePoint[]; eMin: number; eMax: number } {
    const { sx, sy, tx, ty, nx, ny, length } = frame;
    const positions = source.positions;
    const classifications = source.classifications;
    const defaultClass = source.defaultClass ?? 2;
    const out: SliceProfilePoint[] = [];
    let eMin = Infinity;
    let eMax = -Infinity;
    const n = source.pointCount;
    for (let i = 0; i < n; i += 1) {
        const px = positions[i * 3] - sx;
        const py = positions[i * 3 + 1] - sy;
        const t = px * tx + py * ty;
        if (t < 0 || t > length) continue;
        const np = px * nx + py * ny;
        if (np < -halfCorridor || np > halfCorridor) continue;
        const cls = classifications ? classifications[i] : defaultClass;
        if (classFilter && !classFilter.has(cls)) continue;
        const e = positions[i * 3 + 2];
        if (e < eMin) eMin = e;
        if (e > eMax) eMax = e;
        out.push({ d: t, e, depth: np, cls, idx: i });
    }
    return { out, eMin, eMax };
}

/**
 * Extract every cloud point lying inside the vertical slab of width
 * `2 × halfCorridor` straddling the line from `start` to `end`, and project
 * them onto the slice plane.
 */
export function extractSliceProfile(
    source: SliceSource,
    start: LngLatTuple,
    end: LngLatTuple,
    halfCorridor: number,
    classFilter: ReadonlySet<number> | null = null,
): SliceProfile {
    const refLng = source.centerLng;
    const refLat = source.centerLat;
    const [sx, sy] = lngLatToLocalMeters(start[0], start[1], refLng, refLat);
    const [ex, ey] = lngLatToLocalMeters(end[0], end[1], refLng, refLat);
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) {
        return { start, end, length, halfCorridor, points: [], sorted: [], eMin: 0, eMax: 0 };
    }
    const tx = dx / length;
    const ty = dy / length;
    const frame: SliceFrame = { sx, sy, tx, ty, nx: -ty, ny: tx, length };
    const { out, eMin, eMax } = collectSlicePoints(source, frame, halfCorridor, classFilter);
    if (out.length === 0) {
        return { start, end, length, halfCorridor, points: [], sorted: [], eMin: 0, eMax: 0 };
    }
    const sorted = out.slice().sort((a, b) => a.d - b.d);
    return { start, end, length, halfCorridor, points: out, sorted, eMin, eMax };
}

/**
 * Merge two profiles produced for the same slice line (e.g. ground vertices
 * extracted from the mesh + non-ground points from the shaded cloud). Both
 * profiles MUST share `start`, `end`, `length` and `halfCorridor`.
 */
export function mergeSliceProfiles(a: SliceProfile, b: SliceProfile): SliceProfile {
    if (a.points.length === 0) return b;
    if (b.points.length === 0) return a;
    const points = a.points.concat(b.points);
    const sorted = points.slice().sort((p, q) => p.d - q.d);
    return {
        start: a.start,
        end: a.end,
        length: a.length,
        halfCorridor: a.halfCorridor,
        points,
        sorted,
        eMin: Math.min(a.eMin, b.eMin),
        eMax: Math.max(a.eMax, b.eMax),
    };
}

/**
 * Build a single profile from a polyline by concatenating per-segment
 * profiles. The `d` axis is cumulative across all segments. `depth` remains
 * per-segment perpendicular (fine for visualisation, the corridor stays the
 * same width along the bent line).
 */
export function extractPolylineSliceProfile(
    source: SliceSource,
    polyline: ReadonlyArray<LngLatTuple>,
    halfCorridor: number,
    classFilter: ReadonlySet<number> | null = null,
): SliceProfile | null {
    if (polyline.length < 2) return null;
    const start = polyline[0];
    const end = polyline.at(-1) ?? start;
    const merged: SliceProfilePoint[] = [];
    let cumulative = 0;
    let eMin = Infinity;
    let eMax = -Infinity;
    for (let i = 0; i < polyline.length - 1; i += 1) {
        const seg = extractSliceProfile(source, polyline[i], polyline[i + 1], halfCorridor, classFilter);
        for (const p of seg.points) {
            merged.push({ d: p.d + cumulative, e: p.e, depth: p.depth, cls: p.cls, idx: p.idx });
        }
        if (seg.points.length > 0) {
            if (seg.eMin < eMin) eMin = seg.eMin;
            if (seg.eMax > eMax) eMax = seg.eMax;
        }
        cumulative += seg.length;
    }
    if (merged.length === 0) {
        return { start, end, length: cumulative, halfCorridor, points: [], sorted: [], eMin: 0, eMax: 0 };
    }
    const sorted = merged.slice().sort((a, b) => a.d - b.d);
    return { start, end, length: cumulative, halfCorridor, points: merged, sorted, eMin, eMax };
}

/** Cumulative breakpoints (in `d` meters) of each polyline vertex; length === polyline.length. */
export function polylineCumulativeLengths(
    polyline: ReadonlyArray<LngLatTuple>,
    refLng: number,
    refLat: number,
): number[] {
    const out: number[] = [0];
    for (let i = 1; i < polyline.length; i += 1) {
        const [ax, ay] = lngLatToLocalMeters(polyline[i - 1][0], polyline[i - 1][1], refLng, refLat);
        const [bx, by] = lngLatToLocalMeters(polyline[i][0], polyline[i][1], refLng, refLat);
        out.push(out[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    return out;
}

/**
 * Walk the upper envelope of a `SliceProfile` to produce a 3D path that
 * traces the LiDAR surface along the polyline.
 *
 * `profile` MUST be the result of `extractPolylineSliceProfile(...)` on the
 * same polyline (typically the merged cloud + mesh profile the cliff-slice
 * chart consumes — same projection, same `halfCorridor`, same class filter).
 * For each `bucketWidth`-meter bucket along the polyline we keep the max
 * elevation, smooth with a morphological close → open, and reproject the
 * bucket centre back to (lng, lat) along the polyline.
 *
 * The result is the 1D "skyline" the chart already shows, lifted into world
 * coordinates so it can be drawn on top of the cloud. Buckets without any
 * profile point are skipped — the chart proves the user-set corridor has
 * coverage end-to-end, so this normally produces a continuous ribbon. The
 * first and last vertices coincide in (lng, lat) with the polyline
 * endpoints (their z comes from the nearest non-empty bucket) so the line
 * actually attaches at the user clicks.
 */
export function traceLidarSurfacePathFromProfile(
    profile: SliceProfile,
    polyline: ReadonlyArray<LngLatTuple>,
    refLng: number,
    refLat: number,
    bucketWidth = 0.5,
): Array<{ lng: number; lat: number; z: number }> {
    if (profile.length === 0 || profile.points.length === 0) return [];
    const cum = polylineCumulativeLengths(polyline, refLng, refLat);
    const totalLen = cum.at(-1) ?? 0;
    if (totalLen <= 0) return [];
    // Bucket on the polyline length (not the profile length) so the path's
    // d axis matches the polyline exactly; otherwise tiny discrepancies
    // between per-segment `seg.length` and the polyline-length sum compound
    // along the line and the last buckets fall past B.
    const env = envelopeFromPoints(profile.points, totalLen, bucketWidth);
    interpolateGapsInPlace(env);
    const w = totalLen / env.length;
    const head = polyline[0];
    const tail = polyline.at(-1) ?? head;
    const out: Array<{ lng: number; lat: number; z: number }> = [];
    // Always emit A at its click location; z is the first non-NaN bucket
    // (which after gap interpolation is bucket 0 unless the entire envelope
    // is empty).
    const headZ = firstFinite(env);
    if (headZ !== null) out.push({ lng: head[0], lat: head[1], z: headZ });
    for (let k = 0; k < env.length; k += 1) {
        const z = env[k];
        if (Number.isNaN(z)) continue;
        const d = (k + 0.5) * w;
        const [lng, lat] = lngLatAtPolylineDistance(polyline, cum, d);
        out.push({ lng, lat, z });
    }
    const tailZ = lastFinite(env);
    if (tailZ !== null) out.push({ lng: tail[0], lat: tail[1], z: tailZ });
    return out;
}

/** Bucket profile points by their d axis over [0, totalLen); max z per bucket; smooth with morphological close → open. */
function envelopeFromPoints(
    points: ReadonlyArray<SliceProfilePoint>,
    totalLen: number,
    bucketWidth: number,
): Float32Array {
    const n = Math.max(2, Math.ceil(totalLen / bucketWidth));
    const tops = new Float32Array(n);
    tops.fill(Number.NaN);
    const w = totalLen / n;
    for (const p of points) {
        let k = Math.floor(p.d / w);
        if (k < 0) k = 0;
        else if (k >= n) k = n - 1;
        const cur = tops[k];
        if (Number.isNaN(cur) || p.e > cur) tops[k] = p.e;
    }
    return morph3(morph3(tops, 'max'), 'min');
}

/** Linearly fill runs of NaN buckets between two finite anchors so the rendered path stays continuous. */
function interpolateGapsInPlace(buf: Float32Array): void {
    const n = buf.length;
    let i = 0;
    while (i < n) {
        if (!Number.isNaN(buf[i])) { i += 1; continue; }
        const j = findGapEnd(buf, i);
        fillGap(buf, i, j);
        i = j;
    }
}

/** Index of the first finite bucket at or after `start` (or n if none). */
function findGapEnd(buf: Float32Array, start: number): number {
    let j = start;
    while (j < buf.length && Number.isNaN(buf[j])) j += 1;
    return j;
}

/** Fill buf[i..j-1] (all NaN) using prev anchor at i-1 and next anchor at j. */
function fillGap(buf: Float32Array, i: number, j: number): void {
    const prev = i > 0 ? buf[i - 1] : Number.NaN;
    const next = j < buf.length ? buf[j] : Number.NaN;
    const hasPrev = !Number.isNaN(prev);
    const hasNext = !Number.isNaN(next);
    if (hasPrev && hasNext) {
        const span = j - i + 1;
        for (let k = i; k < j; k += 1) {
            const t = (k - (i - 1)) / span;
            buf[k] = prev + (next - prev) * t;
        }
    } else if (hasPrev) {
        for (let k = i; k < j; k += 1) buf[k] = prev;
    } else if (hasNext) {
        for (let k = i; k < j; k += 1) buf[k] = next;
    }
}

function firstFinite(buf: Float32Array): number | null {
    for (const v of buf) if (!Number.isNaN(v)) return v;
    return null;
}

function lastFinite(buf: Float32Array): number | null {
    for (let i = buf.length - 1; i >= 0; i -= 1) {
        if (!Number.isNaN(buf[i])) return buf[i];
    }
    return null;
}

/** Linearly walk the polyline up to cumulative distance `d` (meters); returns the lng/lat at that point. */
function lngLatAtPolylineDistance(
    polyline: ReadonlyArray<LngLatTuple>,
    cum: ReadonlyArray<number>,
    d: number,
): [number, number] {
    if (d <= 0) return [polyline[0][0], polyline[0][1]];
    const totalLen = cum.at(-1) ?? 0;
    if (d >= totalLen) {
        const tail = polyline.at(-1) ?? polyline[0];
        return [tail[0], tail[1]];
    }
    for (let i = 1; i < cum.length; i += 1) {
        if (d <= cum[i]) {
            const segStart = cum[i - 1];
            const segLen = cum[i] - segStart;
            const t = segLen > 0 ? (d - segStart) / segLen : 0;
            const a = polyline[i - 1];
            const b = polyline[i];
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
    }
    const tail = polyline.at(-1) ?? polyline[0];
    return [tail[0], tail[1]];
}

/** 3-tap morphological pass over a NaN-aware buffer (op = 'max' or 'min'). */
function morph3(buf: Float32Array, op: 'max' | 'min'): Float32Array {
    const n = buf.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        out[i] = pickExtremum(
            i > 0 ? buf[i - 1] : Number.NaN,
            buf[i],
            i < n - 1 ? buf[i + 1] : Number.NaN,
            op,
        );
    }
    return out;
}

function pickExtremum(a: number, b: number, c: number, op: 'max' | 'min'): number {
    let m = Number.NaN;
    m = combine(m, a, op);
    m = combine(m, b, op);
    m = combine(m, c, op);
    return m;
}

function combine(m: number, v: number, op: 'max' | 'min'): number {
    if (Number.isNaN(v)) return m;
    if (Number.isNaN(m)) return v;
    return op === 'max' ? Math.max(m, v) : Math.min(m, v);
}

/**
 * For every segment of the polyline, sample the topmost LiDAR elevation in
 * pixel-wide d-buckets. Returns `(lng, lat, z)` in polyline order. Buckets
 * with no LiDAR coverage are omitted (the consumer can fall back to terrain
 * draping there).
 */
export function sampleLidarAlongPolyline(
    source: SliceSource,
    polyline: ReadonlyArray<LngLatTuple>,
    halfCorridor: number,
    classFilter: ReadonlySet<number> | null = null,
    sampleStepMeters = 0.5,
): Array<{ lng: number; lat: number; z: number }> {
    const out: Array<{ lng: number; lat: number; z: number }> = [];
    for (let i = 0; i < polyline.length - 1; i += 1) {
        sampleLidarAlongSegment(source, polyline[i], polyline[i + 1], halfCorridor, classFilter, sampleStepMeters, out);
    }
    return out;
}

function sampleLidarAlongSegment(
    source: SliceSource,
    a: LngLatTuple,
    b: LngLatTuple,
    halfCorridor: number,
    classFilter: ReadonlySet<number> | null,
    sampleStepMeters: number,
    out: Array<{ lng: number; lat: number; z: number }>,
): void {
    const prof = extractSliceProfile(source, a, b, halfCorridor, classFilter);
    if (prof.length === 0 || prof.points.length === 0) return;
    const nBuckets = Math.max(2, Math.ceil(prof.length / sampleStepMeters));
    const bucketWidth = prof.length / nBuckets;
    const tops = new Float32Array(nBuckets);
    tops.fill(Number.NEGATIVE_INFINITY);
    for (const p of prof.sorted) {
        let k = Math.floor(p.d / bucketWidth);
        if (k < 0) k = 0;
        else if (k >= nBuckets) k = nBuckets - 1;
        if (p.e > tops[k]) tops[k] = p.e;
    }
    for (let k = 0; k < nBuckets; k += 1) {
        const z = tops[k];
        if (!Number.isFinite(z)) continue;
        const t = (k + 0.5) / nBuckets;
        out.push({ lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, z });
    }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Snapping                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Find the profile point nearest to (d, e) in metric distance.
 * Returns null if the profile is empty.
 *
 * `dScale` and `eScale` let the caller bias snapping in chart pixel space
 * (so a wide chart doesn't snap horizontally too eagerly); pass 1, 1 for
 * pure meter-space search.
 */
export function snapToProfile(
    profile: SliceProfile,
    d: number,
    e: number,
    dScale = 1,
    eScale = 1,
): SliceProfilePoint | null {
    if (profile.points.length === 0) return null;
    let best: SliceProfilePoint | null = null;
    let bestSq = Infinity;
    // Linear scan — fine up to ~100k points; binary search would only help on d, not e.
    for (const p of profile.points) {
        const dx = (p.d - d) * dScale;
        const de = (p.e - e) * eScale;
        const sq = dx * dx + de * de;
        if (sq < bestSq) { bestSq = sq; best = p; }
    }
    return best;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Rope length math                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Compute the rope segment between A and B.
 *
 * For sport-climbing pitches (clipping bolts), the rope path is essentially
 * the straight 3D line from one anchor to the next, plus a safety margin
 * accounting for slack, knots and rope stretch. `safetyMargin` defaults to
 * 0.15 (= 15 % extra), the figure most rope manufacturers recommend for
 * single-pitch sport routes.
 */
export function ropeBetween(a: CliffStation, b: CliffStation, safetyMargin: number): RopeSegment {
    const run = b.d - a.d;
    const rise = b.e - a.e;
    const direct = Math.hypot(run, rise);
    const rope = direct * (1 + safetyMargin);
    // Angle from horizontal — climbers care about overhang severity.
    // 0° = traverse, 90° = pure vertical, > 90° = overhang (rise > 0 while run < 0).
    let angle = Math.atan2(Math.abs(rise), run) * (180 / Math.PI);
    if (rise > 0 && run < 0) angle = 180 - angle;
    const overhang = rise > 0 && run < 0;
    return { fromId: a.id, toId: b.id, run, rise, direct, rope, angle, overhang };
}

/** Compute rope segments for every consecutive station pair. */
export function ropeSegments(stations: CliffStation[], safetyMargin: number): RopeSegment[] {
    const out: RopeSegment[] = [];
    for (let i = 1; i < stations.length; i += 1) {
        out.push(ropeBetween(stations[i - 1], stations[i], safetyMargin));
    }
    return out;
}

export interface RopeTotals {
    /** Sum of (direct × (1 + safetyMargin)) over all segments — total rope to carry. */
    total: number;
    /** Sum of direct 3D distances, no safety margin. */
    directTotal: number;
    /** Sum of vertical gain, m. */
    ascent: number;
    /** Sum of vertical loss, m. */
    descent: number;
    /** Length of the longest single segment — minimum single rope needed. */
    longest: number;
}

export function ropeTotals(segments: RopeSegment[]): RopeTotals {
    let total = 0;
    let directTotal = 0;
    let ascent = 0;
    let descent = 0;
    let longest = 0;
    for (const s of segments) {
        total += s.rope;
        directTotal += s.direct;
        if (s.rise > 0) ascent += s.rise; else descent += -s.rise;
        if (s.rope > longest) longest = s.rope;
    }
    return { total, directTotal, ascent, descent, longest };
}
