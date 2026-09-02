// Generates a synthetic oriented point cloud that mirrors the production
// PoissonRecon input measured on the Vercors capture (2 dalles, stride 2):
//   1,357,002 ground points @ ~10.8 pts/m² over a ~354 m square
// + 225,227 synthetic base points (flat floor + vertical walls, cf. poissonBase.ts)
// Normals carry a confidence magnitude in [0,1] like orientNormalsForPoisson's
// weightByQuality, since production passes --confidence.
//
// Usage: node make-terrain.mjs <out.ply> [--ground=N] [--base=N] [--relief=M] [--side=M]
import { writeFileSync } from 'node:fs';

const args = new Map(
    process.argv.slice(3).map((a) => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v];
    })
);
const OUT = process.argv[2] ?? 'terrain.ply';
const N_GROUND = Number(args.get('ground') ?? 1_357_002);
const N_BASE = Number(args.get('base') ?? 225_227);
const RELIEF = Number(args.get('relief') ?? 190); // vertical extent, m
const SIDE = Number(args.get('side') ?? 354.3); // footprint side, m

// mulberry32 — deterministic, same generator family as tools/veg-tune
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(42);

// --- value-noise fBm heightfield -------------------------------------------
const PERM = new Uint8Array(512);
{
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    PERM.set(p, 0);
    PERM.set(p, 256);
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const hash2 = (xi, yi) => PERM[(PERM[xi & 255] + (yi & 255)) & 511] / 255;

function valueNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    return lerp(
        lerp(hash2(xi, yi), hash2(xi + 1, yi), xf),
        lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), xf),
        yf
    );
}

// fBm + a cliff band across the middle (Vercors-like: plateau, steep face, talus)
function height(x, y) {
    const u = x / SIDE;
    const v = y / SIDE;
    let h = 0;
    let amp = 1;
    let freq = 3;
    let norm = 0;
    for (let o = 0; o < 6; o++) {
        h += amp * valueNoise(u * freq, v * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.07;
    }
    h /= norm;
    // cliff: sharp sigmoid drop around v = 0.55, ~45 % of the total relief
    const cliff = 1 / (1 + Math.exp(-(v - 0.55) * 90));
    return RELIEF * (0.55 * h + 0.45 * cliff);
}

const EPS = 0.35;
function normalAt(x, y) {
    const hx = (height(x + EPS, y) - height(x - EPS, y)) / (2 * EPS);
    const hy = (height(x, y + EPS) - height(x, y - EPS)) / (2 * EPS);
    const len = Math.hypot(-hx, -hy, 1);
    return [-hx / len, -hy / len, 1 / len];
}

const total = N_GROUND + N_BASE;
const buf = new Float32Array(total * 6);
let w = 0;
let zMin = Infinity;
let zMax = -Infinity;

for (let i = 0; i < N_GROUND; i++) {
    const x = rand() * SIDE;
    const y = rand() * SIDE;
    const z = height(x, y) + (rand() - 0.5) * 0.08; // LiDAR ranging noise
    const [nx, ny, nz] = normalAt(x, y);
    // confidence: PCA fit quality proxy — lower on steep/rough ground
    const conf = 0.45 + 0.55 * nz * nz;
    buf[w++] = x;
    buf[w++] = y;
    buf[w++] = z;
    buf[w++] = nx * conf;
    buf[w++] = ny * conf;
    buf[w++] = nz * conf;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
}

// --- flat base: floor + 4 vertical walls (mirrors poissonBase.ts) -----------
const floorZ = zMin - 4;
const wallH = zMax - floorZ;
const perim = 4 * SIDE;
const areaFloor = SIDE * SIDE;
const areaWall = perim * wallH * 0.5; // walls only span up to the local terrain
const nFloor = Math.round((N_BASE * areaFloor) / (areaFloor + areaWall));
const nWall = N_BASE - nFloor;

for (let i = 0; i < nFloor; i++) {
    buf[w++] = rand() * SIDE;
    buf[w++] = rand() * SIDE;
    buf[w++] = floorZ;
    buf[w++] = 0;
    buf[w++] = 0;
    buf[w++] = -1;
}
for (let i = 0; i < nWall; i++) {
    const side = i & 3;
    const t = rand() * SIDE;
    const x = side === 0 ? 0 : side === 1 ? SIDE : t;
    const y = side === 2 ? 0 : side === 3 ? SIDE : t;
    const top = height(Math.min(Math.max(x, 0.01), SIDE - 0.01), Math.min(Math.max(y, 0.01), SIDE - 0.01));
    const z = floorZ + rand() * (top - floorZ);
    const nx = side === 0 ? -1 : side === 1 ? 1 : 0;
    const ny = side === 2 ? -1 : side === 3 ? 1 : 0;
    buf[w++] = x;
    buf[w++] = y;
    buf[w++] = z;
    buf[w++] = nx;
    buf[w++] = ny;
    buf[w++] = 0;
}

const header =
    'ply\nformat binary_little_endian 1.0\n' +
    `element vertex ${total}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property float nx\nproperty float ny\nproperty float nz\n' +
    'end_header\n';
const head = new TextEncoder().encode(header);
const body = new Uint8Array(buf.buffer);
const ply = new Uint8Array(head.length + body.length);
ply.set(head, 0);
ply.set(body, head.length);
writeFileSync(OUT, ply);

console.log(
    `${OUT}: ${total.toLocaleString()} pts ` +
        `(${N_GROUND.toLocaleString()} sol + ${N_BASE.toLocaleString()} socle), ` +
        `XY ${SIDE.toFixed(1)} m, Z ${(zMax - floorZ).toFixed(1)} m, ` +
        `densité sol ${(N_GROUND / (SIDE * SIDE)).toFixed(2)} pts/m², ` +
        `${(ply.length / 1e6).toFixed(1)} MB`
);
