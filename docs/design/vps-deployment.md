# Design Spec — Deploying the Revenue Copilot on the VPS

- **Drives:** making the copilot (and its OpenRouter/GHL credentials) actually run
  on the active VPS profile
- **Priority:** per-mission (blocked on a product decision, see below)
- **Status:** Design — states what is usable now and what the one real blocker is

## What is usable *now* (no deployment needed)

The copilot is a **CLI + library**, not a service. It already consumes a model
provider through the governed `@aion/core` path the moment a key is present:

```
$ OPENROUTER_API_KEY=sk-or-… node src/cli/evaluate.ts
  AI path: Claude (governed)      # detectProvider() → openrouter
$ node src/cli/evaluate.ts
  AI path: deterministic (no key) # detectProvider() → null
```

Verified: with `OPENROUTER_API_KEY` set, `detectProvider()` selects the
`openrouter` provider; with no key, the governed deterministic path runs. So on
the VPS today you can run the copilot CLI (a demo, an eval, or a one-shot job)
with the key exported and it routes through OpenRouter — no container, no
service, no compose change. This is the honest "it works" path.

## What is NOT built: an always-on copilot service

There is **no HTTP server, no Dockerfile, and no service entrypoint** in this
repo. The copilot has no external request surface — a "live sales call" is a
stream whose ingress and API are a **product-design decision**, not a deployment
detail. Inventing one now (an HTTP API, a queue worker, a websocket) would be
building the product's interface ahead of a mission that defines it
([Mission Before Infrastructure](https://github.com/Ceoloo/aion-docs/blob/main/engineering/principles.md)).
So this spec does **not** ship a service; it names the decision and gives the
target shape for whichever entrypoint a mission chooses.

### The decision (whoever owns MISSION-001)

| Entrypoint shape | When it fits | What it needs |
|---|---|---|
| **On-demand CLI/job** | batch scoring, nightly evals, per-call one-shot runs | nothing new — already works; schedule it or invoke per call |
| **HTTP request/response service** | a caller POSTs a call transcript / turn and gets guidance back | a small server entrypoint (`/health/live`, `/health/ready`, `/`, structured logs, SIGTERM) satisfying the [deployment contract](https://github.com/Ceoloo/aion-infra/blob/main/contracts/deployment-contract.md), plus Caddy routing |
| **Stream/worker** | continuous live-call ingestion | a worker loop + a transport (queue/websocket) — the largest, most speculative option |

Until this is chosen, an always-on deployment has nothing to deploy.

## Target shape once an entrypoint exists

When a mission picks the **HTTP service** shape, deployment is small and mirrors
`aion-runtime` exactly. The credential slots already exist in the VPS profile
([external-credentials](https://github.com/Ceoloo/aion-infra/blob/main/docs/design/external-credentials.md));
the service declares only what it needs, in its own least-privilege allowlist:

```dockerfile
# Dockerfile (target — build only once a server entrypoint exists)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# entrypoint must expose /health/live, /health/ready, / and log structured JSON
CMD ["node", "src/server.ts"]     # ← the file that does not exist yet
```

```yaml
# providers/vps/docker-compose.yml — added service (target)
services:
  revenue-copilot:
    image: ${COPILOT_IMAGE:?set COPILOT_IMAGE}
    restart: unless-stopped
    environment:
      AION_ENVIRONMENT: ${AION_ENVIRONMENT}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      # least-privilege allowlist — only what THIS service needs:
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:?set in .env}
      OPENROUTER_MODEL: ${OPENROUTER_MODEL:-anthropic/claude-3.5-sonnet}
      # GHL vars only once the CRM tool is wired AND the gateway is built (below):
      # GHL_API_KEY: ${GHL_API_KEY:?set in .env}
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

(Route it through Caddy the same way `aion-runtime` is, if it needs public
ingress.)

## GHL is deliberately not wired here yet

The compose block above leaves the `GHL_*` vars commented out on purpose. GHL is
a **side-effecting** CRM tool: sending a message or updating a contact must be
at-most-once across retries/resumes, which requires the
[Execution Gateway](https://github.com/Ceoloo/aion-core/blob/main/docs/design/execution-gateway.md)
(idempotency keys + receipts) — still design, not built in Core. Wiring CRM
*writes* before that guarantee exists is the exact double-send hazard the design
warns against. Read-only GHL (`crm.contact.read/search`, R0) is safe without it
and could be wired first; writes wait for the gateway.

## Recommended order

1. **Now:** run the copilot CLI on the VPS with `OPENROUTER_API_KEY` exported —
   OpenRouter works today.
2. **Next (product decision):** choose the copilot's entrypoint shape above. If
   HTTP, add `src/server.ts` (health + release + a guidance endpoint) and the
   Dockerfile/compose service.
3. **Later:** build the Execution Gateway in Core+Data, then wire GHL — reads
   first, writes once at-most-once is guaranteed.

## What this spec deliberately does NOT do

- Does not add a Dockerfile or a compose service for a non-existent entrypoint.
- Does not invent the copilot's external API — that is a product decision.
- Does not wire GHL writes before the gateway exists.
