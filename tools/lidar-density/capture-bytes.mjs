/**
 * What a capture downloads, against what the quality dial announces.
 *
 * Reads only the COPC hierarchies (a few kB per tile, no point decoded) and
 * compares, for one capture rectangle:
 *   - `estimateCapture` from src/lib/lidarResolution.ts, fed the pyramid
 *     `measureCapturePyramid` would return (the 4 tiles nearest the centre);
 *   - the bytes the pipeline plans: nodes meeting the rectangle;
 *   - the bytes it planned before, against the enclosing circle's square;
 *   - the points that fall inside the rectangle, pro-rated per node by area.
 *
 * Usage (Node >= 22.18, which runs the imported .ts directly):
 *   node tools/lidar-density/capture-bytes.mjs --lng=5.7876 --lat=45.2878 \
 *        --width=800 --length=750 [--bearing=0] [--resolution=0]
 */
import { Copc, Key } from 'copc';
import proj4 from 'proj4';
import { estimateCapture } from '../../src/lib/lidarResolution.ts';

const args = new Map(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
}));
const LNG = Number(args.get('lng') ?? 5.7876);
const LAT = Number(args.get('lat') ?? 45.2878);
const WIDTH = Number(args.get('width') ?? 800);
const LENGTH = Number(args.get('length') ?? 750);
const BEARING = Number(args.get('bearing') ?? 0);
const RESOLUTION = Number(args.get('resolution') ?? 0);
/** Levels the resolution stops map to; the last stop is every level. */
const STOP_LEVELS = 5;

proj4.defs(
    'EPSG:2154',
    '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 '
    + '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
const to2154 = proj4('EPSG:4326', 'EPSG:2154');
const [X0, Y0] = to2154.forward([LNG, LAT]);

// Same as l93RectAxes: the length axis in L93, width axis its left-perpendicular.
const rad = (BEARING * Math.PI) / 180;
const [bx, by] = to2154.forward([
    LNG + (Math.sin(rad) * 10) / (111_320 * Math.cos((LAT * Math.PI) / 180)),
    LAT + (Math.cos(rad) * 10) / 111_320,
]);
const ul = Math.hypot(bx - X0, by - Y0);
const UX = (bx - X0) / ul;
const UY = (by - Y0) / ul;
const RADIUS = Math.hypot(WIDTH, LENGTH) / 2;

async function findTiles() {
    const dLat = (RADIUS * 1.2) / 111_320;
    const dLng = (RADIUS * 1.2) / (111_320 * Math.cos((LAT * Math.PI) / 180));
    const params = new URLSearchParams({
        service: 'WFS', version: '2.0.0', request: 'GetFeature',
        typenames: 'IGNF_LIDAR-HD_METADONNEE:metadata', srsname: 'EPSG:4326',
        bbox: `${LNG - dLng},${LAT - dLat},${LNG + dLng},${LAT + dLat},EPSG:4326`,
        outputFormat: 'application/json', count: '69',
    });
    const res = await fetch(`https://data.geopf.fr/wfs/ows?${params}`);
    const data = await res.json();
    return data.features.map((f) => {
        const [x, y] = f.properties.coordonnees_nw.split('-').map(Number);
        return {
            url: f.properties.url_npl,
            name: f.properties.url_npl.split('/').pop(),
            bbox: { minX: x * 1000, maxX: x * 1000 + 1000, minY: y * 1000 - 1000, maxY: y * 1000 },
        };
    }).filter(({ bbox: b }) => b.maxX >= X0 - RADIUS && b.minX <= X0 + RADIUS
        && b.maxY >= Y0 - RADIUS && b.minY <= Y0 + RADIUS);
}

function getter(url) {
    return async (begin, end) => {
        for (let attempt = 0; ; attempt++) {
            const res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
            if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
            await res.body?.cancel();
            if (attempt >= 4) throw new Error(`${res.status} on ${url}`);
        }
    };
}

function nodeBox([d, kx, ky], cube) {
    const sx = (cube[3] - cube[0]) / (1 << d);
    const sy = (cube[4] - cube[1]) / (1 << d);
    const minX = cube[0] + kx * sx;
    const minY = cube[1] + ky * sy;
    return { minX, minY, maxX: minX + sx, maxY: minY + sy };
}

// Area of a node box inside the rectangle, by sampling a 16×16 grid.
function insideFraction(b) {
    let hit = 0;
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
            const dx = b.minX + ((i + 0.5) / 16) * (b.maxX - b.minX) - X0;
            const dy = b.minY + ((j + 0.5) / 16) * (b.maxY - b.minY) - Y0;
            const along = dx * UX + dy * UY;
            const across = -dx * UY + dy * UX;
            if (Math.abs(along) <= LENGTH / 2 && Math.abs(across) <= WIDTH / 2) hit++;
        }
    }
    return hit / 256;
}

const squareBox = { minX: X0 - RADIUS, maxX: X0 + RADIUS, minY: Y0 - RADIUS, maxY: Y0 + RADIUS };
const overlaps = (b, q) => b.maxX >= q.minX && b.minX <= q.maxX && b.maxY >= q.minY && b.minY <= q.maxY;

// Separating axes: the box's two, then the rectangle's two (as boxMeetsRect).
function overlapsRect(b) {
    const cx = (b.minX + b.maxX) / 2 - X0;
    const cy = (b.minY + b.maxY) / 2 - Y0;
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    const hl = LENGTH / 2; const hw = WIDTH / 2;
    const ax = Math.abs(UX); const ay = Math.abs(UY);
    return Math.abs(cx) <= hx + hl * ax + hw * ay
        && Math.abs(cy) <= hy + hl * ay + hw * ax
        && Math.abs(cx * UX + cy * UY) <= hl + hx * ax + hy * ay
        && Math.abs(-cx * UY + cy * UX) <= hw + hx * ay + hy * ax;
}

function maxLevelFor(spacing) {
    if (RESOLUTION <= 0) return Infinity;
    return Math.max(0, Math.ceil(Math.log2(spacing / RESOLUTION) - 0.05));
}

/** Every non-empty node of the tile, with its box. */
async function allNodes(tile) {
    const get = getter(tile.url);
    const copc = await Copc.create(get);
    const cube = copc.info.cube;
    const out = [];
    const queue = [copc.info.rootHierarchyPage];
    while (queue.length) {
        const { nodes, pages } = await Copc.loadHierarchyPage(get, queue.shift());
        for (const [k, n] of Object.entries(nodes)) {
            if (!n?.pointCount) continue;
            const key = Key.parse(k);
            out.push({ level: key[0], box: nodeBox(key, cube), node: n });
        }
        for (const p of Object.values(pages)) if (p) queue.push(p);
    }
    return { copc, cube, nodes: out };
}

/** Cumulative densities per resolution stop, as `probeTile` computes them. */
function tilePyramid(nodes, areaM2) {
    const perStop = new Array(STOP_LEVELS + 1).fill(0);
    for (const n of nodes) perStop[Math.min(n.level, STOP_LEVELS)] += n.node.pointCount;
    let running = 0;
    return perStop.map((c) => {
        running += c;
        return running / areaM2;
    });
}

const tiles = await findTiles();
console.log(`zone ${WIDTH}×${LENGTH} m, bearing ${BEARING}°, resolution ${RESOLUTION || 'max'}, ${tiles.length} tiles`);

const acc = { square: 0, rect: 0, rectPts: 0, insidePts: 0, insideBytes: 0 };
const probes = [];
const byLevel = [];
for (const tile of tiles) {
    const { copc, cube, nodes } = await allNodes(tile);
    const maxLevel = maxLevelFor(copc.info.spacing);
    const area = (cube[3] - cube[0]) * (cube[4] - cube[1]);
    const dist = Math.hypot((tile.bbox.minX + tile.bbox.maxX) / 2 - X0, (tile.bbox.minY + tile.bbox.maxY) / 2 - Y0);
    probes.push({ dist, pyramid: tilePyramid(nodes, area) });
    for (const n of nodes.filter((m) => m.level <= maxLevel)) {
        const l = (byLevel[n.level] ??= { square: 0, rect: 0, rectPts: 0, inside: 0 });
        if (overlaps(n.box, squareBox)) {
            acc.square += n.node.pointDataLength;
            l.square += n.node.pointDataLength;
        }
        if (overlapsRect(n.box)) {
            acc.rect += n.node.pointDataLength;
            acc.rectPts += n.node.pointCount;
            l.rect += n.node.pointDataLength;
            l.rectPts += n.node.pointCount;
        }
        const f = insideFraction(n.box);
        acc.insidePts += f * n.node.pointCount;
        acc.insideBytes += f * n.node.pointDataLength;
        l.inside += f * n.node.pointDataLength;
    }
    console.log(`  ${tile.name}: spacing ${copc.info.spacing.toFixed(2)} m, cube ${(cube[3] - cube[0]).toFixed(0)} m, `
        + `${(copc.header.pointCount / 1e6).toFixed(1)} M pts`);
}
probes.sort((a, b) => a.dist - b.dist);
const near = probes.slice(0, 4);
const pyramid = near[0].pyramid.map((_, i) => near.reduce((s, p) => s + p.pyramid[i], 0) / near.length);
const est = estimateCapture(WIDTH, LENGTH, RESOLUTION, pyramid);
const MB = (b) => (b / 1e6).toFixed(1);
const M = (p) => (p / 1e6).toFixed(2);
console.log(`pyramid  : [${pyramid.map((d) => d.toFixed(3)).join(', ')}]`);
console.log(`estimate : ${M(est.points)} M pts inside, ${MB(est.bytes)} MB downloaded`);
console.log(`inside   : ${M(acc.insidePts)} M pts, ${MB(acc.insideBytes)} MB`);
console.log(`fetched  : ${M(acc.rectPts)} M pts, ${MB(acc.rect)} MB — estimate ×${(est.bytes / acc.rect).toFixed(2)}`);
console.log(`square   : ${MB(acc.square)} MB (selection against the enclosing circle's AABB)`);
console.log('per level: square MB / fetched MB / inside MB, fetched B/pt');
byLevel.forEach((l, i) => l && console.log(
    `  ${i}: ${MB(l.square)} / ${MB(l.rect)} / ${MB(l.inside)}, ${(l.rect / l.rectPts).toFixed(2)}`,
));
