/**
 * Pre-initialize the `laz-perf` Emscripten module so the WASM is fetched
 * from a real Vite-bundled asset URL instead of the default
 * `import.meta.url`-relative path, which resolves to the SPA fallback
 * (`index.html`) when the call originates from a Worker — hence the
 * `expected magic word 00 61 73 6d, found 3c 21 64 6f` crash users saw.
 *
 * Importing the `.wasm` with the `?url` suffix tells Vite to copy the file
 * into the output bundle with a content hash and return the final URL.
 * Same code path works in dev and in the production GitHub Pages build.
 *
 * Concurrency: the single WASM heap is *not* re-entrant — running multiple
 * `decompressChunk` calls in parallel against it leaks/corrupts allocator
 * metadata, which manifests as `Cannot enlarge memory, asked to go up to
 * 3.6 GB`. We expose a single-flight queue so callers (nodes within a tile
 * and tiles within a request) can keep their nice `Promise.all(...)` shape
 * while only one decompress is actually running at a time.
 */
import { createLazPerf } from 'laz-perf';
// `?url` is a Vite-specific suffix that resolves to the asset's final URL.
import lazPerfWasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url';

let promise: ReturnType<typeof createLazPerf> | null = null;

/** Singleton, lazily initialized on first use. */
export function getLazPerf(): ReturnType<typeof createLazPerf> {
    if (!promise) {
        promise = createLazPerf({ locateFile: () => lazPerfWasmUrl });
    }
    return promise;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Serialize a function that touches the laz-perf WASM heap. Use this around
 * every `Copc.loadPointDataView` call (or any raw `decompressChunk`/
 * `decompressFile`); the rest of the pipeline (HTTP fetch, point sieving,
 * normals, mesh) is pure JS and stays parallel-friendly.
 */
export function runOnLazPerf<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
}

