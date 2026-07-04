/**
 * One-shot migration: bake per-point `heightAboveGround` (+ `vegHeightAuto`)
 * into existing showcase `.bin` scenes so the gallery no longer recomputes them
 * on the main thread at load time.
 *
 * `decodeShowcaseGeometry` already runs the (legacy) height reconstruction for
 * scenes lacking the baked buffer, so we just decode → re-encode: the freshly
 * attached heights flow into the new `shadedHeight` buffer (hasHeight=true).
 *
 * Run with Node ≥22 (native TS strip):
 *   node tools/showcase/bake-heights.ts public/showcase/scene-XXXX.bin ...
 * With no args it processes every public/showcase/*.bin.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeShowcaseGeometry, encodeShowcaseGeometry } from '../../src/lib/showcaseScene.ts';

const here = dirname(fileURLToPath(import.meta.url));
const showcaseDir = join(here, '..', '..', 'public', 'showcase');

function listScenes(): string[] {
    const args = process.argv.slice(2);
    if (args.length > 0) return args;
    return readdirSync(showcaseDir)
        .filter((f) => f.endsWith('.bin'))
        .map((f) => join(showcaseDir, f));
}

async function bake(path: string): Promise<void> {
    const before = readFileSync(path);
    const ab = before.buffer.slice(before.byteOffset, before.byteOffset + before.byteLength) as ArrayBuffer;
    const { shaded, mesh } = await decodeShowcaseGeometry(ab);
    if (!shaded) {
        console.log(`skip  ${path} — no shaded cloud`);
        return;
    }
    if (!shaded.heightAboveGround) {
        console.log(`skip  ${path} — height reconstruction produced nothing`);
        return;
    }
    const out = await encodeShowcaseGeometry({ shaded, mesh });
    writeFileSync(path, out);
    const mb = (n: number) => (n / 1048576).toFixed(2);
    console.log(
        `baked ${path} — ${shaded.pointCount} pts, vegHeightAuto=${shaded.vegHeightAuto?.toFixed(1)} `
        + `| ${mb(before.length)} MB → ${mb(out.length)} MB`,
    );
}

for (const scene of listScenes()) {
    await bake(scene);
}
