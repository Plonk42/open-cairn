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

import type { ShaderPreset } from './lidarBrowser/slope';
import type { LidarMeshData, LidarShadedCloudData } from './lidarCloud';

const MAGIC = 0x4f435353; // "OCSS"
const VERSION = 1;

const ENC_VERTEX = 0;
const ENC_INDEX = 1;

const TAG = {
    shadedPositions: 0,
    shadedNormals: 1,
    shadedColors: 2,
    shadedClass: 3,
    meshPositions: 4,
    meshNormals: 5,
    meshColors: 6,
    meshIndices: 7,
    meshRoughness: 8,
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
    lidarCloudEdl: boolean;
    lidarCloudEdlStrength: number;
    lidarCloudEdlRadius: number;
    lidarCloudEdlFarPlane: number;
    lidarCloudPointSize: number;
    lidarCloudSizeCompensation: boolean;
    lidarCloudOpacity: number;
    lidarCloudPhotoOpacity: number;
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
    lidarCloudEdl: true,
    lidarCloudEdlStrength: 1000,
    lidarCloudEdlRadius: 1.4,
    lidarCloudEdlFarPlane: 250,
    lidarCloudPointSize: 2,
    lidarCloudSizeCompensation: true,
    lidarCloudOpacity: 1,
    lidarCloudPhotoOpacity: 0,
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
}

interface MeshMeta {
    centerLng: number;
    centerLat: number;
    radius: number;
    vertexCount: number;
    triangleCount: number;
    hasRoughness: boolean;
}

/**
 * Geometry metadata embedded in the binary settings header — only what's needed
 * to rebuild the typed arrays. Presentation settings (name, camera, ambiance)
 * live in the sidecar manifest, NOT here.
 */
interface GeometryBlob {
    shaded: ShadedMeta | null;
    mesh: MeshMeta | null;
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

function collectDescriptors(scene: Pick<ShowcaseScene, 'shaded' | 'mesh'>): BufferDescriptor[] {
    const descriptors: BufferDescriptor[] = [];
    const { shaded, mesh } = scene;
    if (shaded) {
        descriptors.push(
            vertexDescriptor(TAG.shadedPositions, shaded.positions, 12),
            vertexDescriptor(TAG.shadedNormals, shaded.normals, 12),
            vertexDescriptor(TAG.shadedColors, shaded.colors, 4),
            vertexDescriptor(TAG.shadedClass, shaded.classifications, 1),
        );
    }
    if (mesh) {
        descriptors.push(
            vertexDescriptor(TAG.meshPositions, mesh.positions, 12),
            vertexDescriptor(TAG.meshNormals, mesh.normals, 12),
            vertexDescriptor(TAG.meshColors, mesh.colors, 4),
            indexDescriptor(TAG.meshIndices, mesh.indices),
        );
        if (mesh.roughness) {
            descriptors.push(vertexDescriptor(TAG.meshRoughness, mesh.roughness, 4));
        }
    }
    return descriptors;
}

function buildGeometryBlob(scene: Pick<ShowcaseScene, 'shaded' | 'mesh'>): GeometryBlob {
    const { shaded, mesh } = scene;
    return {
        shaded: shaded
            ? {
                centerLng: shaded.centerLng,
                centerLat: shaded.centerLat,
                radius: shaded.radius,
                pointCount: shaded.pointCount,
            }
            : null,
        mesh: mesh
            ? {
                centerLng: mesh.centerLng,
                centerLat: mesh.centerLat,
                radius: mesh.radius,
                vertexCount: mesh.vertexCount,
                triangleCount: mesh.triangleCount,
                hasRoughness: Boolean(mesh.roughness),
            }
            : null,
    };
}

/** Extract the editable presentation settings (title + description + camera + ambiance). */
export function buildShowcaseManifest(scene: ShowcaseScene): ShowcaseManifest {
    return {
        title: scene.title,
        description: scene.description,
        camera: scene.camera,
        ambiance: scene.ambiance,
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
    };
}

/**
 * Serialize a showcase scene's geometry to a compressed binary blob. Only the
 * mesh/point buffers and the metadata needed to decode them are written — the
 * editable camera/ambiance/name go in the sidecar manifest (see
 * {@link serializeShowcaseManifest}).
 */
export async function encodeShowcaseGeometry(scene: Pick<ShowcaseScene, 'shaded' | 'mesh'>): Promise<Uint8Array> {
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

function buildShaded(meta: ShadedMeta, buffers: Map<number, Uint8Array>): LidarShadedCloudData {
    const n = meta.pointCount;
    return {
        kind: 'shaded',
        centerLng: meta.centerLng,
        centerLat: meta.centerLat,
        radius: meta.radius,
        pointCount: n,
        positions: floatView(buffers, TAG.shadedPositions, n * 3),
        normals: floatView(buffers, TAG.shadedNormals, n * 3),
        colors: byteView(buffers, TAG.shadedColors, n * 4),
        classifications: byteView(buffers, TAG.shadedClass, n),
    };
}

function buildMesh(meta: MeshMeta, buffers: Map<number, Uint8Array>): LidarMeshData {
    const v = meta.vertexCount;
    const raw = buffers.get(TAG.meshIndices);
    if (!raw) throw new Error('showcase scene: missing mesh indices');
    return {
        kind: 'mesh',
        centerLng: meta.centerLng,
        centerLat: meta.centerLat,
        radius: meta.radius,
        vertexCount: v,
        triangleCount: meta.triangleCount,
        positions: floatView(buffers, TAG.meshPositions, v * 3),
        normals: floatView(buffers, TAG.meshNormals, v * 3),
        colors: byteView(buffers, TAG.meshColors, v * 4),
        indices: new Uint32Array(raw.buffer, 0, meta.triangleCount * 3),
        roughness: meta.hasRoughness ? floatView(buffers, TAG.meshRoughness, v) : undefined,
    };
}

/** Decoded geometry plus any presentation settings embedded in legacy binaries. */
export interface DecodedGeometry {
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
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

    return {
        shaded: settings.shaded ? buildShaded(settings.shaded, buffers) : null,
        mesh: settings.mesh ? buildMesh(settings.mesh, buffers) : null,
    };
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

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`showcase scene: fetch failed (${res.status})`);
    return res.arrayBuffer();
}

/** Fetch and parse a scene's sidecar manifest (title + description + camera + ambiance). */
export async function fetchShowcaseManifest(url: string): Promise<ShowcaseManifest> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`showcase manifest: fetch failed (${res.status})`);
    return parseShowcaseManifest(await res.text());
}

/**
 * Assemble a full showcase scene from an already-loaded manifest plus the
 * geometry fetched and decoded from its `.bin`.
 */
export async function loadShowcaseScene(args: {
    id: string;
    geometryUrl: string;
    manifest: ShowcaseManifest;
}): Promise<ShowcaseScene> {
    const geometry = await fetchArrayBuffer(args.geometryUrl).then(decodeShowcaseGeometry);
    return {
        id: args.id,
        title: args.manifest.title,
        description: args.manifest.description,
        camera: args.manifest.camera,
        ambiance: args.manifest.ambiance,
        shaded: geometry.shaded,
        mesh: geometry.mesh,
    };
}
