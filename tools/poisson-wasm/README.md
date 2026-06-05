# tools/poisson-wasm/

Build scripts and source patches for compiling
[mkazhdan/PoissonRecon](https://github.com/mkazhdan/PoissonRecon)
into the two WASM modules shipped at
[`public/wasm/poissonrecon*.{mjs,wasm}`](../../public/wasm/).

Conceptual doc (why two builds, browser support, runtime CLI, history) :
[`docs/POISSON_WASM.md`](../../docs/POISSON_WASM.md).

## Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
  installed and activated. The build scripts look for `emcc` on `PATH`; if
  not found, they `source $EMSDK_DIR/emsdk_env.sh` (default `$HOME/src/emsdk`).
- A `git clone https://github.com/mkazhdan/PoissonRecon.git` checkout
  (default `$HOME/src/PoissonRecon`).
- Node ≥ 16 for the smoke test (Node ≥ 23 for the wasm64 build).

Override the paths via env vars:

```bash
PR_REPO=/somewhere/PoissonRecon EMSDK_DIR=/elsewhere/emsdk bash build.sh
```

## Build

```bash
cd tools/poisson-wasm
bash ./build.sh           # → public/wasm/poissonrecon.{mjs,wasm}        (wasm64)
bash ./build-wasm32.sh    # → public/wasm/poissonrecon.wasm32.{mjs,wasm} (fallback)
```

Both scripts call `patch.sh` first. `patch.sh` is idempotent and starts
with `git -C $PR_REPO checkout -- Src/` so the upstream tree is always
restored to a pristine state before patches are applied.

After a build you can leave the patches in place (they're harmless) or
strip them with:

```bash
git -C ~/src/PoissonRecon checkout -- Src/
```

## Verify

```bash
bash ./build-wasm32.sh
node ./smoke.mjs    # reconstructs a synthetic sphere, exits non-zero on failure
```

(The wasm64 binary needs Node ≥ 23 to load, so the smoke test targets
the wasm32 variant — it exercises the exact same C++ code through the
exact same patches.)

## Patches applied

See header comments in [`patch.sh`](patch.sh) for the full rationale of
each `WASM_PATCH_*` marker. Short version:

| # | File | Why |
| --- | --- | --- |
| 1 | `NestedVector.h` | `size_t` shift overflow on wasm32 → switch to `uint64_t` |
| 2 | `PoissonRecon.cpp` | drop unused `#include "Image.h"` (pulls turbojpeg, not in emcc ports) |
| 3 | `NestedVector.h` | add `<cstdint>` for the `uint64_t` from patch 1 |
| 4 | `MultiThreading.h` | `std::launch::async` → `std::launch::deferred` so `ThreadPool::ParallelSections` doesn't try to spawn threads in non-pthread emcc |
| 5 | `MyMiscellany.h` | disable `Profiler` peak-RSS sampler thread (same reason as 4; `getCurrentRSS` is unsupported in WASM anyway) |

Patches 4–5 are **required even though we pass `--parallel 1`** — the
two call sites they fix spawn threads unconditionally, regardless of
the parallel flag.

## Publishing

The build artefacts (`public/wasm/poissonrecon*`) are committed to git.
After a successful build + smoke test:

```bash
git add public/wasm/poissonrecon.mjs public/wasm/poissonrecon.wasm \
        public/wasm/poissonrecon.wasm32.mjs public/wasm/poissonrecon.wasm32.wasm
git commit -m "Recompile PoissonRecon WASM"
```
