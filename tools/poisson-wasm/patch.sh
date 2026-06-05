#!/bin/bash
# Apply in-place patches to a clean PoissonRecon source tree so it builds
# cleanly with emscripten in mono-thread mode.
#
# Behaviour:
#   1. `git -C $PR_REPO checkout -- Src/` resets the tree to a known-clean
#      state (assumes a vanilla `git clone` of mkazhdan/PoissonRecon at any
#      commit). Run nothing destructive elsewhere — only Src/ is touched.
#   2. Apply each patch via `sed`. Markers (WASM_PATCH_*) guard against
#      double-application even if step 1 is skipped.
#
# Override the source location with:   PR_REPO=/path/to/PoissonRecon bash patch.sh
#
# To clean up the upstream tree after a build:
#   git -C $PR_REPO checkout -- Src/
set -e

PR_REPO="${PR_REPO:-$HOME/src/PoissonRecon}"
SRC="$PR_REPO/Src"

if [[ ! -d "$SRC" ]]; then
    echo "error: PoissonRecon source not found at $SRC" >&2
    echo "       set PR_REPO=/path/to/PoissonRecon to override" >&2
    exit 1
fi

# Restore clean state from upstream so patches apply against pristine sources.
if [[ -d "$PR_REPO/.git" ]]; then
    git -C "$PR_REPO" checkout -- Src/ 2>/dev/null || true
fi

# ---- Patch 1: NestedVector.h size_t shift overflow ---------------------------
# `((size_t)1)<<(LogSize*(Depth+1))` overflows when LogSize=20, Depth>=2 on
# wasm32 (size_t = 32 bits). uint64_t is correct on both wasm32 and wasm64.
NV="$SRC/NestedVector.h"
if ! grep -q "WASM_PATCH_NV" "$NV"; then
    sed -i \
        -e 's|static const size_t _MaxSize = ((size_t)1)<<(LogSize\*(Depth+1));|static const uint64_t _MaxSize = ((uint64_t)1)<<(LogSize*(Depth+1)); // WASM_PATCH_NV|' \
        "$NV"
    echo "patched: $NV (uint64_t _MaxSize)"
fi

# ---- Patch 2: drop Image.h include in PoissonRecon.cpp -----------------------
# Image.h transitively pulls turbojpeg, not in the emcc port set, and is unused.
PR="$SRC/PoissonRecon.cpp"
if ! grep -q "WASM_PATCH_PR" "$PR"; then
    sed -i \
        -e 's|^#include "Image.h"|// #include "Image.h" // WASM_PATCH_PR (unused, dropped for emcc)|' \
        "$PR"
    echo "patched: $PR (dropped Image.h)"
fi

# ---- Patch 3: NestedVector uint64_t requires cstdint -------------------------
if ! grep -q "WASM_PATCH_CSTDINT" "$NV"; then
    sed -i '1i #include <cstdint> // WASM_PATCH_CSTDINT' "$NV"
    echo "patched: $NV (added <cstdint>)"
fi

# ---- Patch 4: std::async( std::launch::async ) → std::launch::deferred -------
# `ThreadPool::ParallelSections` in MultiThreading.h spawns threads via
# std::async unconditionally (it ignores `--parallel 1`) during iso-surface
# extraction (FEMTree.LevelSet.3D.inl). Mono-thread emcc has no pthread
# runtime → libc++ throws `thread constructor failed: Not supported`.
# `std::launch::deferred` runs the callable synchronously on the caller's
# thread when .get() is invoked — same API surface, zero threads.
MT="$SRC/MultiThreading.h"
if ! grep -q "WASM_PATCH_DEFERRED" "$MT"; then
    sed -i \
        -e 's|std::async( std::launch::async ,|std::async( std::launch::deferred , /* WASM_PATCH_DEFERRED */|g' \
        "$MT"
    echo "patched: $MT (launch::async → launch::deferred)"
fi

# ---- Patch 5: Profiler peak-memory sampler thread ----------------------------
# `Profiler profiler(20)` in PoissonRecon.cpp spawns a std::thread that polls
# RSS every 20 ms. Mono-thread emcc → throws on construction. Disable by
# rewriting `if( ms )` to a constant-false guard; the else branch is already
# the no-thread code path. Peak-memory reporting becomes a no-op in WASM,
# which is fine (getCurrentRSS isn't supported there anyway).
MM="$SRC/MyMiscellany.h"
if ! grep -q "WASM_PATCH_PROFILER" "$MM"; then
    sed -i \
        -e 's|if( ms )$|if( 0 ) /* WASM_PATCH_PROFILER */|' \
        "$MM"
    echo "patched: $MM (Profiler thread disabled)"
fi

echo "all 5 patches applied (idempotent) — ready for mono-thread emcc build"
