/**
 * PoissonRecon (Misha Kazhdan, v18.76) wrapped as a WASM module.
 *
 * Loads `/wasm/poissonrecon.{mjs,wasm}` lazily via dynamic import, runs the
 * solver against an in-memory oriented point cloud, and returns the
 * reconstructed mesh (positions + faces, normals computed downstream).
 *
 * Public API:
 *   reconstructPoisson(points, opts) → { positions, indices }
 *
 * Input  : interleaved Float32Array [x,y,z,nx,ny,nz,...]
 * Output : Float32 positions + Uint32 triangle indices
 */

interface EmModule {
    callMain: (args: string[]) => number;
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
        unlink: (path: string) => void;
    };
    getExceptionMessage?: (ptr: unknown) => string;
}

type ModuleFactory = (opts: {
    print?: (s: string) => void;
    printErr?: (s: string) => void;
    noInitialRun?: boolean;
    locateFile?: (path: string, prefix: string) => string;
}) => Promise<EmModule>;

export interface PoissonOptions {
    /** Octree depth (8 = fast/coarse, 12 = slow/fine). Default 9. */
    depth?: number;
    /** Boundary type: 1=free, 2=Dirichlet, 3=Neumann. Default 2. */
    bType?: number;
    /** Min samples per octree node. Default 1.5. */
    samplesPerNode?: number;
    /** Interpolation weight. Default 4. */
    pointWeight?: number;
    /** Optional log sink for emcc print/printErr. */
    onLog?: (line: string) => void;
    /** Coarse progress callback driven by PoissonRecon's stdout phase markers. */
    onPhase?: (label: string, fraction: number) => void;
}

export interface PoissonMesh {
    positions: Float32Array; // length = 3 * vertexCount
    indices: Uint32Array;    // length = 3 * triangleCount
}

let modulePromise: Promise<EmModule> | null = null;

// Mutated per call inside reconstructPoisson(); the cached Module's print
// callback always reads from these slots, so subsequent calls' onLog/onPhase
// take effect even though emcc only sets `print` once at module load.
let currentLogSink: ((s: string) => void) | null = null;
let currentPhaseSink: ((label: string, fraction: number) => void) | null = null;

// PoissonRecon prints these markers on stdout in roughly this order. We
// match case-insensitive substrings (PoissonRecon's exact wording varies
// slightly across releases) and emit a fraction so the UI can fill a bar.
const PHASE_MARKERS: ReadonlyArray<{ match: RegExp; label: string; frac: number }> = [
    { match: /input points|got points|loaded points/i, label: 'Lecture des points', frac: 0.05 },
    { match: /kernel density/i, label: 'Densité du noyau', frac: 0.15 },
    { match: /finalized tree|got tree/i, label: 'Octree', frac: 0.25 },
    { match: /normal field/i, label: 'Champ de normales', frac: 0.4 },
    { match: /fem constraints/i, label: 'Contraintes FEM', frac: 0.55 },
    { match: /point constraints/i, label: 'Contraintes points', frac: 0.65 },
    { match: /solved linear system|linear system/i, label: 'Résolution', frac: 0.8 },
    { match: /iso-value|got average/i, label: 'Iso-valeur', frac: 0.88 },
    { match: /got polygons|got triangles/i, label: 'Triangulation', frac: 0.96 },
];

function dispatchStdout(line: string): void {
    currentLogSink?.(line);
    if (!currentPhaseSink) return;
    for (const p of PHASE_MARKERS) {
        if (p.match.test(line)) {
            currentPhaseSink(p.label, p.frac);
            return;
        }
    }
}

// emcc bakes a hard `throw` at the top of the wasm64 glue mjs when the runtime
// doesn't support MEMORY64 (Safari, Chrome <128, Firefox <134, Node <23). The
// dynamic import itself rejects — that's our detection signal. On rejection
// we transparently load the wasm32 build from the same directory.
async function loadModule(onLog?: (s: string) => void): Promise<EmModule> {
    if (modulePromise !== null) return modulePromise;
    const base = new URL(import.meta.env.BASE_URL, globalThis.location.origin).href;
    const factory = async (file: string): Promise<EmModule> => {
        const url = new URL(`wasm/${file}`, base).href;
        const mod = await import(/* @vite-ignore */ url) as { default: ModuleFactory };
        return mod.default({
            print: dispatchStdout,
            printErr: dispatchStdout,
            noInitialRun: true,
            locateFile: (p) => new URL(`wasm/${p}`, base).href,
        });
    };
    modulePromise = factory('poissonrecon.mjs').catch((err) => {
        onLog?.(`poisson: wasm64 unavailable (${(err as Error).message}); falling back to wasm32`);
        return factory('poissonrecon.wasm32.mjs');
    });
    return modulePromise;
}

function decodeWasmException(e: unknown, mod: EmModule): string {
    if (e instanceof Error) return e.message;
    try {
        const m = mod.getExceptionMessage?.(e);
        if (m) return m;
    } catch { /* ignore */ }
    try { return JSON.stringify(e); } catch { return String(e); }
}

/** Encode interleaved [x,y,z,nx,ny,nz,…] floats as binary little-endian PLY. */
function encodePly(points: Float32Array): Uint8Array {
    const n = points.length / 6;
    const header =
        'ply\n' +
        'format binary_little_endian 1.0\n' +
        `element vertex ${n}\n` +
        'property float x\n' +
        'property float y\n' +
        'property float z\n' +
        'property float nx\n' +
        'property float ny\n' +
        'property float nz\n' +
        'end_header\n';
    const headerBytes = new TextEncoder().encode(header);
    const bodyBytes = new Uint8Array(points.buffer, points.byteOffset, points.byteLength);
    const out = new Uint8Array(headerBytes.length + bodyBytes.length);
    out.set(headerBytes, 0);
    out.set(bodyBytes, headerBytes.length);
    return out;
}

/**
 * Parse the binary little-endian PLY produced by PoissonRecon.
 * Expected layout: float x,y,z per vertex + face list `uchar uint vertex_indices`.
 */
function decodePly(bytes: Uint8Array): PoissonMesh {
    // Header is ASCII; find the "end_header\n" sentinel.
    const text = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const headerEnd = text.indexOf('end_header\n');
    if (headerEnd < 0) throw new Error('poisson decodePly: end_header not found');
    const headerLen = headerEnd + 'end_header\n'.length;
    const header = text.slice(0, headerLen);

    if (!header.startsWith('ply\n')) throw new Error('poisson decodePly: bad magic');
    if (!header.includes('format binary_little_endian 1.0')) {
        throw new Error('poisson decodePly: unsupported PLY format');
    }

    // Parse element counts.
    const vMatch = /element vertex (\d+)/.exec(header);
    const fMatch = /element face (\d+)/.exec(header);
    if (!vMatch) throw new Error('poisson decodePly: no vertex element');
    const vCount = Number.parseInt(vMatch[1], 10);
    const fCount = fMatch ? Number.parseInt(fMatch[1], 10) : 0;

    // PoissonRecon writes vertex (float x,y,z) then face (list int int).
    const positions = new Float32Array(vCount * 3);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = headerLen;
    for (let i = 0; i < vCount; i++) {
        positions[i * 3] = dv.getFloat32(off, true);
        positions[i * 3 + 1] = dv.getFloat32(off + 4, true);
        positions[i * 3 + 2] = dv.getFloat32(off + 8, true);
        off += 12;
    }

    // Face list per spec: `property list int int vertex_indices`.
    // → 4 bytes int32 vertex count (always 3) + 3×int32 indices.
    const indices = new Uint32Array(fCount * 3);
    for (let i = 0; i < fCount; i++) {
        const k = dv.getInt32(off, true);
        off += 4;
        if (k !== 3) throw new Error(`poisson decodePly: non-triangle face (n=${k})`);
        indices[i * 3] = dv.getInt32(off, true);
        indices[i * 3 + 1] = dv.getInt32(off + 4, true);
        indices[i * 3 + 2] = dv.getInt32(off + 8, true);
        off += 12;
    }

    return { positions, indices };
}

/**
 * Run PoissonRecon WASM on an oriented point cloud and return a triangle mesh.
 * `points` is an interleaved [x,y,z,nx,ny,nz,...] Float32Array.
 */
export async function reconstructPoisson(
    points: Float32Array,
    opts: PoissonOptions = {},
): Promise<PoissonMesh> {
    if (points.length % 6 !== 0) {
        throw new Error(`reconstructPoisson: input length ${points.length} not divisible by 6`);
    }
    currentLogSink = opts.onLog ?? null;
    currentPhaseSink = opts.onPhase ?? null;
    try {
        const Module = await loadModule(opts.onLog);
        opts.onPhase?.('Préparation', 0);
        const inPly = encodePly(points);
        Module.FS.writeFile('/pr_in.ply', inPly);
        const args = [
            '--in', '/pr_in.ply',
            '--out', '/pr_out.ply',
            '--depth', String(opts.depth ?? 9),
            '--bType', String(opts.bType ?? 2),
            '--samplesPerNode', String(opts.samplesPerNode ?? 1.5),
            '--pointWeight', String(opts.pointWeight ?? 4),
            // Mono-thread WASM build → parallel must be 1.
            '--parallel', '1',
        ];
        try {
            Module.callMain(args);
        } catch (e) {
            throw new Error(`PoissonRecon WASM crashed: ${decodeWasmException(e, Module)}`);
        }
        let outBytes: Uint8Array;
        try {
            outBytes = Module.FS.readFile('/pr_out.ply');
        } catch (e) {
            throw new Error(`PoissonRecon did not produce output (${(e as Error).message})`);
        }
        // Detach from MEMFS before parsing so the buffer is safe to use.
        const copy = new Uint8Array(outBytes.length);
        copy.set(outBytes);
        Module.FS.unlink('/pr_in.ply');
        Module.FS.unlink('/pr_out.ply');
        opts.onPhase?.('Décodage du maillage', 0.99);
        return decodePly(copy);
    } finally {
        currentLogSink = null;
        currentPhaseSink = null;
    }
}
