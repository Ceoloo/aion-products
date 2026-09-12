# AION Operator Console (UX-001)

Evolves the Mission 006 Workforce Control Center into the first **operator**
surface for the [operating leverage](https://github.com/Ceoloo/aion-docs/blob/cursor/execution-object-agent-identity-6743/roadmap/operating-leverage.md) chapter.

**UI for operating AION. Code for developing AION. Runtime for authority.**

Every metric comes from Runtime/Data API responses. Every write (approve/deny)
calls a governed Runtime capability — the UI is never the business-logic layer.

## Surfaces

| Route | Role |
|---|---|
| `/` | **Command Center** — holding OL scoreboard, portfolio, mission health, economics |
| `/ol001` | **OL-001 scoreboard** — 100-mission heartbeat (pipeline ≠ attributed ≠ collected) |
| `/missions` | **Mission Control** — filter active/completed/failed, inspect entry points |
| `/missions/new` | **Launch** — `POST /v1/missions/run` (canonical contract, versioned workflows) |
| `/missions/:id` | Mission detail — economics + lineage |
| `/executions/:id` | Execution object — agent, tenant/company scope, service, tree |
| Approvals panel | Inspect + **Approve / Deny** via `POST /v1/approvals/:id/decision` |

## Run against local Runtime

```bash
# Terminal 1 — Runtime (from aion-runtime)
export MIGRATION_DATABASE_URL=postgresql://aion_migrator:ci_migrator@127.0.0.1:5432/aion_data
export DATABASE_URL=postgresql://aion_app:ci_app@127.0.0.1:5432/aion_data
export DATABASE_SSL=false
export PORT=8080
npm run migrate && npm start

# Terminal 2 — Operator Console
cd workforce-control
cp .env.example .env   # optional
npm install
npm run dev
```

Open http://127.0.0.1:5174

### Env

| Variable | Default | Purpose |
|---|---|---|
| `VITE_AION_RUNTIME_URL` | empty (Vite proxies `/v1` → `http://127.0.0.1:8080`) | Runtime base URL |
| `VITE_AION_TENANT_ID` | `aion-systems` | Default `x-aion-tenant-id` |
| `VITE_AION_OPERATOR_ID` | `operator-console` | `decidedBy` on approval decisions |

## Scripts

From `workforce-control/`:

- `npm run dev` — Vite on :5174
- `npm run build`
- `npm run typecheck`

From repo root:

- `npm run workforce:dev`
- `npm run workforce:build`
- `npm run workforce:typecheck`

## Production (live)

| | |
|---|---|
| Console | https://aion-operator-console.vercel.app |
| Runtime | `VITE_AION_RUNTIME_URL` baked at build (currently Hostinger Runtime) |
| Tenant hint | `aion-systems` (`VITE_AION_TENANT_ID`) — **not authority** |

Deep links (`/ol001`, `/missions/:id`, …) require SPA rewrites in `vercel.json`
(already configured). After deploy, confirm `/ol001` returns the app shell (not
Vercel `NOT_FOUND`).

### Production (after OPS-001)

Do **not** deploy this Console against a stub Runtime.

1. Complete [OPS-001](https://github.com/Ceoloo/aion-docs/blob/cursor/execution-object-agent-identity-6743/roadmap/ops-001-live-runtime.md) —
   live Runtime behind Traefik with health green (Hostinger Runtime is the current production endpoint until `runtime.aionsystems.ai` DNS is cut over).
2. Vercel project `aion-operator-console` Root Directory = `workforce-control`.
3. Build-time env:

| Variable | Value |
|---|---|
| `VITE_AION_RUNTIME_URL` | Production Runtime origin (Hostinger URL today) |
| `VITE_AION_TENANT_ID` | default tenant hint (e.g. `aion-systems`) — **not authority** |
| `VITE_AION_OPERATOR_ID` | `decidedBy` hint — **not authority** |

4. On Runtime `/opt/aion/.env`, set `AION_CORS_ORIGINS` to include
   `https://aion-operator-console.vercel.app` (and preview origins if needed).
   Runtime CORS methods must allow `GET, POST, PATCH, OPTIONS` so mission close
   works from the browser.

Tenant isolation and actor authorization remain Gateway + Core policy. The UI
only calls governed APIs.

## Next slices (friction-driven)

- Policy-aware retry (refuse when side effects may not be idempotent)
- Console v2 from OL-001 operator behavior
- Do **not** start OL-002 until 100/100 baseline exists