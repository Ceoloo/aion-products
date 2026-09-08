# Design Spec — Deploying the Revenue Copilot on the VPS

- **Drives:** making the copilot (and its OpenRouter/GHL credentials) actually run
  on the active VPS profile
- **Priority:** per-mission
- **Status:** **HTTP entrypoint implemented** (`src/server.ts`) — CLI path still
  works; compose consumer ready to enable once the image is built and keys are
  rotated into `/opt/aion/.env`

## Decision (MISSION-001)

Entrypoint shape **#2 — HTTP request/response** was chosen:

| Shape | Status |
|---|---|
| 1. On-demand CLI/job | Still works (`node src/cli/evaluate.ts` / `demo.ts`) |
| 2. HTTP service | **Implemented** — turn-stream sessions over HTTP |
| 3. Stream/worker | Deferred (speculative continuous ingestion) |

MISSION-001 already defines the product loop as consuming a **turn stream**, not
owning telephony. The HTTP surface is that stream’s ingress — not a new product.

## What is usable *now*

### CLI (no container)

```
$ OPENROUTER_API_KEY=sk-or-… node src/cli/evaluate.ts
  AI path: openrouter (governed)   # detectProvider() → openrouter
$ node src/cli/evaluate.ts
  AI path: deterministic (no key)
```

### HTTP service (local)

```
$ npm run serve
$ curl -s localhost:8080/health/ready
$ curl -s -X POST localhost:8080/v1/sessions -H 'content-type: application/json' -d '{…}'
```

Endpoints:

| Method | Path | Role |
|---|---|---|
| GET | `/health/live` | Liveness |
| GET | `/health/ready` | Readiness (no DB; accepting traffic) |
| GET | `/` | Release identity |
| POST | `/v1/sessions` | Begin call session (`industry` + `context`) |
| POST | `/v1/sessions/:id/turns` | Ingest one turn → live guidance |
| POST | `/v1/sessions/:id/feedback` | Record rep feedback |
| POST | `/v1/sessions/:id/finish` | Freeze `CallIntelligence` report |

Sessions are **in-process memory** (TTL via `COPILOT_SESSION_TTL_MS`). Durable
governance still rides `@aion/core` / optional Runtime client on each AI step —
this HTTP layer does not replace the Execution Gateway.

## Container + Compose (target on VPS)

```dockerfile
# Dockerfile in aion-products (shipped)
CMD ["node", "src/server.ts"]
```

```yaml
# providers/vps/docker-compose.yml — revenue-copilot service (see aion-infra PR)
services:
  revenue-copilot:
    image: ${COPILOT_IMAGE:?set COPILOT_IMAGE}
    restart: unless-stopped
    environment:
      AION_ENVIRONMENT: ${AION_ENVIRONMENT}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      SERVICE_VERSION: ${SERVICE_VERSION:-0.1.0}
      GIT_SHA: ${GIT_SHA:-unknown}
      PORT: "8080"
      # least-privilege allowlist — only what THIS service needs:
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:?set in .env}
      OPENROUTER_MODEL: ${OPENROUTER_MODEL:-anthropic/claude-3.5-sonnet}
      # GHL vars stay commented until read path is wired; writes wait for gateway:
      # GHL_API_KEY: ${GHL_API_KEY}
      # GHL_LOCATION_ID: ${GHL_LOCATION_ID}
      # GHL_API_VERSION: ${GHL_API_VERSION:-2021-07-28}
    expose:
      - "8080"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 10s
      retries: 3
    stop_grace_period: 30s
    networks: [internal]
```

Route via Traefik (OPS-001) the same way as Runtime when public ingress is needed.
Do **not** inject OpenRouter/GHL keys into the `aion-runtime` service allowlist.

## GHL — writes certified via the Execution Gateway

GHL **writes** (`crm.note.create`, `crm.opportunity.update` stage change) are now
exercised end-to-end through the Runtime **Execution Gateway** with at-most-once
semantics (external side-effect ledger + idempotency key + R2 human gate), proven
by the ghl-live capability matrix (`aion-runtime`: `npm run proof:ghl-live-capability`).
This service still does **not** wire GHL writes directly — it routes them through
the gateway, never inventing send.

Read-only GHL (`crm.contact.read` / search) uses the same `GHL_*` slots.

## Operator standing item

Rotate OpenRouter + GHL keys and place values in `/opt/aion/.env` (root-owned
`0600`). Placeholders live in `aion-infra` `providers/vps/.env.example`.

## Explicit non-goals

- Not continuous live-call streaming (shape #3)
- Not autonomous customer messaging
- Not replacing Runtime’s Execution Gateway
- Not counting HTTP smoke tests as OL-001 mission credit
