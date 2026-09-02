// Runs the production PoissonRecon WASM build on a PLY file with the exact
// production arguments (pipeline.ts → poissonRecon.ts), and reports wall time.
//
// Usage: node run-wasm.mjs <in.ply> <depth> [wasm32|wasm64]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(__dirname, '..', '..', 'public', 'wasm');

const IN = process.argv[2];
const DEPTH = process.argv[3] ?? '10';
const VARIANT = process.argv[4] ?? 'wasm32';
const suffix = VARIANT === 'wasm64' ? '' : '.wasm32';
// A variant containing "/" is treated as a direct path to a .mjs build.
const base = VARIANT.includes('/')
    ? VARIANT.replace(/\.mjs$/, '')
    : join(wasmDir, `poissonrecon${suffix}`);

const factory = (await import(`${base}.mjs`)).default;
const wasmBinary = readFileSync(`${base}.wasm`);
const ply = readFileSync(IN);

const tLoad = performance.now();
const Module = await factory({
    wasmBinary,
    print: () => {},
    printErr: (s) => {
        if (/error|abort|bad_alloc/i.test(s)) console.error('[stderr]', s);
    },
    noInitialRun: true,
});
Module.FS.writeFile('/input.ply', ply);
const loadMs = performance.now() - tLoad;

const t0 = performance.now();
const rc = Module.callMain([
    '--in', '/input.ply',
    '--out', '/output.ply',
    '--depth', DEPTH,
    '--bType', '2',
    '--samplesPerNode', '1.5',
    '--pointWeight', '4',
    '--parallel', '1',
    '--confidence',
]);
const solveMs = performance.now() - t0;

let verts = 0;
let faces = 0;
let bytes = 0;
if (rc === 0) {
    const out = Module.FS.readFile('/output.ply');
    bytes = out.length;
    const head = new TextDecoder().decode(out.subarray(0, 400));
    verts = Number(/element vertex (\d+)/.exec(head)?.[1] ?? 0);
    faces = Number(/element face (\d+)/.exec(head)?.[1] ?? 0);
}
console.log(
    JSON.stringify({
        variant: VARIANT,
        depth: Number(DEPTH),
        rc,
        loadMs: Math.round(loadMs),
        solveSec: +(solveMs / 1000).toFixed(2),
        verts,
        faces,
        outMB: +(bytes / 1e6).toFixed(1),
        peakRssMB: Math.round(process.memoryUsage().rss / 1e6),
    })
);
