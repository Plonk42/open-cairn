/**
 * Blends `composite://` tiles off the main thread. The LiDAR relief pass reads
 * both canvases back and walks every pixel: 650 ms of main-thread time over one
 * panorama turn, stalling MapLibre's own tile processing behind it.
 */

import type { BlendMode } from './compositeProtocol';
import type { CompositeJob, CompositeReply, CompositeRequest, DetailedTileRequest, TileRequest } from './compositeWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

/**
 * Some IGN requests stall for good: the tile then stays `loading`, and MapLibre never
 * reaches `idle`, which `settleOnGround` waits for. Measured on 120 cold tiles: median
 * 0.8 s, 3 past 10 s, 2 still pending after 40 s — so one retry, then give up.
 */
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_ATTEMPTS = 2;

async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null> {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
                mode: 'cors',
                credentials: 'omit',
            });
            return res.ok ? await res.blob() : null;
        } catch (err) {
            const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
            if (!timedOut || signal.aborted || attempt >= FETCH_ATTEMPTS) throw err;
        }
    }
}

/** Fetch a tile as an ImageBitmap; null on http error or decode failure, AbortError propagates. */
async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
    const blob = await fetchBlob(url, signal);
    if (!blob) return null;
    try {
        return await createImageBitmap(blob);
    } catch {
        return null;
    }
}

/** `willReadFrequently` keeps the canvas on the CPU, where `getImageData` is a copy rather than a GPU readback. */
function context(canvas: OffscreenCanvas, readBack: boolean): OffscreenCanvasRenderingContext2D | null {
    return canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined);
}

function drawOverzoomedTile(
    ctx: OffscreenCanvasRenderingContext2D,
    img: ImageBitmap,
    tile: TileRequest,
    width: number,
    height: number,
): void {
    const sw = img.width / tile.overscale;
    const sh = img.height / tile.overscale;
    ctx.drawImage(img, tile.offsetX * sw, tile.offsetY * sh, sw, sh, 0, 0, width, height);
}

function drawDetailedTiles(
    ctx: OffscreenCanvasRenderingContext2D,
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

interface DetailedShadow {
    ctx: OffscreenCanvasRenderingContext2D | null;
    /** A tile of the mosaic timed out: the relief is missing where it should be, not absent. */
    timedOut: boolean;
}

/** The shadow mosaic, already cropped to the requested tile's extent. */
async function loadDetailedShadow(
    tileRequests: DetailedTileRequest[],
    size: number,
    signal: AbortSignal,
): Promise<DetailedShadow> {
    let timedOut = false;
    const tiles = await Promise.all(
        tileRequests.map(async (tile) => ({
            tile,
            bitmap: await fetchBitmap(tile.url, signal).catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'TimeoutError') timedOut = true;
                return null;
            }),
        })),
    );
    const loadedTiles = tiles.filter(
        (tile): tile is { tile: DetailedTileRequest; bitmap: ImageBitmap } => Boolean(tile.bitmap),
    );
    if (loadedTiles.length === 0) return { ctx: null, timedOut };

    const shadowCtx = context(new OffscreenCanvas(size, size), true);
    if (shadowCtx) drawDetailedTiles(shadowCtx, loadedTiles, size, size);
    for (const { bitmap } of loadedTiles) bitmap.close();
    return { ctx: shadowCtx, timedOut };
}

interface BlendArgs {
    ctx: OffscreenCanvasRenderingContext2D;
    base: ImageBitmap;
    baseTile: TileRequest;
    shadow: OffscreenCanvasRenderingContext2D;
    width: number;
    height: number;
}

/** The shadow read back at the base's size, which the 256 px mosaic only matches for 256 px base tiles. */
function shadowPixels(shadow: OffscreenCanvasRenderingContext2D, width: number, height: number): ImageData | null {
    if (shadow.canvas.width === width && shadow.canvas.height === height) return shadow.getImageData(0, 0, width, height);
    const resized = context(new OffscreenCanvas(width, height), true);
    resized?.drawImage(shadow.canvas, 0, 0, width, height);
    return resized?.getImageData(0, 0, width, height) ?? null;
}

function renderNeutralLidarRelief(args: BlendArgs, intensity: number): void {
    const { ctx, base, baseTile, shadow, width, height } = args;
    drawOverzoomedTile(ctx, base, baseTile, width, height);

    const shadeData = shadowPixels(shadow, width, height);
    if (!shadeData) return;
    const baseData = ctx.getImageData(0, 0, width, height);
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
}

function renderMultiply(args: BlendArgs, intensity: number): void {
    const { ctx, base, baseTile, shadow, width, height } = args;
    drawOverzoomedTile(ctx, base, baseTile, width, height);
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(shadow.canvas, 0, 0, width, height);
}

function renderCompositeShadow(args: BlendArgs, mode: BlendMode, intensity: number): void {
    if (mode === 'lidar-neutral') renderNeutralLidarRelief(args, intensity);
    else renderMultiply(args, intensity);
}

interface CompositeResult {
    bitmap: ImageBitmap | null;
    shadowTimedOut: boolean;
}

const NO_SHADOW: DetailedShadow = { ctx: null, timedOut: false };

async function composite(job: CompositeJob, signal: AbortSignal): Promise<CompositeResult> {
    const { base: baseTile, shadowTiles, mode, intensity, detailScale } = job;
    const scale = Math.max(1, detailScale);
    const [base, { ctx: shadow, timedOut: shadowTimedOut }] = await Promise.all([
        fetchBitmap(baseTile.url, signal),
        shadowTiles.length > 0 ? loadDetailedShadow(shadowTiles, 256 * scale, signal) : Promise.resolve(NO_SHADOW),
    ]);
    if (!base) return { bitmap: null, shadowTimedOut };

    const w = (base.width || 256) * scale;
    const h = (base.height || 256) * scale;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = context(canvas, shadow !== null && mode === 'lidar-neutral');
    if (!ctx) {
        base.close();
        return { bitmap: null, shadowTimedOut };
    }

    if (shadow) renderCompositeShadow({ ctx, base, baseTile, shadow, width: w, height: h }, mode, intensity);
    else drawOverzoomedTile(ctx, base, baseTile, w, h);
    base.close();
    return { bitmap: canvas.transferToImageBitmap(), shadowTimedOut };
}

const running = new Map<number, AbortController>();

function reply(message: CompositeReply, transfer: Transferable[] = []): void {
    self.postMessage(message, transfer);
}

self.onmessage = (ev: MessageEvent<CompositeRequest>) => {
    const msg = ev.data;
    if (msg.type === 'cancel') {
        running.get(msg.id)?.abort();
        return;
    }
    const controller = new AbortController();
    running.set(msg.id, controller);
    composite(msg, controller.signal)
        .then(({ bitmap, shadowTimedOut }) => reply(
            { id: msg.id, type: 'ok', bitmap, shadowTimedOut },
            bitmap ? [bitmap] : [],
        ))
        .catch((err: unknown) => reply({
            id: msg.id,
            type: 'err',
            error: err instanceof Error ? err.message : 'composite failed',
            aborted: controller.signal.aborted,
            timedOut: err instanceof DOMException && err.name === 'TimeoutError',
        }))
        .finally(() => running.delete(msg.id));
};
