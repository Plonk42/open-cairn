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
