#!/usr/bin/env bash
# MacroCode — sürüm alanlarını günceller (commit/tag/push YAPMAZ).
#
# Kullanım: bash scripts/release.sh 0.2.3
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "kullanım: bash scripts/release.sh <X.Y.Z>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "→ package.json + package-lock.json: $VERSION"
npm version "$VERSION" --no-git-tag-version >/dev/null

echo "→ src-tauri/Cargo.toml: $VERSION"
sed -i -E "s/^version = \"[^\"]+\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

echo "→ src-tauri/tauri.conf.json: $VERSION"
sed -i -E "0,/\"version\": \"[^\"]+\"/s//\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

echo "→ Cargo.lock güncelleniyor"
cargo check --quiet --lib --manifest-path src-tauri/Cargo.toml

echo
echo "Sürüm $VERSION hazır. Sonraki adımlar:"
echo "  1. npm test && npm run build"
echo "  2. cargo test --lib --manifest-path src-tauri/Cargo.toml"
echo "  3. Git commit + tag + push (RELEASE_GUIDE.md bölüm 5)"
