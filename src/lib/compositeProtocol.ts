/**
 * `composite://` MapLibre protocol — fetches a base raster tile and a LiDAR
 * shadow tile in parallel, blends them in a 2D canvas, and returns the
 * result to MapLibre as an ImageBitmap (no PNG re-encode).
 *
 * URL format:
 *   composite://<baseKey>/<shadowKind>/<blendMode>/<intensityPercent>/{z}/{x}/{y}
 */

import maplibregl from 'maplibre-gl';
import { IGN_LAYERS, ignWmtsUrl } from './ign';

let registered = false;

type LayerKey = keyof typeof IGN_LAYERS;

/** Short URL token → IGN LiDAR HD shadow layer key. */
const SHADOW_KEYS = {
    mns: 'lidarMnsShadow',
    mnt: 'lidarMntShadow',
    mnh: 'lidarMnhShadow',
} as const satisfies Record<string, LayerKey>;

export type ShadowKind = keyof typeof SHADOW_KEYS;

/** Supported shadow blend modes. Each maps directly to a Canvas2D
 *  globalCompositeOperation, except `multiply-classic` which uses a
 *  white→shadow lerp before multiplying (preserves base tonality but
 *  always darkens). */
export const BLEND_MODES = [
    'soft-light',
    'overlay',
    'hard-light',
    'multiply',
    'multiply-classic',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
    'soft-light': 'Soft light (recommandé)',
    'overlay': 'Overlay',
    'hard-light': 'Hard light',
    'multiply': 'Multiply',
    'multiply-classic': 'Multiply ×W (legacy)',
};

function tileUrlFor(layerKey: LayerKey, z: number, x: number, y: number): string {
    const def = IGN_LAYERS[layerKey];
    return ignWmtsUrl({
        layer: def.id,
        format: def.format,
        private: def.private,
        apikey: 'apikey' in def ? def.apikey : undefined,
    })
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
}

/** Fetch a tile as an ImageBitmap. Returns null on http error or decode
 *  failure. AbortError propagates so MapLibre's cancellation bubbles up. */
async function fetchBitmap(
    url: string,
    signal?: AbortSignal,
): Promise<ImageBitmap | null> {
    const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    try {
        return await createImageBitmap(blob);
    } catch {
        return null;
    }
}

interface CompositeArgs {
    baseKey: LayerKey;
    shadow: ShadowKind;
    mode: BlendMode;
    intensity: number;
    z: number;
    x: number;
    y: number;
    signal?: AbortSignal;
}

async function composite(args: CompositeArgs): Promise<ImageBitmap | null> {
    const { baseKey, shadow: shadowKind, mode, intensity, z, x, y, signal } = args;
    const baseUrl = tileUrlFor(baseKey, z, x, y);
    const shadowKey = SHADOW_KEYS[shadowKind];
    const shadowDef = IGN_LAYERS[shadowKey];
    const wantShadow =
        intensity > 0 && z >= shadowDef.minZoom && z <= shadowDef.maxZoom;
    const shadowUrl = wantShadow ? tileUrlFor(shadowKey, z, x, y) : null;

    const [base, shadow] = await Promise.all([
        fetchBitmap(baseUrl, signal),
        shadowUrl
            ? fetchBitmap(shadowUrl, signal).catch(() => null)
            : Promise.resolve(null),
    ]);
    if (!base) return null;

    const w = base.width || 256;
    const h = base.height || 256;
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
    if (!ctx) {
        base.close?.();
        shadow?.close?.();
        return null;
    }

    if (shadow) {
        if (mode === 'multiply-classic') {
            // mix(white, shadow, intensity) → multiply against base.
            // Always darkens but preserves base tonality at intensity<1.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = intensity;
            ctx.drawImage(shadow, 0, 0, w, h);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(base, 0, 0, w, h);
        } else {
            // Paint base, then blend shadow on top with the chosen op at the
            // requested intensity. soft-light / overlay / hard-light all leave
            // neutral 50% gray untouched, so flat-but-textured shadow tiles
            // don't darken white roads or paper into gray the way straight
            // multiply does.
            ctx.drawImage(base, 0, 0, w, h);
            ctx.globalAlpha = intensity;
            ctx.globalCompositeOperation = mode;
            ctx.drawImage(shadow, 0, 0, w, h);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    } else {
        ctx.drawImage(base, 0, 0, w, h);
    }
    base.close?.();
    shadow?.close?.();

    // Hand back an ImageBitmap directly — MapLibre v5 accepts it as-is and
    // skips the PNG decode/upload roundtrip (the main perf bottleneck).
    return await createImageBitmap(canvas);
}

export function registerCompositeProtocol(): void {
    if (registered) return;
    registered = true;
    maplibregl.addProtocol('composite', async (req, abortController) => {
        const url = req.url.replace(/^composite:\/\//, '');
        const parts = url.split('/');
        if (parts.length < 7) throw new Error(`Bad composite URL: ${req.url}`);
        const baseKey = parts[0] as LayerKey;
        const shadow = parts[1] as ShadowKind;
        const mode = parts[2] as BlendMode;
        const intensity = Math.max(0, Math.min(1, Number(parts[3]) / 100));
        const bitmap = await composite({
            baseKey,
            shadow,
            mode,
            intensity,
            z: Number(parts[4]),
            x: Number(parts[5]),
            y: Number(parts[6]),
            signal: abortController?.signal,
        });
        if (!bitmap) {
            // Throw → MapLibre marks the tile errored and keeps the parent
            // (overzoomed) tile on screen. Returning a transparent bitmap
            // here would override the terrain texture and reveal the
            // background colour through the mesh, leaving holes in the
            // foreground when the camera is pitched.
            throw new Error('composite: base tile unavailable');
        }
        return { data: bitmap };
    });
}

/** Build a MapLibre tile URL template that uses the composite:// protocol. */
export function compositeTileUrl(
    baseKey: LayerKey,
    shadow: ShadowKind,
    mode: BlendMode,
    intensity: number,
): string {
    const pct = Math.round(Math.max(0, Math.min(1, intensity)) * 100);
    return `composite://${baseKey}/${shadow}/${mode}/${pct}/{z}/{x}/{y}`;
}
