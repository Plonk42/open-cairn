import type { BlendMode } from './compositeProtocol';

/** A source tile to fetch, and which quadrant of it covers the requested tile. */
export interface TileRequest {
    url: string;
    overscale: number;
    offsetX: number;
    offsetY: number;
}

/** One shadow tile of a detail-scaled mosaic, placed at (`dx`, `dy`) in a `scale`×`scale` grid. */
export interface DetailedTileRequest extends TileRequest {
    dx: number;
    dy: number;
    scale: number;
}

export interface CompositeJob {
    type: 'job';
    id: number;
    base: TileRequest;
    /** Empty when the shadow is off or out of its zoom range. */
    shadowTiles: DetailedTileRequest[];
    mode: BlendMode;
    intensity: number;
    detailScale: number;
}

export interface CompositeCancel {
    type: 'cancel';
    id: number;
}

export type CompositeRequest = CompositeJob | CompositeCancel;

export type CompositeReply =
    | { id: number; type: 'ok'; bitmap: ImageBitmap | null }
    | { id: number; type: 'err'; error: string; aborted: boolean; timedOut: boolean };
