import { buildGpxString, parseGpx } from '@/lib/gpx';
import type { RouteWaypoint } from '@/stores/routeStore';
import { describe, expect, it } from 'vitest';

const WPT_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.83" lon="6.86"><name>Start</name></wpt>
  <wpt lat="45.84" lon="6.87"><name>End</name></wpt>
</gpx>`;

const RTE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="45.10" lon="5.70"></rtept>
    <rtept lat="45.20" lon="5.80"></rtept>
    <rtept lat="45.30" lon="5.90"></rtept>
  </rte>
</gpx>`;

const TRACK_ONLY_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="45.00" lon="5.00"></trkpt>
    <trkpt lat="45.01" lon="5.01"></trkpt>
    <trkpt lat="45.02" lon="5.02"></trkpt>
    <trkpt lat="45.03" lon="5.03"></trkpt>
    <trkpt lat="45.04" lon="5.04"></trkpt>
  </trkseg></trk>
</gpx>`;

/** Race markers: scattered off the track and in arbitrary order, like an Openrunner export. */
const POI_MARKERS_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.03" lon="5.03"><name>Ravitaillement</name></wpt>
  <wpt lat="45.01" lon="5.01"><name>Signaleur</name></wpt>
  <wpt lat="45.20" lon="5.20"><name>Secours</name></wpt>
  <trk><trkseg>
    <trkpt lat="45.00" lon="5.00"></trkpt>
    <trkpt lat="45.01" lon="5.01"></trkpt>
    <trkpt lat="45.02" lon="5.02"></trkpt>
    <trkpt lat="45.03" lon="5.03"></trkpt>
    <trkpt lat="45.04" lon="5.04"></trkpt>
  </trkseg></trk>
</gpx>`;

/** Waypoints that really describe the track: on it, and in order. */
const WPT_ON_TRACK_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.00" lon="5.00"><name>Départ</name></wpt>
  <wpt lat="45.02" lon="5.02"><name>Col</name></wpt>
  <wpt lat="45.04" lon="5.04"><name>Arrivée</name></wpt>
  <trk><trkseg>
    <trkpt lat="45.00" lon="5.00"></trkpt>
    <trkpt lat="45.01" lon="5.01"></trkpt>
    <trkpt lat="45.02" lon="5.02"></trkpt>
    <trkpt lat="45.03" lon="5.03"></trkpt>
    <trkpt lat="45.04" lon="5.04"></trkpt>
  </trkseg></trk>
</gpx>`;

/** A loop: the last waypoint is back where the first one started. */
const LOOP_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="45.00" lon="5.00"><name>Départ</name></rtept>
    <rtept lat="45.02" lon="5.02"><name>Col</name></rtept>
    <rtept lat="45.00" lon="5.00"><name>Arrivée</name></rtept>
  </rte>
  <trk><trkseg>
    <trkpt lat="45.00" lon="5.00"></trkpt>
    <trkpt lat="45.01" lon="5.01"></trkpt>
    <trkpt lat="45.02" lon="5.02"></trkpt>
    <trkpt lat="45.01" lon="5.00"></trkpt>
    <trkpt lat="45.00" lon="5.00"></trkpt>
  </trkseg></trk>
</gpx>`;

/** Both elements used as the standard intends: <rte> is the route, <wpt> a point of interest. */
const RTE_AND_POI_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.50" lon="5.50"><name>Refuge</name></wpt>
  <rte>
    <rtept lat="45.10" lon="5.70"><name>Départ</name></rtept>
    <rtept lat="45.20" lon="5.80"><name>Arrivée</name></rtept>
  </rte>
</gpx>`;

describe('parseGpx', () => {
    it('falls back to <wpt> when the file carries no <rte>', () => {
        const { waypoints } = parseGpx(WPT_GPX);
        expect(waypoints).toHaveLength(2);
        expect(waypoints[0].coordinate).toEqual([6.86, 45.83]);
        expect(waypoints[0].name).toBe('Start');
        expect(waypoints[1].name).toBe('End');
    });

    it('marks the first waypoint with no mode and later ones as free', () => {
        const { waypoints } = parseGpx(WPT_GPX);
        expect(waypoints[0].modeFromPrevious).toBeUndefined();
        expect(waypoints[1].modeFromPrevious).toBe('free');
    });

    it('reads the route from <rtept>', () => {
        const { waypoints } = parseGpx(RTE_GPX);
        expect(waypoints).toHaveLength(3);
        expect(waypoints[2].coordinate).toEqual([5.9, 45.3]);
    });

    it('prefers <rte> over <wpt> when both are present', () => {
        const { waypoints } = parseGpx(RTE_AND_POI_GPX);
        expect(waypoints.map((wp) => wp.name)).toEqual(['Départ', 'Arrivée']);
    });

    it('never resamples a route the file already describes, whatever maxWaypoints says', () => {
        const { waypoints } = parseGpx(RTE_GPX, 2);
        expect(waypoints).toHaveLength(3);
    });

    it('snaps a loop closing on its start point to the end of the track, not back to index 0', () => {
        const { waypoints, segments } = parseGpx(LOOP_GPX, 8);
        expect(waypoints.map((wp) => wp.name)).toEqual(['Départ', 'Col', 'Arrivée']);
        expect(waypoints.at(-1)?.coordinate).toEqual([5, 45]);
        expect(segments).toHaveLength(2);
        // The closing leg follows the return branch of the track, not a straight line back.
        expect(segments![1].coordinates).toHaveLength(3);
    });

    it('samples waypoints from a track-only file and builds segments', () => {
        const result = parseGpx(TRACK_ONLY_GPX, 3);
        expect(result.waypoints.length).toBe(3);
        expect(result.waypoints[0].name).toBe('Départ');
        expect(result.waypoints.at(-1)?.name).toBe('Arrivée');
        expect(result.segments).toBeDefined();
        expect(result.segments!.length).toBe(2);
    });

    it('throws on malformed XML', () => {
        expect(() => parseGpx('<gpx><wpt</gpx>')).toThrow();
    });

    it('ignores <wpt> markers that are off-track or out of order and samples the track instead', () => {
        const { waypoints, segments } = parseGpx(POI_MARKERS_GPX, 3);
        expect(waypoints.map((wp) => wp.name)).toEqual(['Départ', undefined, 'Arrivée']);
        expect(waypoints.at(-1)?.coordinate).toEqual([5.04, 45.04]);
        expect(segments).toHaveLength(2);
    });

    it('keeps <wpt> that lie on the track in order, and cuts the segments out of it', () => {
        const { waypoints, segments } = parseGpx(WPT_ON_TRACK_GPX, 3);
        expect(waypoints.map((wp) => wp.name)).toEqual(['Départ', 'Col', 'Arrivée']);
        expect(segments).toHaveLength(2);
        expect(segments![0].coordinates).toHaveLength(3);
    });

    it('reports <wpt> as markers when <rte> carries the route', () => {
        const { markers } = parseGpx(RTE_AND_POI_GPX);
        expect(markers).toHaveLength(1);
        expect(markers[0].name).toBe('Refuge');
        expect(markers[0].coordinate).toEqual([5.5, 45.5]);
    });

    it('reports the ignored <wpt> as markers when it falls back to sampling the track', () => {
        const { markers } = parseGpx(POI_MARKERS_GPX, 3);
        expect(markers.map((m) => m.name)).toEqual(['Ravitaillement', 'Signaleur', 'Secours']);
    });

    it('reports no marker for <wpt> promoted to the route', () => {
        expect(parseGpx(WPT_GPX).markers).toEqual([]);
        expect(parseGpx(WPT_ON_TRACK_GPX, 3).markers).toEqual([]);
    });

    it('gives markers ids that cannot collide with waypoint ids', () => {
        const { waypoints, markers } = parseGpx(RTE_AND_POI_GPX);
        expect(markers.every((m) => !waypoints.some((wp) => wp.id === m.id))).toBe(true);
    });
});

describe('buildGpxString', () => {
    const waypoints: RouteWaypoint[] = [
        { id: 'a', coordinate: [6.86, 45.83], name: 'A' },
        { id: 'b', coordinate: [6.87, 45.84], modeFromPrevious: 'free' },
    ];

    it('emits a valid GPX document round-trippable by parseGpx', () => {
        const xml = buildGpxString(waypoints, []);
        expect(xml).toContain('<gpx');
        const { waypoints: parsed } = parseGpx(xml);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].coordinate).toEqual([6.86, 45.83]);
    });

    it('puts the route in <rte> and the geometry in <trk>, and emits no <wpt>', () => {
        const xml = buildGpxString(waypoints, [
            [6.86, 45.83],
            [6.865, 45.835],
            [6.87, 45.84],
        ]);
        expect(xml).toContain('<rtept lat="45.83" lon="6.86">');
        expect(xml).toContain('<trkpt lat="45.835" lon="6.865">');
        expect(xml).not.toContain('<wpt');
    });

    it('round-trips the track geometry into segments', () => {
        const xml = buildGpxString(waypoints, [
            [6.86, 45.83],
            [6.865, 45.835],
            [6.87, 45.84],
        ]);
        const { waypoints: parsed, segments } = parseGpx(xml);
        expect(parsed.map((wp) => wp.name)).toEqual(['A', 'Point 2']);
        expect(segments).toHaveLength(1);
        expect(segments![0].coordinates).toHaveLength(3);
    });

    it('uses a default name for unnamed waypoints', () => {
        const xml = buildGpxString(waypoints, []);
        expect(xml).toContain('<name>A</name>');
        expect(xml).toContain('<name>Point 2</name>');
    });

    it('escapes XML-special characters in names', () => {
        const xml = buildGpxString([{ id: 'x', coordinate: [1, 2], name: 'A & <B>' }], []);
        expect(xml).toContain('A &amp; &lt;B&gt;');
    });
});
