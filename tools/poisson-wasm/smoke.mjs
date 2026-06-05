// Node smoke test for the wasm32 PoissonRecon build (Node ≤22 cannot load
// the wasm64 variant). Generates a tiny synthetic oriented point cloud
// (sphere ~4000 points), runs the solver, prints the result.
//
// Usage:   node tools/poisson-wasm/smoke.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(__dirname, '..', '..', 'public', 'wasm');
const PoissonReconModule = (await import(join(wasmDir, 'poissonrecon.wasm32.mjs'))).default;
const wasmBinary = readFileSync(join(wasmDir, 'poissonrecon.wasm32.wasm'));

const N = 4000;
const buf = new Float32Array(N * 6);
for (let i = 0; i < N; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / N);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    buf[i * 6 + 0] = x; buf[i * 6 + 1] = y; buf[i * 6 + 2] = z;
    buf[i * 6 + 3] = x; buf[i * 6 + 4] = y; buf[i * 6 + 5] = z;
}

const header =
    'ply\nformat binary_little_endian 1.0\n' +
    `element vertex ${N}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property float nx\nproperty float ny\nproperty float nz\n' +
    'end_header\n';
const headerBytes = new TextEncoder().encode(header);
const body = new Uint8Array(buf.buffer);
const ply = new Uint8Array(headerBytes.length + body.length);
ply.set(headerBytes, 0);
ply.set(body, headerBytes.length);

const Module = await PoissonReconModule({
    wasmBinary,
    print: (s) => console.log('[stdout]', s),
    printErr: (s) => console.error('[stderr]', s),
    noInitialRun: true,
});
Module.FS.writeFile('/input.ply', ply);

const t0 = performance.now();
const rc = Module.callMain([
    '--in', '/input.ply', '--out', '/output.ply',
    '--depth', '5', '--bType', '2', '--samplesPerNode', '1.5',
    '--parallel', '1', '--verbose',
]);
const dt = ((performance.now() - t0) / 1000).toFixed(2);
const out = Module.FS.readFile('/output.ply');
console.log(`\nmain returned ${rc} in ${dt}s, output ${out.length} bytes`);
if (rc !== 0 || out.length < 1000) {
    console.error('smoke test FAILED');
    process.exit(1);
}
console.log('smoke test OK');
