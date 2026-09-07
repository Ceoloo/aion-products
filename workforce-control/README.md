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
| `/missions` | **Mission Control** — filter active/completed/failed, inspect entry points |
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

## Next slices

- Create mission from business objective (`POST /v1/missions/run`)
- Retry allowed failed operations
- Workforce Hub (autonomy grants, scorecards)
- Client Ops UI (GHL-facing; AION remains governance truth)
