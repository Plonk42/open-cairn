#!/bin/bash
# Build PoissonRecon as a WASM module — wasm64 mono-thread variant (MEMORY64).
# Exposes the CLI main() via callMain(). Uses MEMFS for I/O.
# Caller must pass `--parallel 1` at runtime.
#
# Overrides:
#   PR_REPO=/path/to/PoissonRecon  (default: $HOME/src/PoissonRecon)
#   EMSDK_DIR=/path/to/emsdk       (default: $HOME/src/emsdk, used only if
#                                   emcc is not already on PATH)
set -e
cd "$(dirname "$0")"

PR_REPO="${PR_REPO:-$HOME/src/PoissonRecon}"
EMSDK_DIR="${EMSDK_DIR:-$HOME/src/emsdk}"
PR_SRC="$PR_REPO/Src"
# Output relative to repo root (this script lives in tools/poisson-wasm/).
OUT_DIR="$(cd ../../public/wasm && pwd)"

if ! command -v emcc >/dev/null 2>&1; then
    if [[ -f "$EMSDK_DIR/emsdk_env.sh" ]]; then
        # shellcheck disable=SC1091
        source "$EMSDK_DIR/emsdk_env.sh" > /dev/null 2>&1
    else
        echo "error: emcc not found and EMSDK_DIR=$EMSDK_DIR has no emsdk_env.sh" >&2
        exit 1
    fi
fi

echo "emcc:    $(emcc --version | head -1)"
echo "PR_REPO: $PR_REPO"
echo "OUT_DIR: $OUT_DIR"

PR_REPO="$PR_REPO" bash ./patch.sh

echo "compiling PoissonRecon → wasm64 (MEMORY64, mono-thread)…"

# MEMORY64: 64-bit pointers; lifts the 4 GB heap ceiling. Requires WASM_BIGINT
#   so JS sees plain Numbers/BigInts at the boundary instead of i64-only ABI.
# No -pthread / SHARED_MEMORY: mono-thread build, no SAB / no COOP/COEP needed.
# zlib/libpng ports: emcc rebuilds them automatically (no -pthread → simple).
emcc \
    -O3 \
    -std=c++17 \
    -Wno-deprecated \
    -Wno-invalid-offsetof \
    -Wno-unused-result \
    -DRELEASE \
    -I"$PR_REPO" \
    --use-port=zlib \
    --use-port=libpng \
    "$PR_SRC/PoissonRecon.cpp" \
    -o "$OUT_DIR/poissonrecon.mjs" \
    -sWASM=1 \
    -sMEMORY64=1 \
    -sWASM_BIGINT=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=536870912 \
    -sMAXIMUM_MEMORY=8589934592 \
    -sSTACK_SIZE=16777216 \
    -sEXPORTED_RUNTIME_METHODS='["callMain","FS","HEAPU8","HEAPF32","HEAP32","lengthBytesUTF8","stringToUTF8","getExceptionMessage"]' \
    -sEXPORTED_FUNCTIONS='["_main","_malloc","_free","___cxa_demangle"]' \
    -sINVOKE_RUN=0 \
    -sFORCE_FILESYSTEM=1 \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sENVIRONMENT=worker,web,node \
    -sDISABLE_EXCEPTION_CATCHING=0 \
    -sNO_EXIT_RUNTIME=1 \
    2>&1

echo ""
echo "wasm64 build done:"
ls -lh "$OUT_DIR"/poissonrecon.mjs "$OUT_DIR"/poissonrecon.wasm
