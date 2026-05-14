/**
 * `composite://` MapLibre protocol — fetches a base raster tile and a LiDAR
 * shadow tile in parallel, multiplies them in a 2D canvas, and returns the
 * resulting tile to MapLibre. The composited raster is then drapéd onto the
 * 3D terrain by MapLibre's normal raster pipeline (no custom layer needed),
 * which avoids the lag and z-fighting of a per-frame WebGL overlay.
 *
 * URL format:
 *   composite://<baseKey>/<intensityPercent>/{z}/{x}/{y}
 * e.g. composite://scan25Tour/85/12/2117/1469
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

async function fetchImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function composite(
  baseKey: LayerKey,
  intensity: number,
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer> {
  const baseUrl = tileUrlFor(baseKey, z, x, y);
  const shadowDef = IGN_LAYERS[SHADOW_KEY];
  const shadowAvailable = z >= shadowDef.minZoom && z <= shadowDef.maxZoom;
  const shadowUrl = shadowAvailable ? tileUrlFor(SHADOW_KEY, z, x, y) : null;

  const [base, shadow] = await Promise.all([
    fetchImage(baseUrl),
    shadowUrl
      ? fetchImage(shadowUrl).catch(() => null)
      : Promise.resolve(null),
  ]);

  const w = base.naturalWidth || 256;
  const h = base.naturalHeight || 256;
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('2D context unavailable');

  if (shadow && intensity > 0) {
    // Step 1: build the per-pixel shadow factor = mix(white, shadow, intensity)
    // Fill white, then draw the shadow at alpha=intensity over it.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = intensity;
    ctx.drawImage(shadow, 0, 0, w, h);
    ctx.globalAlpha = 1;
    // Step 2: multiply with the base layer.
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(base, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.drawImage(base, 0, 0, w, h);
  }

  // Encode as PNG.
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blob.arrayBuffer();
  }
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
  return await blob.arrayBuffer();
}

export function registerCompositeProtocol(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('composite', async (req) => {
    // req.url is "composite://<baseKey>/<intensity>/<z>/<x>/<y>"
    const url = req.url.replace(/^composite:\/\//, '');
    const parts = url.split('/');
    if (parts.length < 5) throw new Error(`Bad composite URL: ${req.url}`);
    const baseKey = parts[0] as LayerKey;
    const intensity = Math.max(0, Math.min(1, Number(parts[1]) / 100));
    const z = Number(parts[2]);
    const x = Number(parts[3]);
    const y = Number(parts[4]);
    const data = await composite(baseKey, intensity, z, x, y);
    return { data };
  });
}

/** Build a MapLibre tile URL template that uses the composite:// protocol. */
export function compositeTileUrl(baseKey: LayerKey, intensity: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, intensity)) * 100);
  return `composite://${baseKey}/${pct}/{z}/{x}/{y}`;
}
