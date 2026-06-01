#!/usr/bin/env node
// Crop a 250×250 m square (around the centroid) from a big LidarTerrainMesh
// `*.points.ply` (x, y, z, nx, ny, nz, r, g, b) and write a small PLY with
// only x,y,z,nx,ny,nz so open-cairn's fetchLidarPoisson can validate that
// PoissonRecon+post produce a clean mesh when fed properly oriented normals.

import { readFileSync, writeFileSync, openSync, readSync, statSync, closeSync } from 'node:fs';

const IN = process.argv[2] ?? '/home/poulainc/workspace_sandbox/LidarTerrainMesh/output/chamechaude/0918_6470.points.ply';
const OUT = process.argv[3] ?? '/home/poulainc/workspace_sandbox/open-cairn/public/test/chamechaude_250m.ply';
const SIDE = parseFloat(process.argv[4] ?? '250'); // meters

const STRIDE = 4; // keep 1 of every 4 points

const fd = openSync(IN, 'r');
const size = statSync(IN).size;

// Read header — small chunk is enough.
const headerBuf = Buffer.alloc(2048);
readSync(fd, headerBuf, 0, 2048, 0);
const headerText = headerBuf.toString('latin1');
const headerEnd = headerText.indexOf('end_header\n');
if (headerEnd < 0) throw new Error('no end_header');
const headerLen = headerEnd + 'end_header\n'.length;

const vMatch = headerText.match(/element vertex (\d+)/);
if (!vMatch) throw new Error('no vertex count');
const N = parseInt(vMatch[1], 10);

// Compute vertex stride from the header: each property's byte size.
const propRe = /property (\w+) (\w+)/g;
let m;
const props = [];
const typeBytes = { float: 4, uchar: 1, char: 1, ushort: 2, short: 2, uint: 4, int: 4, double: 8 };
const headerVertexSection = headerText.slice(headerText.indexOf('element vertex'), headerText.indexOf('element face') > 0 ? headerText.indexOf('element face') : headerEnd);
while ((m = propRe.exec(headerVertexSection))) {
    props.push({ type: m[1], name: m[2] });
}
const vertexStride = props.reduce((s, p) => s + typeBytes[p.type], 0);
const offX = 0;
const offY = offX + typeBytes[props[0].type];
const offZ = offY + typeBytes[props[1].type];
const offNX = offZ + typeBytes[props[2].type];
const offNY = offNX + typeBytes[props[3].type];
const offNZ = offNY + typeBytes[props[4].type];
console.log(`header: ${N} vertices, stride ${vertexStride}, props=${props.map(p => p.name).join(',')}`);

// Pass 1: scan bbox.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const buf = Buffer.alloc(vertexStride);
const scanStride = Math.max(1, Math.floor(N / 50000));
for (let i = 0; i < N; i += scanStride) {
    readSync(fd, buf, 0, vertexStride, headerLen + i * vertexStride);
    const x = buf.readFloatLE(offX), y = buf.readFloatLE(offY);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
}
console.log(`bbox x=[${minX.toFixed(3)},${maxX.toFixed(3)}] y=[${minY.toFixed(3)},${maxY.toFixed(3)}]`);
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
const unit = (maxX - minX) > 100 ? 1 : 1000; // detect meters vs kilometers
const halfMeters = SIDE / 2;
const half = halfMeters / unit;
console.log(`centroid (${cx.toFixed(3)}, ${cy.toFixed(3)}) — assuming unit = ${unit === 1 ? 'm' : 'km'}, half = ${half}`);

// Pass 2: collect points inside the square, every STRIDE-th.
const out = []; // array of [x,y,z,nx,ny,nz] floats
const MAX_POINTS = 300_000;
let kept = 0;
for (let i = 0; i < N && kept < MAX_POINTS; i += STRIDE) {
    readSync(fd, buf, 0, vertexStride, headerLen + i * vertexStride);
    const x = buf.readFloatLE(offX);
    const y = buf.readFloatLE(offY);
    if (Math.abs(x - cx) > half || Math.abs(y - cy) > half) continue;
    const z = buf.readFloatLE(offZ);
    const nx = buf.readFloatLE(offNX);
    const ny = buf.readFloatLE(offNY);
    const nz = buf.readFloatLE(offNZ);
    out.push(x, y, z, nx, ny, nz);
    kept++;
}
closeSync(fd);
const M = out.length / 6;
console.log(`kept ${M.toLocaleString()} points`);

// Write small PLY: x,y,z,nx,ny,nz binary LE.
const header = `ply
format binary_little_endian 1.0
element vertex ${M}
property float x
property float y
property float z
property float nx
property float ny
property float nz
end_header
`;
const body = Buffer.alloc(M * 24);
for (let i = 0; i < out.length; i++) body.writeFloatLE(out[i], i * 4);
writeFileSync(OUT, Buffer.concat([Buffer.from(header, 'latin1'), body]));
console.log(`wrote ${OUT} (${(body.length / 1024 / 1024).toFixed(1)} MB)`);
