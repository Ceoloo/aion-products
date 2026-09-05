# AION Revenue Copilot

**Phase 4 — AION Products · MISSION-001**
_Conversation → Intelligence → Action → Conversion_

A live, context-aware sales-intelligence system. It treats a sales call as a
first-class data stream: it interprets the conversation as it happens, fuses it
with business/prospect context, maintains a live interpretation of the deal,
tells the rep what matters right now, and turns every call into durable,
structured revenue data with full traceability.

> North Star: **increase the probability that a real sales conversation
> progresses toward revenue** — measured as conversion-stage advancement, not a
> single "did they buy" boolean.

---

## Why this is not "AI that fills out applications"

Revenue Copilot optimizes **conversion progression along a configurable ladder**,
not one terminal outcome. The platform intelligence is reusable; the sales
schema is per-business:

```
        REVENUE COPILOT (reusable engines)
                     │
     ┌───────────────┼────────────────┐
   Funding        AION B2B         Contractor
  Contact→…→      Cold Call→…→     Lead→…→
  Application     Audit            Estimate
```

## The loop

```
 PROSPECT + BUSINESS + REP CONTEXT + LIVE CONVERSATION
                     │
                     ▼
   ┌─────────────────────────────────────────┐
   │  AION CORE  (governs every AI execution) │
   │   Context · Extraction · Stage · Gaps    │
   │   Objection · Readiness · Next-Best-Action│
   └─────────────────────────────────────────┘
                     │
              LIVE REP GUIDANCE
                     ▼
     REP ACTION → CUSTOMER RESPONSE → CONVERSION EVENT
                     ▼
        DURABLE CALL INTELLIGENCE + LEARNING LINEAGE
```

Six real-time responsibilities, each an engine governed by the Core:

1. **Information extraction** — unstructured talk → structured fact slots.
2. **Conversation-state detection** — opening → discovery → … → closing, + sentiment.
3. **Gap detection** — "trying to close but urgency isn't established."
4. **Objection intelligence** — interpret the *underlying concern*, not a keyword.
5. **Next-best-action** — the highest-leverage move right now.
6. **Conversion readiness** — explainable signals, not an opaque percentage.

## Run it

No build step, no API key required. Every AI step is governed by the canonical
`@aion/core` control plane; the loop runs deterministically offline, and setting
`ANTHROPIC_API_KEY` routes the model calls through Claude (with automatic,
still-governed deterministic fallback).

```bash
npm run setup:core           # clone + build @aion/core (pinned) into .vendor/ (once)
npm install                  # or: npm ci
npm run console:build        # build the shadcn web console once (web/ → web/dist)
npm run preflight            # production readiness check before a real call (GO / blockers)
npm run golive               # preflight → build console if needed → start it
npm run console              # Validation Console → http://localhost:4173 (real calls)
npm run demo                 # replay a fixture call, see live guidance + post-call report
npm run demo:contractor      # a different industry / ladder
npm run eval                 # SYNTHETIC gate scorecard over the fixture set
npm test                     # unit + integration + gate tests
npm run typecheck
```

**Validation Console** (`npm run console`) is the operator surface for running
the copilot on **real calls**: enter prospect/context, dictate with the live mic
or paste a transcript, watch the live guidance, then correct the AI in a 30–60s
form. Those corrections are the ground truth; the Dashboard tab scores the real
Mission-001 gates. See [`docs/VALIDATION.md`](docs/VALIDATION.md). Real records
are PII and persist to the git-ignored `data/` dir (override `AION_DATA_DIR`
only to a path **outside** the repo). The server binds to loopback by default;
for phone/LAN use set `AION_HOST=0.0.0.0` **and** `AION_TOKEN=<secret>`.

**Before the first real call**, run `npm run preflight` (or `npm run golive`):
it verifies the environment is safe to ingest a real conversation — Node ≥ 22.18,
`@aion/core` resolves, a schema is registered, the governed Claude path is active
(`ANTHROPIC_API_KEY` set), the data dir holds PII outside the repo, and the
bind host isn't exposing unauthenticated routes — printing a GO / blocker
scorecard (also served at `/api/health` and shown as a banner in the console).
Follow [`docs/FIRST-CALL.md`](docs/FIRST-CALL.md) to run call #1 end to end.

The console is a mobile-optimized React + shadcn/ui SPA (`web/`), built to
`web/dist` and served by the Node server; when the build is absent the server
falls back to a dependency-free single-file console. The conversation view
distinguishes **rep vs lead** automatically — the rep is inferred from the
greeting/script/qualifying questions, the lead from answers, prices, and
objections — with an Auto/Rep/Lead pin for live dictation. Speech-to-text uses
the browser Web Speech API (Chrome/Edge); attribution runs server-side.

Requires Node ≥ 22.18 (native TypeScript type-stripping — `.ts` runs directly).
`@aion/core` is a separate repo in the six-repo constitution and is consumed as
a built `file:` dependency; `npm run setup:core` bootstraps it (see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → "Consuming @aion/core").

Point the demo at any labeled fixture:

```bash
node src/cli/demo.ts --fixture funding-discovery-call
node src/cli/demo.ts --fixture aion-b2b-discovery-call --quiet
```

## Using it as a library

```ts
import { createCopilot, buildReport, getSchema } from './src/aion.ts';

const { copilot, exec } = await createCopilot({
  callId, industry: 'funding', context, // ContextInput: prospect/company/offer/CRM/priors
});

for (const turn of turns) {
  const update = await copilot.ingest(turn);   // live state + ranked guidance
  // ... surface update.recommendations to the rep ...
  copilot.recordFeedback(recId, 'acted_on', turn.index); // the rep-value loop
}

const report = buildReport(copilot, exec, getSchema('funding')); // durable CallIntelligence
```

## Layout

```
src/
  platform/    product AI layer → canonical @aion/core:
                 revenue-ai-tasks (task defs + capability map),
                 ai-execution (AiExecutionService: submits governed Commands),
                 provider-adapter (RevenueExecutionAdapter + LLM providers)
  domain/      ladder, facts, deal state, objections, recommendations, lineage, report
  config/      SalesSchema + industry configs (funding, aion-b2b, contractor)
  engines/     context · extraction · stage · signals · objection · gaps · readiness · nba · ladder
  pipeline/    LiveCopilot (the live loop) + post-call report builder
  eval/        evaluation harness that scores the Mission-001 gates
  cli/         demo + evaluate runners
  server/      HTTP server + API (+ /api/health) + dependency-free console.html fallback
  validation/  transcript adapter (speaker-role inference), record store, scoring, readiness
web/           mobile-optimized React + shadcn/ui console (built to web/dist)
fixtures/      labeled transcripts (synthetic evaluation set)
scripts/       setup-core.sh (bootstraps @aion/core), golive.sh (preflight → serve)
test/          node:test suites
docs/          MISSION-001, ARCHITECTURE, GATES
```

Governance, policy, risk routing, run state, and the execution contract live in
`@aion/core`, not here. This repo owns AI task definitions and sales
interpretation, and consumes the Core contracts.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and
[`docs/GATES.md`](docs/GATES.md) for how the mission gates are measured and what
production validation still requires.
