# AION Operator Console (UX-001)

Evolves the Mission 006 Workforce Control Center into the first **operator**
surface for the [operating leverage](https://github.com/Ceoloo/aion-docs/blob/cursor/execution-object-agent-identity-6743/roadmap/operating-leverage.md) chapter.

**UI for operating AION. Code for developing AION. Runtime for authority.**

Every metric comes from Runtime/Data API responses. Every write (approve/deny)
calls a governed Runtime capability — the UI is never the business-logic layer.

The browser never holds a Runtime bearer token. All Runtime calls go through
this app's own BFF (`api/`, Vercel Serverless Functions) — see "Auth (BFF)"
below.

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
| `VITE_AION_RUNTIME_URL` | empty → same-origin `/api/runtime` (the BFF) | Set only to bypass the BFF for local dev against a local `open`-auth-mode Runtime (Vite proxies `/v1` → `http://127.0.0.1:8080`). **Never set in production.** |
| `VITE_AION_TENANT_ID` | `aion-systems` | Default `x-aion-tenant-id` (**hint only** — not authority) |

**Do not bake long-lived gateway secrets into `VITE_*`.** Vite embeds
`import.meta.env.VITE_*` in the browser bundle, so it can never hold a real
Runtime bearer token. That token, the operator login secret, and the session
signing key live only in server-side (non-`VITE_*`) Vercel env vars — see
"Auth (BFF)" below.

## Auth (BFF)

`api/` (Vercel Serverless Functions, same project, no separate hosting) is a
same-origin backend-for-frontend so the browser never sees a Runtime bearer
token:

- `POST /api/login` — operator submits a shared secret; on match, sets an
  httpOnly/Secure/SameSite=Strict signed session cookie (~12h).
- `POST /api/logout` — clears the browser's cookie. Sessions are stateless
  signed tokens (no server-side revocation list), so this is client-side
  only: a raw cookie value captured before logout stays valid until its
  natural 12h expiry. Acceptable for a single-operator tool behind
  HttpOnly/Secure/SameSite=Strict; would need a server-side session store to
  do real revocation.
- `GET /api/session` — `{authenticated: boolean}`, used by `LoginGate` to
  decide whether to show the sign-in form.
- `ALL /api/runtime/*` — the one proxy route. Verifies the session cookie,
  then forwards to the real Runtime with `Authorization: Bearer
  ${AION_GATEWAY_TOKEN}` attached server-side. Covers reads and writes alike
  (`runtime-api.ts` talks to this by default), so there's no second,
  duplicate implementation of the Runtime client on the server side.

Required **server-only** env vars (Vercel project settings — do not prefix
with `VITE_`):

| Variable | Purpose |
|---|---|
| `RUNTIME_URL` | Real Runtime origin the BFF proxies to, e.g. `https://runtime.srv1655818.hstgr.cloud` |
| `AION_GATEWAY_TOKEN` | Real Runtime bearer token (the `principal_ops_console` token from `AION_GATEWAY_API_KEYS`) |
| `CONSOLE_LOGIN_SECRET` | Shared secret the operator enters at `/api/login` |
| `SESSION_SIGNING_SECRET` | HMAC key for signing session cookies (any long random string) |

Approval decisions no longer send a client-built `decidedBy`/`actor` — under
aion-runtime PR #48 the approver identity is derived server-side from the
authenticated principal, so the Console only ever sends `{approve, note}`.

Local dev against `vite dev` alone does **not** run `api/`. Either set
`VITE_AION_RUNTIME_URL` to bypass the BFF entirely (local `open`-mode
Runtime, no login needed), or run `npx vercel dev` to exercise the BFF
functions locally (needs the four env vars above in `.env.local` /
`vercel env pull`).

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
| Runtime | Same-origin `/api/runtime/*` BFF; server-only `RUNTIME_URL` selects the Runtime |
| Tenant hint | `aion-systems` (`VITE_AION_TENANT_ID`) — **not authority** |

Deep links (`/ol001`, `/missions/:id`, …) require SPA rewrites in `vercel.json`
(already configured). After deploy, confirm `/ol001` returns the app shell (not
Vercel `NOT_FOUND`).

### Production (after OPS-001)

Do **not** deploy this Console against a stub Runtime.

1. Complete [OPS-001](https://github.com/Ceoloo/aion-docs/blob/cursor/execution-object-agent-identity-6743/roadmap/ops-001-live-runtime.md) —
   live Runtime behind Traefik with health green (production endpoint: `https://runtime.srv1655818.hstgr.cloud`, the Hostinger hostname AION keeps by decision 2026-09-25; a recovered server changes it — see aion-infra `docs/recovery-kit.md`, "Runtime hostname change").
2. Vercel project `aion-operator-console` Root Directory = `workforce-control`.
3. Build-time env: only `VITE_AION_TENANT_ID` (default tenant hint, e.g.
   `aion-systems` — **not authority**). Leave `VITE_AION_RUNTIME_URL` unset in
   production — the Console talks to its own BFF, not Runtime directly.
4. Server-only env (the BFF's, **not** `VITE_*`): `RUNTIME_URL`,
   `AION_GATEWAY_TOKEN`, `CONSOLE_LOGIN_SECRET`, `SESSION_SIGNING_SECRET` —
   see "Auth (BFF)" above.

Since the browser now calls same-origin `/api/runtime/*` instead of Runtime
directly, `AION_CORS_ORIGINS` on Runtime is no longer required for the
Console's own traffic (only needed if something still calls Runtime directly
from a browser, e.g. local dev with `VITE_AION_RUNTIME_URL` set).

Tenant isolation and actor authorization remain Gateway + Core policy. The UI
only calls governed APIs.

## Next slices (friction-driven)

- Policy-aware retry (refuse when side effects may not be idempotent)
- Console v2 from OL-001 operator behavior
- Do **not** start OL-002 until 100/100 baseline exists