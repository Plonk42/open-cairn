#!/usr/bin/env bash
# tools/publish-showcase.sh
#
# Upload scene .zip files (exported from the LiDAR Studio) to the
# "showcase-assets" GitHub release, then register the new scene IDs
# in public/showcase/index.json.
#
# Usage:
#   ./tools/publish-showcase.sh scene-YYYYMMDD-HHMMSS.zip [...]
#
# Requirements:
#   - gh (GitHub CLI) — https://cli.github.com, must be authenticated
#   - node (comes with the project's Node.js environment)
#   - unzip

set -euo pipefail

RELEASE_TAG="showcase-assets"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INDEX_FILE="$SCRIPT_DIR/../public/showcase/index.json"

# ── Preflight checks ────────────────────────────────────────────────────────

for cmd in gh node unzip; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "✗ Missing required command: $cmd" >&2
        exit 1
    fi
done

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <scene-*.zip> [...]" >&2
    echo "" >&2
    echo "Export a scene from the LiDAR Studio (\"Exporter cette vue\" → \"Télécharger\")," >&2
    echo "then pass the downloaded .zip file(s) to this script." >&2
    exit 1
fi

if [[ ! -f "$INDEX_FILE" ]]; then
    echo "✗ index.json not found: $INDEX_FILE" >&2
    exit 1
fi

# ── Ensure the GitHub release exists ────────────────────────────────────────

if ! gh release view "$RELEASE_TAG" --json tagName -q .tagName 2>/dev/null; then
    echo "→ Release '$RELEASE_TAG' not found, creating it..."
    gh release create "$RELEASE_TAG" \
        --title "Showcase assets" \
        --notes "LiDAR studio showcase: binary scene assets (geometry + thumbnails). Not a software release." \
        --prerelease
    echo "✓ Release '$RELEASE_TAG' created."
fi

# ── Process each .zip ───────────────────────────────────────────────────────

TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

NEW_IDS=()

for zipfile in "$@"; do
    if [[ ! -f "$zipfile" ]]; then
        echo "✗ File not found: $zipfile" >&2
        exit 1
    fi

    tmpdir="$TMPDIR_BASE/$(basename "$zipfile" .zip)"
    mkdir -p "$tmpdir"
    unzip -q "$zipfile" -d "$tmpdir"

    # Infer the scene ID from the .bin filename inside the archive.
    binfile=$(find "$tmpdir" -maxdepth 2 -name "*.bin" | sort | head -n 1)
    if [[ -z "$binfile" ]]; then
        echo "✗ No .bin file found in $(basename "$zipfile") — is this a valid scene export?" >&2
        exit 1
    fi
    scene_id=$(basename "$binfile" .bin)

    echo ""
    echo "→ Publishing '$scene_id'..."

    for ext in bin json webp; do
        asset="$tmpdir/${scene_id}.${ext}"
        if [[ ! -f "$asset" ]]; then
            echo "  ⚠  ${scene_id}.${ext} not found in archive — skipping." >&2
            continue
        fi
        gh release upload "$RELEASE_TAG" "$asset" --clobber
        echo "  ↑ ${scene_id}.${ext}"
    done

    NEW_IDS+=("$scene_id")
done

# ── Update public/showcase/index.json ───────────────────────────────────────

echo ""
echo "→ Updating index.json..."

node - "$INDEX_FILE" "${NEW_IDS[@]}" <<'NODE_SCRIPT'
const fs = require('fs');
const [,, indexPath, ...newIds] = process.argv;
const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
let added = 0;
for (const id of newIds) {
    if (!idx.scenes.includes(id)) {
        idx.scenes.push(id);
        added++;
        console.log(`  + ${id}`);
    } else {
        console.log(`  = ${id} (already listed, skipped)`);
    }
}
fs.writeFileSync(indexPath, JSON.stringify(idx, null, 4) + '\n');
if (added > 0) {
    console.log(`✓ index.json updated (${added} new ID${added > 1 ? 's' : ''}).`);
} else {
    console.log('✓ index.json unchanged.');
}
NODE_SCRIPT

# ── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "✓ All done! Commit and push to trigger a GitHub Pages deployment:"
echo ""

# Build the commit message
IDS_JOINED=$(IFS=', '; echo "${NEW_IDS[*]}")
echo "  git add public/showcase/index.json \\"
echo "    && git commit -m 'feat(showcase): publish ${IDS_JOINED}' \\"
echo "    && git push"
echo ""
echo "The GitHub Actions workflow will download the release assets and"
echo "rebuild the site automatically."
