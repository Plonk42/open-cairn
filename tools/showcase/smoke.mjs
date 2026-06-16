import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

// Standalone replica of the codec logic in src/lib/showcaseScene.ts to verify
// the meshopt round-trip is lossless for our heterogeneous buffers.
const MAGIC = 0x4f435353;
const VERSION = 1;
const ENC_VERTEX = 0;
const ENC_INDEX = 1;

function asBytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
function padBytes(src, align) {
  const r = src.length % align;
  if (r === 0) return src;
  const p = new Uint8Array(src.length + (align - r));
  p.set(src);
  return p;
}
function vtx(tag, view, stride) {
  const bytes = stride % 4 === 0 ? asBytes(view) : padBytes(asBytes(view), 4);
  const s = stride % 4 === 0 ? stride : 4;
  return { tag, encoding: ENC_VERTEX, count: bytes.length / s, stride: s, byteLength: bytes.length, bytes };
}
function idx(tag, indices) {
  const bytes = asBytes(indices);
  return { tag, encoding: ENC_INDEX, count: indices.length, stride: 4, byteLength: bytes.length, bytes };
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const N = 5000;
  const positions = new Float32Array(N * 3);
  const normals = new Float32Array(N * 3);
  const colors = new Uint8Array(N * 4);
  const classifications = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = Math.sin(i) * 100;
    positions[i * 3 + 1] = Math.cos(i) * 100;
    positions[i * 3 + 2] = (i % 50) * 0.37;
    normals[i * 3] = 0; normals[i * 3 + 1] = 0; normals[i * 3 + 2] = 1;
    colors[i * 4] = i & 255; colors[i * 4 + 1] = (i >> 2) & 255; colors[i * 4 + 2] = 128; colors[i * 4 + 3] = 255;
    classifications[i] = [2, 3, 4, 5, 6][i % 5];
  }
  const TRI = 3000;
  const indices = new Uint32Array(TRI * 3);
  for (let t = 0; t < TRI; t++) {
    indices[t * 3] = t % N;
    indices[t * 3 + 1] = (t + 1) % N;
    indices[t * 3 + 2] = (t + 2) % N;
  }

  const descriptors = [
    vtx(0, positions, 12),
    vtx(1, normals, 12),
    vtx(2, colors, 4),
    vtx(3, classifications, 1),
    idx(7, indices),
  ];

  const compressed = descriptors.map((d) =>
    d.encoding === ENC_INDEX
      ? MeshoptEncoder.encodeIndexSequence(d.bytes, d.count, d.stride)
      : MeshoptEncoder.encodeVertexBuffer(d.bytes, d.count, d.stride),
  );

  const rawSize = descriptors.reduce((a, d) => a + d.byteLength, 0);
  const compSize = compressed.reduce((a, c) => a + c.length, 0);
  console.log(`raw=${rawSize} comp=${compSize} ratio=${(compSize / rawSize).toFixed(3)}`);

  // decode
  let ok = true;
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i];
    const target = new Uint8Array(d.byteLength);
    if (d.encoding === ENC_INDEX) MeshoptDecoder.decodeIndexSequence(target, d.count, d.stride, compressed[i]);
    else MeshoptDecoder.decodeVertexBuffer(target, d.count, d.stride, compressed[i]);
    for (let b = 0; b < d.bytes.length; b++) {
      if (target[b] !== d.bytes[b]) { ok = false; console.error(`mismatch tag=${d.tag} byte=${b}`); break; }
    }
  }
  console.log('round-trip', ok ? 'OK' : 'FAILED');
  // sanity: float reinterpret of positions
  const target = new Uint8Array(descriptors[0].byteLength);
  MeshoptDecoder.decodeVertexBuffer(target, descriptors[0].count, descriptors[0].stride, compressed[0]);
  const fp = new Float32Array(target.buffer, 0, N * 3);
  console.log('pos[0..2]', fp[0].toFixed(3), fp[1].toFixed(3), fp[2].toFixed(3), '==', positions[0].toFixed(3));
  process.exit(ok ? 0 : 1);
}
main();
