# AION release status — 2026-09-09

## Links and observed state

| Surface | Link / project | State |
| --- | --- | --- |
| Revenue production | https://aion-revenue-copilot.vercel.app | Older static deployment; `/api/health` returns 404. Not verified for live calls. |
| Revenue isolated preview | https://aion-revenue-copilot-7b31cmnel-loos-projects-84839afe.vercel.app | dd65adf, READY, sample mode, Vercel access protection may require a share link. |
| Operator Console | Vercel `v0-aion-ops-command-center` | No deployment or production domain in project inventory. |
| Growth Command Center | Vercel `v0-growth-command-center` | No deployment; source/release mapping not established. |
| Runtime | https://runtime.aionsystems.ai | Cannot verify: requests from this environment return proxy 502 connection refused. This does not establish global outage. |
| Copilot backend | https://copilot.aionsystems.ai | Cannot verify from this environment (502). |

## Verified code

Products PR #3 preserves canonical Core through browser-safe composition. Provider SDKs, server configuration and Runtime transport are excluded from the preview browser graph. No model or CRM credentials are needed. Samples are excluded from production gates.

Product and both frontend typechecks/builds pass. Product suite: 65 tests. Synthetic evaluation: 5 fixtures. Preview integration verifies canonical traces, all schemas, CRUD, ordered finalization, storage retry and sample exclusion. Browser verification of the deployed dd65adf preview confirms launch, transcript ingestion and canonical deterministic guidance.

Operator HTTP regression coverage now rejects HTML gateway/SPA responses and empty success responses instead of treating them as valid Runtime data. HTTP failures preserve status and safe error messages.

## Production blockers and implementation order

1. Establish deployment access to the actual Runtime/VPS and verify readiness from an independent network. The current session has no configured SSH identity. Use the existing `aion-infra` VPS workflow and its production environment gate; do not bypass required reviewers.
2. Reconcile the Revenue API contract. `web/src/lib/api.ts` uses `/api/session`, saved sessions and dashboard endpoints from `src/server/app.ts`. The production Docker entry point `src/server.ts` serves `/v1/sessions`. A prefix rewrite alone cannot reconcile their different request/response and persistence contracts. Implement a shared authenticated server composition exposing the console contract, backed by durable storage, then proxy Vercel `/api/*` to it. Keep provider credentials server-side.
3. Resolve `aion-data` PR #1 merge conflicts and complete the companion Products checkpoint integration. The PR adds durable Revenue storage, but its migration is not evidence of a production rollout. Test restart recovery, concurrent updates and atomic finalization against PostgreSQL before applying through the deployment migration gate.
4. Build Operator Console against the verified Runtime URL (`VITE_AION_RUNTIME_URL`), with the exact deployed origin in Runtime CORS. Validate tenant/auth enforcement, mission reads, execution traces and approvals before production publication. Tenant/operator hints must not become authority.
5. Keep root `vercel.json` confined to isolated sample previews. Production Revenue needs the normal web build plus the working backend route. Do not promote dd65adf's sample deployment as a live operational console.
6. Establish the Growth Command Center's source repository and intended backend before publishing into its empty Vercel project.

## Other pending changes

Runtime PR #33, Core PR #18 and Docs PRs #9/#39/#41/#42 target `cursor/execution-object-agent-identity-6743`, not main. They require coordinated dependency/release review; merging them blindly does not update the deployed main-line images. Data PR #1 targets main but is not mergeable as inspected.

## Final live checks

Confirm deployed immutable image SHAs, health/readiness, successful authenticated API JSON, session ingest/finalize/reload across restart, dashboard counts excluding synthetic sessions, Runtime reads and governed approvals, and CORS from actual production origins. Record production links and deployment IDs only after these checks pass. Live CRM writes need a controlled test record and verified model/provider setup; synthetic tests are not proof of live CRM operation.
