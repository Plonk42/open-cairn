/**
 * Flight-line reconstruction for scan-angle normal orientation.
 *
 * IGN LiDAR HD points (point format 6/7) carry, per return, the sensor
 * `ScanAngle` (degrees off-nadir), the originating `PointSourceId` (one id per
 * flight line / acquisition strip) and a `GpsTime`. From these we can recover,
 * for each flight line, the *across-track azimuth* `thetaAcross` — the compass
 * direction the scanner sweeps, perpendicular to the aircraft heading.
 *
 * With that azimuth and a point's scan angle we reconstruct the laser-beam
 * direction, which tells us unambiguously which way the surface it hit must
 * face (a normal can only be seen from the side the beam came from). This is
 * the strongest orientation cue available — far better than the "points up"
 * heuristic for vertical cliffs, overhangs and arches.
 *
 * Port of `LidarTerrainMesh/src/las_source.cpp` (`las_stat_sources`,
 * `las_approx_flight_lines`). Positions here are already in meters
 * (METER_OFFSETS frame), so the LAS integer→meter scale factor is 1.
 */

/** Per-point scan metadata, parallel to the interleaved position array. */
export interface ScanData {
    /** Sensor scan angle off-nadir, degrees. */
    scanAngle: Float32Array;
    /** Flight-line / acquisition-strip id (LAS PointSourceId). */
    sourceId: Uint16Array;
    /** GPS time of the return, seconds. */
    gpsTime: Float64Array;
}

/** Reconstructed orientation for one flight line. */
export interface FlightLine {
    valid: boolean;
    /** Across-track azimuth (radians) — the scanner sweep direction. */
    thetaAcross: number;
}

/** Flight-line model: one entry per distinct source + a per-point source index. */
export interface FlightLineModel {
    lines: FlightLine[];
    sourceIdx: Uint32Array;
}

interface SourceStat {
    minGps: number;
    maxGps: number;
    minAngle: number;
    maxAngle: number;
}

/** Along-track search: the two extreme-GPS points at a fixed representative angle. */
interface AlongSearch {
    reprAngle: number;
    minGps: number;
    maxGps: number;
    idxMin: number;
    idxMax: number;
}

/** Across-track search: the two extreme-angle points at a fixed representative GPS time. */
interface AcrossSearch {
    reprGps: number;
    gpsTol: number;
    minAngle: number;
    maxAngle: number;
    idxMin: number;
    idxMax: number;
}

const ANGLE_TOL = 2;

/** Map each point's LAS PointSourceId to a contiguous [0, count) index. */
function mapSources(sourceId: Uint16Array): { sourceIdx: Uint32Array; count: number } {
    const map = new Map<number, number>();
    const sourceIdx = new Uint32Array(sourceId.length);
    let count = 0;
    for (let i = 0; i < sourceId.length; i++) {
        const id = sourceId[i];
        let idx = map.get(id);
        if (idx === undefined) { idx = count++; map.set(id, idx); }
        sourceIdx[i] = idx;
    }
    return { sourceIdx, count };
}

/** Per-source min/max of scan angle and GPS time. */
function collectStats(scan: ScanData, sourceIdx: Uint32Array, count: number): SourceStat[] {
    const stats: SourceStat[] = [];
    for (let s = 0; s < count; s++) {
        stats.push({ minGps: Infinity, maxGps: -Infinity, minAngle: 90, maxAngle: -90 });
    }
    for (let i = 0; i < sourceIdx.length; i++) {
        const st = stats[sourceIdx[i]];
        const a = scan.scanAngle[i], g = scan.gpsTime[i];
        if (a < st.minAngle) st.minAngle = a;
        if (a > st.maxAngle) st.maxAngle = a;
        if (g < st.minGps) st.minGps = g;
        if (g > st.maxGps) st.maxGps = g;
    }
    return stats;
}

/** Pick a representative scan angle near nadir but clear of the swath edges. */
function reprAngle(min: number, max: number): number {
    if (max - min <= 10) return (max + min) / 2;
    const lo = min + 5, hi = max - 5;
    if (lo <= 0 && hi >= 0) return 0;
    return lo >= 0 ? lo : hi;
}

function initAlong(s: SourceStat): AlongSearch {
    return { reprAngle: reprAngle(s.minAngle, s.maxAngle), minGps: Infinity, maxGps: -Infinity, idxMin: -1, idxMax: -1 };
}

function initAcross(s: SourceStat): AcrossSearch {
    return {
        reprGps: (s.maxGps + s.minGps) / 2,
        gpsTol: (s.maxGps - s.minGps) / 100,
        minAngle: 90, maxAngle: -90, idxMin: -1, idxMax: -1,
    };
}

function updateAlong(al: AlongSearch, angle: number, gps: number, i: number): void {
    if (Math.abs(angle - al.reprAngle) > ANGLE_TOL) return;
    if (gps > al.maxGps) { al.maxGps = gps; al.idxMax = i; }
    if (gps < al.minGps) { al.minGps = gps; al.idxMin = i; }
}

function updateAcross(ac: AcrossSearch, angle: number, gps: number, i: number): void {
    if (Math.abs(gps - ac.reprGps) > ac.gpsTol) return;
    if (angle > ac.maxAngle) { ac.maxAngle = angle; ac.idxMax = i; }
    if (angle < ac.minAngle) { ac.minAngle = angle; ac.idxMin = i; }
}

/** Resolve a flight line's across-track azimuth from its extreme-point pairs. */
function resolveAzimuth(positions: Float32Array, al: AlongSearch, ac: AcrossSearch): FlightLine {
    if (al.idxMin < 0 || al.idxMax < 0 || ac.idxMin < 0 || ac.idxMax < 0) {
        return { valid: false, thetaAcross: 0 };
    }
    const dxAl = positions[al.idxMax * 3] - positions[al.idxMin * 3];
    const dyAl = positions[al.idxMax * 3 + 1] - positions[al.idxMin * 3 + 1];
    const dxAc = positions[ac.idxMax * 3] - positions[ac.idxMin * 3];
    const dyAc = positions[ac.idxMax * 3 + 1] - positions[ac.idxMin * 3 + 1];
    if ((dxAl === 0 && dyAl === 0) || (dxAc === 0 && dyAc === 0)) {
        return { valid: false, thetaAcross: 0 };
    }
    const thetaAl = Math.atan2(dyAl, dxAl);
    const thetaAc = Math.atan2(dyAc, dxAc);
    // Reject when along- and across-track directions aren't ~perpendicular
    // (degenerate strip geometry → unreliable azimuth).
    const check = Math.cos(thetaAl) * Math.sin(thetaAc) - Math.cos(thetaAc) * Math.sin(thetaAl);
    if (Math.abs(check) < 0.5) return { valid: false, thetaAcross: 0 };
    return { valid: true, thetaAcross: thetaAc };
}

/**
 * Reconstruct each flight line's across-track azimuth. Returns one
 * {@link FlightLine} per distinct source plus the per-point source index.
 */
export function buildFlightLines(positions: Float32Array, scan: ScanData): FlightLineModel {
    const { sourceIdx, count } = mapSources(scan.sourceId);
    const stats = collectStats(scan, sourceIdx, count);
    const along = stats.map(initAlong);
    const across = stats.map(initAcross);
    const n = sourceIdx.length;
    for (let i = 0; i < n; i++) {
        const s = sourceIdx[i];
        updateAlong(along[s], scan.scanAngle[i], scan.gpsTime[i], i);
        updateAcross(across[s], scan.scanAngle[i], scan.gpsTime[i], i);
    }
    const lines: FlightLine[] = [];
    for (let s = 0; s < count; s++) lines.push(resolveAzimuth(positions, along[s], across[s]));
    return { lines, sourceIdx };
}
