#!/usr/bin/env bash
# ============================================================================
# image-boot-check.sh — certify that a built Revenue Copilot IMAGE actually boots.
# ============================================================================
# Mirrors aion-runtime's boot gate: CI "build succeeded" is NOT "artifact is
# deployable". The classic failure is a green build whose container cannot start
# (e.g. `Cannot find package '@aion/core'` because the vendored dist was not in
# the image). This script closes that gap by running the SAME image CI publishes
# and asserting the externally observable boot signals.
#
#   1. start the image on a private, throwaway docker network
#   2. assert GET /health/live = 200 and GET /health/ready = 200
#      (the copilot has NO database dependency — deterministic path is a valid
#       ready state, so no secrets/DB are needed to certify boot)
#   3. assert GET / reports the expected git_sha
#   4. packaging hygiene — no source-control metadata or TS sources in the image
#   5. tear everything down (always)
#
# Self-contained: it creates its own docker network so it behaves identically in
# CI and on a workstation. Nothing is published to a host port; the container is
# reached over a private docker network only.
#
# Usage:  scripts/image-boot-check.sh <image-ref> [expected_git_sha]
set -euo pipefail

IMAGE="${1:?usage: image-boot-check.sh <image-ref> [expected_git_sha]}"
EXPECTED_SHA="${2:-${GITHUB_SHA:-}}"

NET="copilot-bootcheck-$$"
APP="copilot-bootcheck-app-$$"

cleanup() {
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "BOOT-CHECK FAIL: $*" >&2; exit 1; }

echo "[boot-check] image under test: ${IMAGE}"
docker network create "$NET" >/dev/null

echo "[boot-check] 1/4 start the copilot HTTP service (no DB, no secrets)"
docker run -d --name "$APP" --network "$NET" \
  -e AION_ENVIRONMENT=production -e LOG_LEVEL=info \
  -e AION_ALLOW_IN_MEMORY_CONTROL_PLANE=1 \
  -e PORT=8080 -e GIT_SHA="${EXPECTED_SHA:-unknown}" \
  "$IMAGE" >/dev/null

probe() { docker run --rm --network "$NET" curlimages/curl:8.10.1 -sf --max-time 5 "$@"; }

echo "[boot-check] 2/4 wait for liveness"
ready=""
for _ in $(seq 1 30); do
  if probe "http://${APP}:8080/health/live" >/dev/null 2>&1; then ready=1; break; fi
  if ! docker ps --format '{{.Names}}' | grep -qx "$APP"; then
    echo "---- copilot container exited early; logs: ----" >&2
    docker logs "$APP" 2>&1 | tail -40 >&2
    fail "copilot container is not running"
  fi
  sleep 2
done
[ -n "$ready" ] || { docker logs "$APP" 2>&1 | tail -40 >&2; fail "/health/live never returned 200"; }

echo "[boot-check] 3/4 assert boot signals"
probe "http://${APP}:8080/health/live"  >/dev/null || fail "/health/live not 200"
probe "http://${APP}:8080/health/ready" >/dev/null || { docker logs "$APP" 2>&1 | tail -40 >&2; fail "/health/ready not 200"; }

root_body="$(probe "http://${APP}:8080/")" || fail "GET / not 200"
echo "[boot-check]   GET / -> ${root_body}"
if [ -n "${EXPECTED_SHA}" ]; then
  echo "${root_body}" | grep -q "\"git_sha\":\"${EXPECTED_SHA}\"" \
    || fail "GET / git_sha != expected ${EXPECTED_SHA}"
fi

echo "[boot-check] 4/4 packaging hygiene — no development residue in the image"
docker run --rm --entrypoint sh "$IMAGE" -c '
  set -e
  # No source-control metadata anywhere under the app root.
  [ -z "$(find /app -name .git -print -quit)" ] || { echo "found .git under /app" >&2; exit 1; }
  # The vendored @aion/core ships built dist only — no TypeScript sources.
  test -f /app/.vendor/aion-core/dist/index.js
  test ! -d /app/.vendor/aion-core/src
'

echo "[boot-check] PASS — ${IMAGE} boots and serves /health/ready"
