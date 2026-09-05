#!/usr/bin/env bash
# MISSION-001 go-live: preflight → ensure the console is built → start it.
# Aborts before starting if preflight finds a blocker (unsafe for a real call).
#
#   npm run golive
#
# Honors AION_HOST / AION_TOKEN / AION_DATA_DIR / ANTHROPIC_API_KEY / PORT.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Preflight…"
if ! node src/cli/preflight.ts; then
  echo "Aborting: preflight found blockers. Fix them, then re-run \`npm run golive\`." >&2
  exit 1
fi

if [ ! -f web/dist/index.html ]; then
  echo "→ Building operator console (web/dist)…"
  npm run web:build
fi

echo "→ Starting the Validation Console…"
exec node src/server/app.ts
