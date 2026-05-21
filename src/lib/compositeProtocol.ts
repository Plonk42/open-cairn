/**
 * `composite://` MapLibre protocol — fetches a base raster tile and a LiDAR
 * shadow tile in parallel, blends them in a 2D canvas, and returns the
 * result to MapLibre as an ImageBitmap (no PNG re-encode).
 *
 * URL format:
 *   composite://<baseKey>/<shadowKind>/<blendMode>/<intensityPercent>/<detailScale>/{z}/{x}/{y}
 */

import maplibregl from 'maplibre-gl';
import { IGN_ATTRIBUTION, IGN_LAYERS, ignWmtsUrl, OSM_ATTRIBUTION, OSM_TILE_URL } from './ign';

let registered = false;

export type CompositeBaseKey = keyof typeof IGN_LAYERS | 'osm';

interface RasterLayerDef {
    minZoom: number;
    maxZoom: number;
    tileUrl: string;
    attribution: string;
}

/** Short URL token → IGN LiDAR HD shadow layer key. */
const SHADOW_KEYS = {
    mns: 'lidarMnsShadow',
    mnt: 'lidarMntShadow',
    mnh: 'lidarMnhShadow',
} as const satisfies Record<string, CompositeBaseKey>;

export type ShadowKind = keyof typeof SHADOW_KEYS;

/** Supported shadow blend modes. */
export const BLEND_MODES = [
    'lidar-neutral',
    'multiply',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
    'lidar-neutral': 'Relief LiDAR (recommandé)',
    'multiply': 'Multiplication (rapide)',
};

function rasterLayerDef(layerKey: CompositeBaseKey): RasterLayerDef {
    if (layerKey === 'osm') {
        return { minZoom: 0, maxZoom: 19, tileUrl: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
    }

    const def = IGN_LAYERS[layerKey];
    return {
        minZoom: def.minZoom,
        maxZoom: def.maxZoom,
        attribution: IGN_ATTRIBUTION,
        tileUrl: ignWmtsUrl({
            layer: def.id,
            format: def.format,
            private: def.private,
            apikey: 'apikey' in def ? def.apikey : undefined,
        }),
    };
}

function tileUrlFor(layerKey: CompositeBaseKey, z: number, x: number, y: number): string {
    const def = rasterLayerDef(layerKey);
    return def.tileUrl
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
}

function overzoomedTile(layerKey: CompositeBaseKey, z: number, x: number, y: number) {
    const def = rasterLayerDef(layerKey);
    const sourceZ = Math.max(def.minZoom, Math.min(def.maxZoom, z));
    const overscale = 2 ** (z - sourceZ);
    const sourceX = Math.floor(x / overscale);
    const sourceY = Math.floor(y / overscale);

    return {
        url: tileUrlFor(layerKey, sourceZ, sourceX, sourceY),
        overscale,
        offsetX: x - sourceX * overscale,
        offsetY: y - sourceY * overscale,
    };
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
    baseKey: CompositeBaseKey;
    shadow: ShadowKind;
    mode: BlendMode;
    intensity: number;
    detailScale: number;
    z: number;
    x: number;
    y: number;
    signal?: AbortSignal;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;
type TileRequest = ReturnType<typeof overzoomedTile>;

interface DetailedTileRequest extends TileRequest {
    dx: number;
    dy: number;
    scale: number;
}

interface BlendRenderArgs {
    ctx: Canvas2D;
    base: ImageBitmap;
    baseTile: TileRequest;
    shadow: ImageBitmap;
    shadowTile: TileRequest;
    width: number;
    height: number;
}

function createRenderCanvas(width: number, height: number): RenderCanvas {
    if (typeof OffscreenCanvas === 'undefined') {
        return Object.assign(document.createElement('canvas'), { width, height });
    }
    return new OffscreenCanvas(width, height);
}

function canvasContext(canvas: RenderCanvas): Canvas2D | null {
    return canvas.getContext('2d');
}

function drawOverzoomedTile(
    ctx: Canvas2D,
    img: ImageBitmap,
    tile: TileRequest,
    width: number,
    height: number,
): void {
    const sw = img.width / tile.overscale;
    const sh = img.height / tile.overscale;
    ctx.drawImage(img, tile.offsetX * sw, tile.offsetY * sh, sw, sh, 0, 0, width, height);
}

function detailedTiles(
    layerKey: CompositeBaseKey,
    z: number,
    x: number,
    y: number,
    detailScale: number,
): DetailedTileRequest[] {
    const def = rasterLayerDef(layerKey);
    const detailOffset = Math.max(0, Math.min(Math.log2(detailScale), def.maxZoom - z));
    const targetZ = z + detailOffset;
    const scale = 2 ** detailOffset;

    return Array.from({ length: scale * scale }, (_, index) => {
        const dx = index % scale;
        const dy = Math.floor(index / scale);
        return {
            ...overzoomedTile(layerKey, targetZ, x * scale + dx, y * scale + dy),
            dx,
            dy,
            scale,
        };
    });
}

function drawDetailedTiles(
    ctx: Canvas2D,
    tiles: Array<{ bitmap: ImageBitmap; tile: DetailedTileRequest }>,
    width: number,
    height: number,
): void {
    const scale = tiles[0]?.tile.scale ?? 1;
    const tileWidth = width / scale;
    const tileHeight = height / scale;

    for (const { bitmap, tile } of tiles) {
        const sw = bitmap.width / tile.overscale;
        const sh = bitmap.height / tile.overscale;
        ctx.drawImage(
            bitmap,
            tile.offsetX * sw,
            tile.offsetY * sh,
            sw,
            sh,
            tile.dx * tileWidth,
            tile.dy * tileHeight,
            tileWidth,
            tileHeight,
        );
    }
}

interface DetailedShadowLoadArgs {
    layerKey: CompositeBaseKey;
    z: number;
    x: number;
    y: number;
    detailScale: number;
    width: number;
    height: number;
    signal?: AbortSignal;
}

async function loadDetailedShadow(
    args: DetailedShadowLoadArgs,
): Promise<{ bitmap: ImageBitmap; tiles: Array<{ bitmap: ImageBitmap; tile: DetailedTileRequest }> } | null> {
    const { layerKey, z, x, y, detailScale, width, height, signal } = args;
    const tileRequests = detailedTiles(layerKey, z, x, y, detailScale);
    const tiles = await Promise.all(
        tileRequests.map(async (tile) => ({
            tile,
            bitmap: await fetchBitmap(tile.url, signal).catch(() => null),
        })),
    );
    const loadedTiles = tiles.filter(
        (tile): tile is { tile: DetailedTileRequest; bitmap: ImageBitmap } => Boolean(tile.bitmap),
    );
    if (loadedTiles.length === 0) return null;

    const shadowCanvas = createRenderCanvas(width, height);
    const shadowCtx = canvasContext(shadowCanvas);
    if (!shadowCtx) return null;

    drawDetailedTiles(shadowCtx, loadedTiles, width, height);
    return { bitmap: await createImageBitmap(shadowCanvas), tiles: loadedTiles };
}



function renderNeutralLidarRelief(args: BlendRenderArgs, intensity: number): boolean {
    const { ctx, base, baseTile, shadow, shadowTile, width, height } = args;
    drawOverzoomedTile(ctx, base, baseTile, width, height);

    const shadeCtx = canvasContext(createRenderCanvas(width, height));
    if (!shadeCtx) return false;
    drawOverzoomedTile(shadeCtx, shadow, shadowTile, width, height);

    const baseData = ctx.getImageData(0, 0, width, height);
    const shadeData = shadeCtx.getImageData(0, 0, width, height);
    const neutral = 180 / 255;
    const shadowGain = 1.35;
    const lightGain = 0.78;

    for (let i = 0; i < baseData.data.length; i += 4) {
        const shadeLum = (shadeData.data[i] + shadeData.data[i + 1] + shadeData.data[i + 2]) / (3 * 255);
        const delta = shadeLum - neutral;
        const rawFactor = delta < 0
            ? 1 + delta * shadowGain
            : 1 + delta * lightGain;
        const factor = 1 + intensity * (rawFactor - 1);

        for (let channel = 0; channel < 3; channel++) {
            baseData.data[i + channel] = Math.max(0, Math.min(255, baseData.data[i + channel] * factor));
        }
    }

    ctx.putImageData(baseData, 0, 0);
    return true;
}

function renderMultiply(args: BlendRenderArgs, intensity: number): void {
    const { ctx, base, baseTile, shadow, shadowTile, width, height } = args;
    drawOverzoomedTile(ctx, base, baseTile, width, height);
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'multiply';
    drawOverzoomedTile(ctx, shadow, shadowTile, width, height);
}

function renderCompositeShadow(
    renderArgs: BlendRenderArgs,
    mode: BlendMode,
    intensity: number,
): boolean {
    if (mode === 'lidar-neutral') return renderNeutralLidarRelief(renderArgs, intensity);
    renderMultiply(renderArgs, intensity);
    return true;
}

async function composite(args: CompositeArgs): Promise<ImageBitmap | null> {
    const { baseKey, shadow: shadowKind, mode, intensity, detailScale, z, x, y, signal } = args;
    const baseTile = overzoomedTile(baseKey, z, x, y);
    const shadowKey = SHADOW_KEYS[shadowKind];
    const shadowDef = IGN_LAYERS[shadowKey];
    const wantShadow = intensity > 0 && z >= shadowDef.minZoom;
    const shadowTiles = wantShadow ? detailedTiles(shadowKey, z, x, y, detailScale) : [];

    const [base, shadow] = await Promise.all([
        fetchBitmap(baseTile.url, signal),
        shadowTiles.length > 0
            ? loadDetailedShadow({
                layerKey: shadowKey,
                z,
                x,
                y,
                detailScale,
                width: 256 * Math.max(1, detailScale),
                height: 256 * Math.max(1, detailScale),
                signal,
            })
            : Promise.resolve(null),
    ]);
    if (!base) return null;

    const w = (base.width || 256) * Math.max(1, detailScale);
    const h = (base.height || 256) * Math.max(1, detailScale);
    const canvas = createRenderCanvas(w, h);
    const ctx = canvasContext(canvas);
    if (!ctx) {
        base.close?.();
        shadow?.bitmap.close?.();
        for (const tile of shadow?.tiles ?? []) tile.bitmap.close?.();
        return null;
    }

    if (shadow) {
        // loadDetailedShadow already handles overzooming internally —
        // the bitmap it returns covers exactly this tile's extent.
        // Use identity overzoom so render functions draw it at full extent.
        const shadowTile = { url: '', overscale: 1, offsetX: 0, offsetY: 0 };
        const renderArgs = { ctx, base, baseTile, shadow: shadow.bitmap, shadowTile, width: w, height: h };
        const rendered = renderCompositeShadow(renderArgs, mode, intensity);
        if (!rendered) return null;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        shadow.bitmap.close?.();
    } else {
        drawOverzoomedTile(ctx, base, baseTile, w, h);
    }
    base.close?.();
    for (const tile of shadow?.tiles ?? []) tile.bitmap.close?.();

    // Hand back an ImageBitmap directly — MapLibre v5 accepts it as-is and
    // skips the PNG decode/upload roundtrip (the main perf bottleneck).
    return await createImageBitmap(canvas);
}

// ---------------------------------------------------------------------------
// LRU cache for composite tile results
// ---------------------------------------------------------------------------
let tileCacheMax = 512;

class TileLruCache {
    private readonly map = new Map<string, ImageBitmap>();

    get(key: string): ImageBitmap | undefined {
        const bitmap = this.map.get(key);
        if (bitmap) {
            // Move to end (most recently used)
            this.map.delete(key);
            this.map.set(key, bitmap);
        }
        return bitmap;
    }

    set(key: string, bitmap: ImageBitmap): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else while (this.map.size >= tileCacheMax) {
            // Evict oldest entries
            const oldest = this.map.keys().next().value!;
            const evicted = this.map.get(oldest);
            this.map.delete(oldest);
            evicted?.close?.();
        }
        this.map.set(key, bitmap);
    }

    resize(newMax: number): void {
        while (this.map.size > newMax) {
            const oldest = this.map.keys().next().value!;
            const evicted = this.map.get(oldest);
            this.map.delete(oldest);
            evicted?.close?.();
        }
    }
}

const tileCache = new TileLruCache();

export function setTileCacheMaxSize(size: number): void {
    tileCacheMax = Math.max(0, Math.round(size));
    tileCache.resize(tileCacheMax);
}

/** Clear all cached composite tiles and notify the map to re-fetch. */
export function clearTileCache(): void {
    tileCache.resize(0);
    tileCache.resize(tileCacheMax);
    globalThis.dispatchEvent(new CustomEvent('composite-tile-reload'));
}

export function registerCompositeProtocol(): void {
    if (registered) return;
    registered = true;
    maplibregl.addProtocol('composite', async (req, abortController) => {
        const url = req.url.replace(/^composite:\/\//, '');

        // Check LRU cache first
        const cached = tileCache.get(url);
        if (cached) return { data: cached };

        const parts = url.split('/');
        if (parts.length < 7) throw new Error(`Bad composite URL: ${req.url}`);
        const baseKey = parts[0] as CompositeBaseKey;
        const shadow = parts[1] as ShadowKind;
        const mode = parts[2] as BlendMode;
        const intensity = Math.max(0, Math.min(1, Number(parts[3]) / 100));
        const hasDetailScale = parts.length >= 8;
        const detailScale = hasDetailScale ? Math.max(1, Math.min(2, Number(parts[4]) || 1)) : 1;
        const tileOffset = hasDetailScale ? 5 : 4;
        const bitmap = await composite({
            baseKey,
            shadow,
            mode,
            intensity,
            detailScale,
            z: Number(parts[tileOffset]),
            x: Number(parts[tileOffset + 1]),
            y: Number(parts[tileOffset + 2]),
            signal: abortController?.signal,
        });
        if (!bitmap) {
            throw new Error('composite: base tile unavailable');
        }
        tileCache.set(url, bitmap);
        return { data: bitmap };
    });
}

/** Build a MapLibre tile URL template that uses the composite:// protocol. */
export function compositeTileUrl(
    baseKey: CompositeBaseKey,
    shadow: ShadowKind,
    mode: BlendMode,
    intensity: number,
    detailScale = 1,
): string {
    const pct = Math.round(Math.max(0, Math.min(1, intensity)) * 100);
    const scale = Math.max(1, Math.min(2, Math.round(detailScale)));
    return `composite://${baseKey}/${shadow}/${mode}/${pct}/${scale}/{z}/{x}/{y}`;
}
