#!/usr/bin/env bash
#
# Bootstrap the canonical @aion/core control-plane kernel as a local, built
# package that aion-products consumes via a `file:` dependency.
#
# @aion/core is a separate repo in the six-repo constitution and is not
# published to a registry, and it ships no committed dist/. So we clone it at a
# pinned commit and build it here. Production deployment (aion-runtime) composes
# the durable wiring; this script only makes the CONTRACTS consumable for
# development, typecheck, tests, and CI. aion-products never code-depends on
# aion-runtime.
#
# Idempotent: skips the clone+build if the vendored dist is already present.
set -euo pipefail

# Pinned aion-core commit (bump deliberately, as a reviewed change).
CORE_REPO="https://github.com/Ceoloo/aion-core"
CORE_SHA="5ea731a67b4ad40575cbf0e5893f665c8d02ea8c"
DEST=".vendor/aion-core"

if [ -f "$DEST/dist/index.js" ]; then
  echo "@aion/core already vendored at $DEST (dist present) — skipping."
  exit 0
fi

echo "Vendoring @aion/core @ ${CORE_SHA} …"
BUILD_DIR="$(mktemp -d)"
GIT_LFS_SKIP_SMUDGE=1 git clone --no-single-branch "$CORE_REPO" "$BUILD_DIR/aion-core"
git -C "$BUILD_DIR/aion-core" checkout "$CORE_SHA"
(
  cd "$BUILD_DIR/aion-core"
  npm ci
  npm run build
)

# Keep only what a consumer needs: the built dist + package manifest + README.
# This leaves the dev toolchain (vitest/vite/esbuild, tests, sources) out of the
# product's dependency tree entirely.
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$BUILD_DIR/aion-core/dist" "$DEST/dist"
cp "$BUILD_DIR/aion-core/README.md" "$DEST/README.md" 2>/dev/null || true
# Emit a trimmed manifest: runtime fields + `dependencies` only. Dropping
# devDependencies keeps the product's dependency tree free of @aion/core's dev
# toolchain (vitest/tsx/esbuild) when installed as a file: dependency.
node -e '
  const p = require("'"$BUILD_DIR"'/aion-core/package.json");
  const { name, version, type, exports, main, types, license, dependencies } = p;
  require("fs").writeFileSync(
    "'"$DEST"'/package.json",
    JSON.stringify({ name, version, private: true, type, exports, main, types, license, dependencies }, null, 2) + "\n",
  );
'
rm -rf "$BUILD_DIR"
echo "@aion/core built and vendored (dist + trimmed manifest) at $DEST"
