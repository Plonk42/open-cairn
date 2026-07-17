#!/bin/bash
# Benchmark: PoissonRecon vs SSDRecon on the SAME oriented LiDAR ground cloud.
#
# Mirrors the production WASM constraint by running both solvers MONO-THREAD
# (--parallel 1). Measures wall time, peak RSS, and output vertex/triangle
# count across octree depths. Native binaries (much faster to iterate than the
# WASM build) isolate the algorithm difference.
#
#   PR_REPO=~/src/PoissonRecon (default) — must contain Bin/Linux/{PoissonRecon,SSDRecon}
#
# Usage: bash bench-ssd-vs-poisson.sh <input.ply> [depths...]
set -euo pipefail

PR_REPO="${PR_REPO:-$HOME/src/PoissonRecon}"
POISSON="$PR_REPO/Bin/Linux/PoissonRecon"
SSD="$PR_REPO/Bin/Linux/SSDRecon"
IN="${1:?usage: bench-ssd-vs-poisson.sh <input.ply> [depths...]}"
shift || true
DEPTHS=("${@:-8 9 10 11}")
# shellcheck disable=SC2206
DEPTHS=(${DEPTHS[@]})

OUT_DIR="$(dirname "$0")/out/bench"
mkdir -p "$OUT_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Common args mirror the production pipeline (poissonRecon.ts): bType 2
# (Dirichlet), samplesPerNode 1.5, mono-thread. Poisson also passes pointWeight 4.
COMMON=(--bType 2 --samplesPerNode 1.5 --parallel 1)

vcount() { # read vertex count from a binary PLY header
    grep -a -m1 'element vertex' "$1" 2>/dev/null | awk '{print $3}'
}
fcount() {
    grep -a -m1 'element face' "$1" 2>/dev/null | awk '{print $3}'
}

run() { # name binary out.ply extra-args...
    local name="$1" bin="$2" out="$3"; shift 3
    local log="$TMP/$name.time"
    /usr/bin/time -v "$bin" --in "$IN" --out "$out" "$@" >/dev/null 2>"$log" || {
        echo "  !! $name FAILED (see $log)"; tail -3 "$log"; return 1; }
    local wall peakkb
    wall=$(awk -F': ' '/Elapsed \(wall/{print $2}' "$log")
    peakkb=$(awk -F': ' '/Maximum resident/{print $2}' "$log")
    local peakmb=$(( peakkb / 1024 ))
    printf '%s|%s|%s|%s|%s\n' "$name" "$wall" "$peakmb" "$(vcount "$out")" "$(fcount "$out")"
}

INPTS=$(vcount "$IN")
echo "input: $IN  ($INPTS oriented points)"
echo "depths: ${DEPTHS[*]}   (mono-thread, bType 2, samplesPerNode 1.5)"
echo
printf '%-10s %-6s %-14s %-9s %-11s %-11s\n' solver depth wall peakMB vertices triangles
printf '%.0s-' {1..66}; echo

for d in "${DEPTHS[@]}"; do
    while IFS='|' read -r name wall peak vc fc; do
        printf '%-10s %-6s %-14s %-9s %-11s %-11s\n' "$name" "$d" "$wall" "$peak" "$vc" "$fc"
    done < <(
        run poisson "$POISSON" "$OUT_DIR/poisson-d$d.ply" "${COMMON[@]}" --depth "$d" --pointWeight 4
        run ssd     "$SSD"     "$OUT_DIR/ssd-d$d.ply"     "${COMMON[@]}" --depth "$d"
    )
    printf '%.0s-' {1..66}; echo
done

echo
echo "meshes written to $OUT_DIR/"
