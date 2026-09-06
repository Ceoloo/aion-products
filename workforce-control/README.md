# AION Workforce Control Center (Mission 006)

Read-only pane of glass over canonical Runtime / Data truth (economics, missions,
executions, approvals). **Numbers only come from API responses** — no mock KPIs.

## Screens

1. **Holding Overview** `/` — portfolio labels, mission health, workforce, economics, risk
2. **Mission Detail** `/missions/:missionId` — economics rollup + lineage
3. **Execution Detail** `/executions/:executionId` — full execution object + root tree
4. **Approval queue** — side panel (inspect-only)

## Run against local Runtime

```bash
# Terminal 1 — Runtime (from aion-runtime)
export MIGRATION_DATABASE_URL=postgresql://aion_migrator:ci_migrator@127.0.0.1:5432/aion_data
export DATABASE_URL=postgresql://aion_app:ci_app@127.0.0.1:5432/aion_data
export DATABASE_SSL=false
export PORT=8080
npm run migrate && npm start

# Terminal 2 — Control Center
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

When `VITE_AION_RUNTIME_URL` is set, the browser calls it directly (ensure CORS or same-origin). When empty, the Vite dev proxy forwards `/v1` to local Runtime.

## Scripts

From `workforce-control/`:

- `npm run dev` — Vite on :5174
- `npm run build`
- `npm run typecheck`

From repo root:

- `npm run workforce:dev`
- `npm run workforce:build`
- `npm run workforce:typecheck`
