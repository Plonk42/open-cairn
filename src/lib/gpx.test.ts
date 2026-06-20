import { describe, expect, it } from 'vitest';
import { buildGpxString, parseGpx } from '@/lib/gpx';
import type { RouteWaypoint } from '@/stores/routeStore';

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

describe('parseGpx', () => {
    it('parses <wpt> waypoints with names and [lon, lat] order', () => {
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

    it('falls back to <rtept> route points when there are no waypoints', () => {
        const { waypoints } = parseGpx(RTE_GPX);
        expect(waypoints).toHaveLength(3);
        expect(waypoints[2].coordinate).toEqual([5.9, 45.3]);
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
