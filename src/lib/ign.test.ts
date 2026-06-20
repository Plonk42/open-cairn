import { describe, expect, it } from 'vitest';
import {
    ignLayerUrl,
    ignStaticMapUrl,
    ignTerrainRgbUrl,
    ignWmtsUrl,
    IGN_LAYERS,
    IGN_WMS_R_PRIVATE,
    IGN_WMS_R_PUBLIC,
    IGN_WMTS_PRIVATE,
    IGN_WMTS_PUBLIC,
} from '@/lib/ign';

describe('ignWmtsUrl', () => {
    it('builds a public WMTS template with default style and tilematrixset', () => {
        const url = ignWmtsUrl({ layer: 'PLAN', format: 'image/png' });
        expect(url.startsWith(`${IGN_WMTS_PUBLIC}?`)).toBe(true);
        expect(url).toContain('SERVICE=WMTS');
        expect(url).toContain('REQUEST=GetTile');
        expect(url).toContain('STYLE=normal');
        expect(url).toContain('TILEMATRIXSET=PM');
        expect(url).toContain('LAYER=PLAN');
    });

    it('keeps the {z}/{x}/{y} placeholders unencoded', () => {
        const url = ignWmtsUrl({ layer: 'PLAN', format: 'image/png' });
        expect(url).toContain('TILEMATRIX={z}');
        expect(url).toContain('TILECOL={x}');
        expect(url).toContain('TILEROW={y}');
    });

    it('uses the private endpoint and includes the apikey first', () => {
        const url = ignWmtsUrl({ layer: 'SCAN', format: 'image/jpeg', private: true, apikey: 'my key' });
        expect(url.startsWith(`${IGN_WMTS_PRIVATE}?apikey=my%20key`)).toBe(true);
    });

    it('omits the apikey when not provided', () => {
        const url = ignWmtsUrl({ layer: 'PLAN', format: 'image/png' });
        expect(url).not.toContain('apikey=');
    });
});

describe('ignLayerUrl', () => {
    it('passes the apikey through for private layers', () => {
        const url = ignLayerUrl('scan25Tour', 'secret');
        expect(url.startsWith(`${IGN_WMTS_PRIVATE}?apikey=secret`)).toBe(true);
        expect(url).toContain(encodeURIComponent(IGN_LAYERS.scan25Tour.id));
    });

    it('never adds an apikey for public layers', () => {
        const url = ignLayerUrl('planIgn', 'secret');
        expect(url.startsWith(IGN_WMTS_PUBLIC)).toBe(true);
        expect(url).not.toContain('apikey=');
    });
});

describe('ignTerrainRgbUrl', () => {
    it('uses the public WMS-r endpoint with the nearest-neighbor layer when keyless', () => {
        const url = ignTerrainRgbUrl();
        expect(url.startsWith(`${IGN_WMS_R_PUBLIC}?`)).toBe(true);
        expect(url).toContain('layers=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES');
        expect(url).not.toContain('apikey=');
        expect(url).toContain('bbox={bbox-epsg-3857}');
    });

    it('uses the private endpoint and linear layer when a key is given', () => {
        const url = ignTerrainRgbUrl('k');
        expect(url.startsWith(`${IGN_WMS_R_PRIVATE}?apikey=k`)).toBe(true);
        expect(url).toContain(encodeURIComponent('ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.LINEAR'));
    });
});

describe('ignStaticMapUrl', () => {
    it('builds a WMS GetMap URL with a four-value bbox', () => {
        const url = ignStaticMapUrl({ centerLng: 6.87, centerLat: 45.92, radius: 500 });
        expect(url.startsWith(`${IGN_WMS_R_PUBLIC}?`)).toBe(true);
        expect(url).toContain('REQUEST=GetMap');
        expect(url).toContain('WIDTH=480');
        expect(url).toContain('HEIGHT=300');
        const bbox = /BBOX=([^&]+)/.exec(url)?.[1] ?? '';
        expect(bbox.split(',')).toHaveLength(4);
    });

    it('produces an ordered bbox (minX < maxX, minY < maxY)', () => {
        const url = ignStaticMapUrl({ centerLng: 6.87, centerLat: 45.92, radius: 500 });
        const bbox = /BBOX=([^&]+)/.exec(url)?.[1] ?? '';
        const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
        expect(minX).toBeLessThan(maxX);
        expect(minY).toBeLessThan(maxY);
    });
});
