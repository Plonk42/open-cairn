/**
 * Showcase scene (.bin) format — "Open Cairn ShowCase Scene".
 *
 * The reconstructed geometry of a rendered LiDAR view: the point cloud and/or
 * ground mesh. The editable presentation (title, description, camera, ambiance)
 * lives in a separate sidecar `<id>.json` manifest so it can be tweaked without
 * regenerating the binary. Loading a scene bypasses the WFS/COPC download +
 * PoissonRecon pipeline entirely and re-displays the baked geometry instantly.
 *
 * Geometry buffers are compressed with meshoptimizer (encoder/decoder loaded
 * lazily so neither ends up in the main bundle). The container is a small
 * little-endian binary:
 *
 *   magic      : 4 bytes  = "OCSS"
 *   version    : u16
 *   settingsLen: u32
 *   settings   : UTF-8 JSON (per-geometry metadata needed to decode buffers)
 *   bufferCount: u8
 *   buffers[]  : { tag u8, encoding u8, count u32, stride u32,
 *                  originalByteLength u32, compressedByteLength u32, bytes }
 *
 * Forward compatibility: unknown buffer tags are skipped and higher container
 * versions are accepted with a console warning rather than rejected.
 */

import type { CaptureParams } from './captureParams';
import type { ForestEdgeBlend, ForestGrouping } from './lidarBrowser/bdforet';
import type { ShaderPreset } from './lidarBrowser/slope';
import type { LidarMeshData, LidarShadedCloudData, VegColorMode } from './lidarCloud';
import type { DrapeSource } from './mapStyle';

const MAGIC = 0x4f435353; // "OCSS"
const VERSION = 1;

const ENC_VERTEX = 0;
const ENC_INDEX = 1;

/**
 * Tag-space reserved per cloud so a scene can bundle several clouds/meshes
 * without changing the per-buffer header layout: the primary cloud keeps the
 * original tags 0-12 (byte-identical to every scene ever exported), and each
 * extra cloud's buffers reuse the same tags shifted by `index * STRIDE`. Since
 * the highest tag value is 12, a stride of 16 leaves room for up to
 * `MAX_CLOUDS` clouds while the tag still fits in a single byte.
 */
const CLOUD_TAG_STRIDE = 16;
const MAX_CLOUDS = Math.floor(255 / CLOUD_TAG_STRIDE) + 1;

const TAG = {
    shadedPositions: 0,
    shadedNormals: 1,
    shadedColors: 2,
    shadedClass: 3,
    meshPositions: 4,
    meshNormals: 5,
    meshColors: 6,
    meshIndices: 7,
    meshMacroNormals: 8,
    shadedForestTfv: 9,
    shadedTreeSeed: 10,
    shadedHeight: 11,
    meshBaseMask: 12,
} as const;

export interface ShowcaseCamera {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
    /**
     * Center-point elevation (metres) at export time. Restored before the
     * gallery flyTo so the camera lands correctly framed over 3D terrain.
     * Optional for backward compatibility with scenes saved before this field.
     */
    centerElevation?: number;
}

export interface ShowcaseAmbiance {
    lidarMode: 'shaded' | 'delaunay' | 'poisson';
    lidarShader: ShaderPreset;
    lidarSunDate: string;
    lidarSunEnabled: boolean;
    lidarShadows: boolean;
    lidarShadowStrength: number;
    lidarVegEnhance: boolean;
    lidarVegColorMode: VegColorMode;
    lidarVegHeightScale: number;
    lidarVegIntensity: number;
    lidarVegNormalShade: number;
    lidarVegSizeBoost: number;
    /** Réglages de hauteur de végétation : cuits à la capture, mais rejoués à chaud par `recomputeVegHeights`. */
    lidarVegGroundGap: number;
    lidarVegGroundRough: number;
    lidarForestGrouping: ForestGrouping;
    lidarForestMixCellSize: number;
    lidarForestEdgeBlend: ForestEdgeBlend;
    lidarForestEdgeBandM: number;
    lidarForestTreetopSensitivity: number;
    lidarForestHiddenLegend: number[];
    lidarForestSpeciesFilterOn: boolean;
    lidarCloudEdl: boolean;
    lidarCloudEdlStrength: number;
    lidarCloudEdlRadius: number;
    lidarCloudEdlFarPlane: number;
    lidarCloudPointSize: number;
    lidarCloudSizeCompensation: boolean;
    lidarCloudOpacity: number;
    lidarCloudPhotoOpacity: number;
    lidarCloudPhotoOpacityNonGround: number;
    lidarCloudPhotoSource: DrapeSource;
    lidarCloudBasemapOpacity: number;
    lidarCloudClasses: number[];
    contourLinesEnabled: boolean;
    contourLinesOpacity: number;
}

export interface ShowcaseScene {
    /** Stable scene id (the shared `<id>.bin` / `<id>.json` / `<id>.webp` stem). */
    id: string;
    title: string;
    description?: string;
    camera: ShowcaseCamera;
    ambiance: ShowcaseAmbiance;
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    /**
     * Additional clouds/meshes bundled alongside the primary one, when the
     * view being exported had several LiDAR clouds displayed at once (see
     * `lidarClouds` in the map store). Restoring a scene re-adds every entry
     * here (plus the primary) via `addLidarCloudSnapshot`, so "Exporter cette
     * vue" round-trips the whole scene in one shot. Omitted (or empty) for
     * single-cloud scenes, which stay byte-identical to the original format.
     */
    extraClouds?: Array<{ shaded: LidarShadedCloudData | null; mesh: LidarMeshData | null }>;
    /**
     * Réglages de génération de chaque nuage, primaire en premier puis les
     * `extraClouds` dans l'ordre (voir `captureParams.ts`). `null` pour un
     * nuage dont les réglages sont inconnus — une scène exportée avant l'ajout
     * de ce champ n'en a aucun, et se recharge sans rien perdre.
     */
    captureParams?: Array<CaptureParams | null>;
}

/**
 * Editable presentation settings for a scene — the part that lives in the
 * sidecar `<id>.json` manifest so it can be tweaked without touching the binary
 * geometry. This is `ShowcaseScene` minus the id and geometry buffers.
 */
export interface ShowcaseManifest {
    title: string;
    description?: string;
    camera: ShowcaseCamera;
    ambiance: ShowcaseAmbiance;
    /** Voir `ShowcaseScene.captureParams`. */
    captureParams?: Array<CaptureParams | null>;
}

/** Schema version of the sidecar manifest JSON. */
export const MANIFEST_VERSION = 1;

export const DEFAULT_AMBIANCE: ShowcaseAmbiance = {
    lidarMode: 'shaded',
    lidarShader: 'base',
    lidarSunDate: '',
    lidarSunEnabled: false,
    lidarShadows: false,
    lidarShadowStrength: 0.5,
    lidarVegEnhance: true,
    lidarVegColorMode: 'natural',
    lidarVegHeightScale: 25,
    lidarVegIntensity: 0.85,
    lidarVegNormalShade: 1,
    lidarVegSizeBoost: 1.3,
    lidarVegGroundGap: 3,
    lidarVegGroundRough: 12,
    lidarForestGrouping: 'group',
    lidarForestMixCellSize: 6,
    lidarForestEdgeBlend: 'scatter',
    lidarForestEdgeBandM: 8,
    lidarForestTreetopSensitivity: 0.5,
    lidarForestHiddenLegend: [],
    lidarForestSpeciesFilterOn: false,
    lidarCloudEdl: true,
    lidarCloudEdlStrength: 1000,
    lidarCloudEdlRadius: 1.4,
    lidarCloudEdlFarPlane: 250,
    lidarCloudPointSize: 2,
    lidarCloudSizeCompensation: true,
    lidarCloudOpacity: 1,
    lidarCloudPhotoOpacity: 0,
    lidarCloudPhotoOpacityNonGround: 0,
    lidarCloudPhotoSource: 'ortho',
    lidarCloudBasemapOpacity: 1,
    lidarCloudClasses: [],
    contourLinesEnabled: false,
    contourLinesOpacity: 0.4,
};

interface ShadedMeta {
    centerLng: number;
    centerLat: number;
    radius: number;
    pointCount: number;
    /** Whether the binary carries the BD Forêt® category buffer (tag 9). */
    hasForestTfv?: boolean;
    /** Whether the binary carries the per-tree seed buffer (tag 10). */
    hasTreeSeed?: boolean;
    /**
     * Whether the binary carries the per-point height-above-ground buffer
     * (tag 11). Always baked at export; when absent the heights stay undefined.
     */
    hasHeight?: boolean;
    /**
     * Robust tallest-tree height (m) driving the auto foliage scale, baked at
     * export so it need not be recomputed. Only meaningful when `hasHeight`.
     */
    vegHeightAuto?: number;
}

interface MeshMeta {
    centerLng: number;
    centerLat: number;
    radius: number;
    vertexCount: number;
    triangleCount: number;
    hasMacroNormals: boolean;
    /** Whether the binary carries the per-vertex base-wall mask (tag 12). */
    hasBaseMask: boolean;
}

/** The geometry-only slice of a scene needed to encode/decode its buffers. */
type SceneGeometryInput = Pick<ShowcaseScene, 'shaded' | 'mesh' | 'extraClouds'>;

/**
 * Geometry metadata embedded in the binary settings header — only what's needed
 * to rebuild the typed arrays. Presentation settings (name, camera, ambiance)
 * live in the sidecar manifest, NOT here.
 */
interface GeometryBlob {
    shaded: ShadedMeta | null;
    mesh: MeshMeta | null;
    /** Metadata for extra clouds, in the same order as `ShowcaseScene.extraClouds`. */
    extraClouds?: Array<{ shaded: ShadedMeta | null; mesh: MeshMeta | null }>;
}

interface BufferDescriptor {
    tag: number;
    encoding: number;
    /** Logical element count handed to meshopt. */
    count: number;
    /** Bytes per element. */
    stride: number;
    /** Length (bytes) of the original, possibly-padded, decoded buffer. */
    byteLength: number;
    /** Raw source bytes to compress (length === byteLength). */
    bytes: Uint8Array;
}

type Encoder = typeof import('meshoptimizer/encoder').MeshoptEncoder;
type Decoder = typeof import('meshoptimizer/decoder').MeshoptDecoder;

async function getEncoder(): Promise<Encoder> {
    const { MeshoptEncoder } = await import('meshoptimizer/encoder');
    await MeshoptEncoder.ready;
    return MeshoptEncoder;
}

async function getDecoder(): Promise<Decoder> {
    const { MeshoptDecoder } = await import('meshoptimizer/decoder');
    await MeshoptDecoder.ready;
    return MeshoptDecoder;
}

function asBytes(view: ArrayBufferView): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Pad a byte array up to a multiple of `align` (meshopt vertex stride rule). */
function padBytes(src: Uint8Array, align: number): Uint8Array {
    const remainder = src.length % align;
    if (remainder === 0) return src;
    const padded = new Uint8Array(src.length + (align - remainder));
    padded.set(src);
    return padded;
}

function vertexDescriptor(tag: number, view: ArrayBufferView, stride: number): BufferDescriptor {
    const bytes = stride % 4 === 0 ? asBytes(view) : padBytes(asBytes(view), 4);
    const effectiveStride = stride % 4 === 0 ? stride : 4;
    return {
        tag,
        encoding: ENC_VERTEX,
        count: bytes.length / effectiveStride,
        stride: effectiveStride,
        byteLength: bytes.length,
        bytes,
    };
}

function indexDescriptor(tag: number, indices: Uint32Array): BufferDescriptor {
    const bytes = asBytes(indices);
    return {
        tag,
        encoding: ENC_INDEX,
        count: indices.length,
        stride: 4,
        byteLength: bytes.length,
        bytes,
    };
}

function collectCloudDescriptors(cloud: Pick<ShowcaseScene, 'shaded' | 'mesh'>, tagOffset: number): BufferDescriptor[] {
    const descriptors: BufferDescriptor[] = [];
    const { shaded, mesh } = cloud;
    if (shaded) {
        descriptors.push(
            vertexDescriptor(tagOffset + TAG.shadedPositions, shaded.positions, 12),
            vertexDescriptor(tagOffset + TAG.shadedNormals, shaded.normals, 12),
            vertexDescriptor(tagOffset + TAG.shadedColors, shaded.colors, 4),
            vertexDescriptor(tagOffset + TAG.shadedClass, shaded.classifications, 1),
        );
        if (shaded.forestTfv) {
            descriptors.push(vertexDescriptor(tagOffset + TAG.shadedForestTfv, shaded.forestTfv, 1));
        }
        if (shaded.treeSeed) {
            descriptors.push(vertexDescriptor(tagOffset + TAG.shadedTreeSeed, shaded.treeSeed, 1));
        }
        if (shaded.heightAboveGround) {
            descriptors.push(vertexDescriptor(tagOffset + TAG.shadedHeight, shaded.heightAboveGround, 4));
        }
    }
    if (mesh) {
        descriptors.push(
            vertexDescriptor(tagOffset + TAG.meshPositions, mesh.positions, 12),
            vertexDescriptor(tagOffset + TAG.meshNormals, mesh.normals, 12),
            vertexDescriptor(tagOffset + TAG.meshColors, mesh.colors, 4),
            indexDescriptor(tagOffset + TAG.meshIndices, mesh.indices),
        );
        if (mesh.macroNormals) {
            descriptors.push(vertexDescriptor(tagOffset + TAG.meshMacroNormals, mesh.macroNormals, 3));
        }
        if (mesh.baseMask) {
            descriptors.push(vertexDescriptor(tagOffset + TAG.meshBaseMask, mesh.baseMask, 1));
        }
    }
    return descriptors;
}

function collectDescriptors(scene: SceneGeometryInput): BufferDescriptor[] {
    const descriptors = collectCloudDescriptors({ shaded: scene.shaded, mesh: scene.mesh }, 0);
    (scene.extraClouds ?? []).forEach((cloud, i) => {
        const cloudIndex = i + 1;
        if (cloudIndex >= MAX_CLOUDS) {
            console.warn(`showcase scene: dropping extra cloud #${cloudIndex} — a scene supports at most ${MAX_CLOUDS - 1} extra clouds`);
            return;
        }
        descriptors.push(...collectCloudDescriptors(cloud, cloudIndex * CLOUD_TAG_STRIDE));
    });
    return descriptors;
}

function buildCloudMeta(cloud: Pick<ShowcaseScene, 'shaded' | 'mesh'>): { shaded: ShadedMeta | null; mesh: MeshMeta | null } {
    const { shaded, mesh } = cloud;
    return {
        shaded: shaded
            ? {
                centerLng: shaded.centerLng,
                centerLat: shaded.centerLat,
                radius: shaded.radius,
                pointCount: shaded.pointCount,
                hasForestTfv: Boolean(shaded.forestTfv),
                hasTreeSeed: Boolean(shaded.treeSeed),
                hasHeight: Boolean(shaded.heightAboveGround),
                vegHeightAuto: shaded.vegHeightAuto,
            }
            : null,
        mesh: mesh
            ? {
                centerLng: mesh.centerLng,
                centerLat: mesh.centerLat,
                radius: mesh.radius,
                vertexCount: mesh.vertexCount,
                triangleCount: mesh.triangleCount,
                hasMacroNormals: Boolean(mesh.macroNormals),
                hasBaseMask: Boolean(mesh.baseMask),
            }
            : null,
    };
}

function buildGeometryBlob(scene: SceneGeometryInput): GeometryBlob {
    const primary = buildCloudMeta({ shaded: scene.shaded, mesh: scene.mesh });
    const extraClouds = (scene.extraClouds ?? [])
        .slice(0, MAX_CLOUDS - 1)
        .map((cloud) => buildCloudMeta(cloud));
    return { ...primary, extraClouds: extraClouds.length > 0 ? extraClouds : undefined };
}

/** Extract the editable presentation settings (title + description + camera + ambiance). */
export function buildShowcaseManifest(scene: ShowcaseScene): ShowcaseManifest {
    return {
        title: scene.title,
        description: scene.description,
        camera: scene.camera,
        ambiance: scene.ambiance,
        captureParams: scene.captureParams,
    };
}

/** Serialize the editable settings to a pretty-printed sidecar manifest JSON. */
export function serializeShowcaseManifest(scene: ShowcaseScene): string {
    return JSON.stringify({ version: MANIFEST_VERSION, ...buildShowcaseManifest(scene) }, null, 2);
}

/** Parse a sidecar manifest JSON, filling missing ambiance fields with defaults. */
export function parseShowcaseManifest(json: string): ShowcaseManifest {
    const raw = JSON.parse(json) as Partial<ShowcaseManifest> & { version?: number };
    if (!raw.camera) throw new Error('showcase manifest: missing camera');
    return {
        title: raw.title ?? '',
        description: raw.description,
        camera: raw.camera,
        ambiance: { ...DEFAULT_AMBIANCE, ...raw.ambiance },
        captureParams: raw.captureParams,
    };
}

/**
 * Serialize a showcase scene's geometry to a compressed binary blob. Only the
 * mesh/point buffers and the metadata needed to decode them are written — the
 * editable camera/ambiance/name go in the sidecar manifest (see
 * {@link serializeShowcaseManifest}).
 */
export async function encodeShowcaseGeometry(scene: SceneGeometryInput): Promise<Uint8Array> {
    const encoder = await getEncoder();
    const descriptors = collectDescriptors(scene);

    const compressed = descriptors.map((d) =>
        d.encoding === ENC_INDEX
            ? encoder.encodeIndexSequence(d.bytes, d.count, d.stride)
            : encoder.encodeVertexBuffer(d.bytes, d.count, d.stride),
    );

    const settingsJson = new TextEncoder().encode(JSON.stringify(buildGeometryBlob(scene)));

    let total = 4 + 2 + 4 + settingsJson.length + 1;
    for (const c of compressed) total += 1 + 1 + 4 + 4 + 4 + 4 + c.length;

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let offset = 0;

    dv.setUint32(offset, MAGIC, true);
    offset += 4;
    dv.setUint16(offset, VERSION, true);
    offset += 2;
    dv.setUint32(offset, settingsJson.length, true);
    offset += 4;
    out.set(settingsJson, offset);
    offset += settingsJson.length;
    dv.setUint8(offset, descriptors.length);
    offset += 1;

    for (let i = 0; i < descriptors.length; i++) {
        const d = descriptors[i];
        const c = compressed[i];
        dv.setUint8(offset, d.tag);
        offset += 1;
        dv.setUint8(offset, d.encoding);
        offset += 1;
        dv.setUint32(offset, d.count, true);
        offset += 4;
        dv.setUint32(offset, d.stride, true);
        offset += 4;
        dv.setUint32(offset, d.byteLength, true);
        offset += 4;
        dv.setUint32(offset, c.length, true);
        offset += 4;
        out.set(c, offset);
        offset += c.length;
    }

    return out;
}

interface RawBuffer {
    tag: number;
    bytes: Uint8Array;
}

function readBuffers(bytes: Uint8Array, dv: DataView, start: number, decoder: Decoder): RawBuffer[] {
    let offset = start;
    const bufferCount = dv.getUint8(offset);
    offset += 1;

    const buffers: RawBuffer[] = [];
    for (let i = 0; i < bufferCount; i++) {
        const tag = dv.getUint8(offset);
        offset += 1;
        const encoding = dv.getUint8(offset);
        offset += 1;
        const count = dv.getUint32(offset, true);
        offset += 4;
        const stride = dv.getUint32(offset, true);
        offset += 4;
        const byteLength = dv.getUint32(offset, true);
        offset += 4;
        const compressedLength = dv.getUint32(offset, true);
        offset += 4;
        const source = bytes.subarray(offset, offset + compressedLength);
        offset += compressedLength;

        const target = new Uint8Array(byteLength);
        if (encoding === ENC_INDEX) {
            decoder.decodeIndexSequence(target, count, stride, source);
        } else {
            decoder.decodeVertexBuffer(target, count, stride, source);
        }
        buffers.push({ tag, bytes: target });
    }
    return buffers;
}

function floatView(buffers: Map<number, Uint8Array>, tag: number, length: number): Float32Array {
    const raw = buffers.get(tag);
    if (!raw) throw new Error(`showcase scene: missing buffer ${tag}`);
    return new Float32Array(raw.buffer, 0, length);
}

function byteView(buffers: Map<number, Uint8Array>, tag: number, length: number): Uint8Array {
    const raw = buffers.get(tag);
    if (!raw) throw new Error(`showcase scene: missing buffer ${tag}`);
    return raw.subarray(0, length);
}

function buildShaded(meta: ShadedMeta, buffers: Map<number, Uint8Array>, tagOffset = 0): LidarShadedCloudData {
    const n = meta.pointCount;
    return {
        kind: 'shaded',
        centerLng: meta.centerLng,
        centerLat: meta.centerLat,
        radius: meta.radius,
        pointCount: n,
        positions: floatView(buffers, tagOffset + TAG.shadedPositions, n * 3),
        normals: floatView(buffers, tagOffset + TAG.shadedNormals, n * 3),
        colors: byteView(buffers, tagOffset + TAG.shadedColors, n * 4),
        classifications: byteView(buffers, tagOffset + TAG.shadedClass, n),
        forestTfv: meta.hasForestTfv ? byteView(buffers, tagOffset + TAG.shadedForestTfv, n) : undefined,
        treeSeed: meta.hasTreeSeed ? byteView(buffers, tagOffset + TAG.shadedTreeSeed, n) : undefined,
        heightAboveGround: meta.hasHeight ? floatView(buffers, tagOffset + TAG.shadedHeight, n) : undefined,
        vegHeightAuto: meta.hasHeight ? meta.vegHeightAuto : undefined,
    };
}

function buildMesh(meta: MeshMeta, buffers: Map<number, Uint8Array>, tagOffset = 0): LidarMeshData {
    const v = meta.vertexCount;
    const raw = buffers.get(tagOffset + TAG.meshIndices);
    if (!raw) throw new Error('showcase scene: missing mesh indices');
    return {
        kind: 'mesh',
        centerLng: meta.centerLng,
        centerLat: meta.centerLat,
        radius: meta.radius,
        vertexCount: v,
        triangleCount: meta.triangleCount,
        positions: floatView(buffers, tagOffset + TAG.meshPositions, v * 3),
        normals: floatView(buffers, tagOffset + TAG.meshNormals, v * 3),
        colors: byteView(buffers, tagOffset + TAG.meshColors, v * 4),
        indices: new Uint32Array(raw.buffer, 0, meta.triangleCount * 3),
        macroNormals: meta.hasMacroNormals ? byteView(buffers, tagOffset + TAG.meshMacroNormals, v * 3) : undefined,
        baseMask: meta.hasBaseMask ? byteView(buffers, tagOffset + TAG.meshBaseMask, v) : undefined,
    };
}

/** Decoded geometry buffers (point cloud / mesh) for one or more clouds. */
export interface DecodedGeometry {
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    /** Extra clouds bundled in the scene, in the same order as encoded. */
    extraClouds?: Array<{ shaded: LidarShadedCloudData | null; mesh: LidarMeshData | null }>;
}

/** Parse a compressed binary blob into geometry buffers (point cloud / mesh). */
export async function decodeShowcaseGeometry(data: ArrayBuffer): Promise<DecodedGeometry> {
    const bytes = new Uint8Array(data);
    const dv = new DataView(data);
    let offset = 0;

    if (dv.getUint32(offset, true) !== MAGIC) {
        throw new Error('showcase scene: bad magic header');
    }
    offset += 4;
    const version = dv.getUint16(offset, true);
    offset += 2;
    if (version > VERSION) {
        console.warn(`showcase scene: container version ${version} is newer than supported ${VERSION}`);
    }

    const settingsLen = dv.getUint32(offset, true);
    offset += 4;
    const settingsJson = new TextDecoder().decode(bytes.subarray(offset, offset + settingsLen));
    offset += settingsLen;
    const settings = JSON.parse(settingsJson) as GeometryBlob;

    const decoder = await getDecoder();
    const rawBuffers = readBuffers(bytes, dv, offset, decoder);
    const buffers = new Map<number, Uint8Array>();
    for (const b of rawBuffers) buffers.set(b.tag, b.bytes);

    const shaded = settings.shaded ? buildShaded(settings.shaded, buffers) : null;
    const mesh = settings.mesh ? buildMesh(settings.mesh, buffers) : null;

    const extraClouds = (settings.extraClouds ?? []).map((cloudMeta, i) => {
        const tagOffset = (i + 1) * CLOUD_TAG_STRIDE;
        const cloudShaded = cloudMeta.shaded ? buildShaded(cloudMeta.shaded, buffers, tagOffset) : null;
        const cloudMesh = cloudMeta.mesh ? buildMesh(cloudMeta.mesh, buffers, tagOffset) : null;
        return { shaded: cloudShaded, mesh: cloudMesh };
    });

    return { shaded, mesh, extraClouds: extraClouds.length > 0 ? extraClouds : undefined };
}

/**
 * Relative paths (from the site root) for a scene's three files, derived from
 * its id. This filename convention is the single source of truth — `index.json`
 * only lists ids.
 */
export function showcaseScenePaths(id: string): { geometry: string; manifest: string; thumb: string } {
    return {
        geometry: `showcase/${id}.bin`,
        manifest: `showcase/${id}.json`,
        thumb: `showcase/${id}.webp`,
    };
}

/**
 * Progress update emitted during a scene fetch + decode sequence.
 * - `phase: 'download'` — network transfer in progress.
 *   `loaded` and `total` are byte counts; `total === 0` means indeterminate
 *   (server did not send `Content-Length` or streaming is unavailable).
 * - `phase: 'decode'` — download finished, meshoptimizer decompression running.
 */
export type SceneLoadProgress = {
    phase: 'download' | 'decode';
    loaded?: number;
    total?: number;
};

/**
 * Recover the *uncompressed* byte size from an nginx-style ETag.
 *
 * nginx (and GitHub Pages) emit `"<mtime-hex>-<size-hex>"` derived from the
 * original file. Under gzip the ETag is only marked weak (`W/`); the size
 * segment still reflects the decompressed length, which matches the bytes a
 * streaming reader yields. Returns 0 when absent or not in that format.
 */
export function uncompressedSizeFromETag(etag: string | null): number {
    if (etag === null) return 0;
    const cleaned = etag.replace(/^W\//, '').replaceAll('"', '').trim();
    const dash = cleaned.lastIndexOf('-');
    if (dash < 0) return 0;
    const hex = cleaned.slice(dash + 1);
    if (!/^[0-9a-f]+$/i.test(hex)) return 0;
    const size = Number.parseInt(hex, 16);
    return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Fetch a binary URL with optional streaming download-progress callbacks.
 * Falls back to a single `arrayBuffer()` call when `response.body` is absent
 * or `Content-Length` is missing (emits one indeterminate tick in that case).
 */
export async function fetchArrayBufferWithProgress(
    url: string,
    onProgress?: (p: SceneLoadProgress) => void,
): Promise<ArrayBuffer> {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`showcase scene: fetch failed (${res.status})`);

    // When the server compresses the transfer (gzip/br/deflate), `Content-Length`
    // is the COMPRESSED size while the reader yields DECOMPRESSED bytes — the two
    // never match, so the percentage would overshoot 100%. In that case we can't
    // trust Content-Length and try to recover the original size from the ETag.
    const encoding = res.headers.get('Content-Encoding');
    const compressed = encoding !== null && encoding.trim().toLowerCase() !== 'identity';
    const lengthHeader = res.headers.get('Content-Length');
    let total = compressed || !lengthHeader ? 0 : Number.parseInt(lengthHeader, 10);
    if (total === 0) {
        // nginx / GitHub Pages emit an ETag of the form `"<mtime-hex>-<size-hex>"`
        // computed from the *original* file; gzip only weakens it (`W/`) and keeps
        // the uncompressed size — which is exactly what the reader yields. Only
        // readable same-origin or when the server exposes ETag via CORS.
        total = uncompressedSizeFromETag(res.headers.get('ETag'));
    }

    if (!res.body || total === 0) {
        onProgress?.({ phase: 'download', loaded: 0, total: 0 });
        return res.arrayBuffer();
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let trustTotal = true;
    for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        // Some browsers decompress transparently yet hide `Content-Encoding`, so
        // the byte count can still exceed the advertised total. Once that happens
        // the total is provably wrong — drop to an indeterminate bar.
        if (loaded > total) trustTotal = false;
        onProgress?.({ phase: 'download', loaded, total: trustTotal ? total : 0 });
    }

    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}

/** Fetch and parse a scene's sidecar manifest (title + description + camera + ambiance). */
export async function fetchShowcaseManifest(url: string): Promise<ShowcaseManifest> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`showcase manifest: fetch failed (${res.status})`);
    // Missing scene assets aren't 404s: the dev server and SPA hosting both answer
    // with index.html and a 200, which would otherwise surface as a JSON.parse error.
    const type = res.headers.get('Content-Type') ?? '';
    if (!type.includes('json')) throw new Error(`showcase manifest: scène non publiée (${url})`);
    return parseShowcaseManifest(await res.text());
}

/**
 * Assemble a full showcase scene from an already-loaded manifest plus the
 * geometry fetched and decoded from its `.bin`.
 *
 * Pass `onProgress` to receive download-percentage and decode-phase updates
 * (used by the gallery to render a progress bar on the tile).
 */
export async function loadShowcaseScene(
    args: { id: string; geometryUrl: string; manifest: ShowcaseManifest },
    onProgress?: (p: SceneLoadProgress) => void,
): Promise<ShowcaseScene> {
    const buf = await fetchArrayBufferWithProgress(args.geometryUrl, onProgress);
    onProgress?.({ phase: 'decode' });
    const geometry = await decodeShowcaseGeometry(buf);
    return {
        id: args.id,
        title: args.manifest.title,
        description: args.manifest.description,
        camera: args.manifest.camera,
        ambiance: args.manifest.ambiance,
        shaded: geometry.shaded,
        mesh: geometry.mesh,
        extraClouds: geometry.extraClouds,
    };
}
