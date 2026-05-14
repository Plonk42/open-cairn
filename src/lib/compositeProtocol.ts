/**
 * `composite://` MapLibre protocol — fetches a base raster tile and a LiDAR
 * shadow tile in parallel, multiplies them in a 2D canvas, and returns the
 * result to MapLibre as an ImageBitmap (no PNG re-encode).
 *
 * URL format:
 *   composite://<baseKey>/<intensityPercent>/{z}/{x}/{y}
 */

import maplibregl from 'maplibre-gl';
import { IGN_LAYERS, ignWmtsUrl } from './ign';

let registered = false;

type LayerKey = keyof typeof IGN_LAYERS;

const SHADOW_KEY: LayerKey = 'lidarMnsShadow';

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

/** Fetch a tile as an ImageBitmap. Returns null on any failure (network,
 *  decode, abort, …) so the caller can degrade gracefully. */
async function fetchBitmap(
  url: string,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

interface CompositeArgs {
  baseKey: LayerKey;
  intensity: number;
  z: number;
  x: number;
  y: number;
  signal?: AbortSignal;
}

async function composite(args: CompositeArgs): Promise<ImageBitmap | null> {
  const { baseKey, intensity, z, x, y, signal } = args;
  const baseUrl = tileUrlFor(baseKey, z, x, y);
  const shadowDef = IGN_LAYERS[SHADOW_KEY];
  const wantShadow =
    intensity > 0 && z >= shadowDef.minZoom && z <= shadowDef.maxZoom;
  const shadowUrl = wantShadow ? tileUrlFor(SHADOW_KEY, z, x, y) : null;

  const [base, shadow] = await Promise.all([
    fetchBitmap(baseUrl, signal),
    shadowUrl ? fetchBitmap(shadowUrl, signal) : Promise.resolve(null),
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
    // mix(white, shadow, intensity) → multiply against base.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = intensity;
    ctx.drawImage(shadow, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(base, 0, 0, w, h);
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
    if (parts.length < 5) throw new Error(`Bad composite URL: ${req.url}`);
    const baseKey = parts[0] as LayerKey;
    const intensity = Math.max(0, Math.min(1, Number(parts[1]) / 100));
    const bitmap = await composite({
      baseKey,
      intensity,
      z: Number(parts[2]),
      x: Number(parts[3]),
      y: Number(parts[4]),
      signal: abortController?.signal,
    });
    if (!bitmap) {
      // 1×1 transparent bitmap → MapLibre keeps showing the previous
      // overzoomed tile instead of dropping a black square through to
      // the background.
      const blank = new OffscreenCanvas(1, 1);
      blank.getContext('2d')?.clearRect(0, 0, 1, 1);
      return { data: await createImageBitmap(blank) };
    }
    return { data: bitmap };
  });
}

/** Build a MapLibre tile URL template that uses the composite:// protocol. */
export function compositeTileUrl(baseKey: LayerKey, intensity: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, intensity)) * 100);
  return `composite://${baseKey}/${pct}/{z}/{x}/{y}`;
}
