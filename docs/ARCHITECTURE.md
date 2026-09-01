# Architecture

## Principles

1. **The call is a first-class data stream.** State is maintained turn-by-turn,
   not reconstructed from a transcript afterward.
2. **The canonical `@aion/core` control plane governs every AI execution.**
   Engines never call a model directly, and Revenue Copilot does **not** define
   its own Core. Engines build product-owned `AiTask`s and submit them to the
   product's `AiExecutionService`, which routes each as a governed `Command`
   through the `@aion/core` control plane (policy, risk, human gates, execution
   routing, run state, telemetry). The model provider is an `ExecutionAdapter`,
   not the authority.
3. **Explainable where it matters.** Ladder position, gaps, and conversion
   readiness are deterministic functions of state — reconstructable, not opaque.
   The LLM is used for interpretation (extraction, objection meaning, phrasing),
   not for scoring that must be auditable.
4. **Industry-configurable.** Engines are reusable; a `SalesSchema` supplies the
   ladder, the facts that matter, readiness signals, and the objection playbook.
5. **Runs offline.** Every AI step has a deterministic implementation, so the
   full pipeline installs, runs, and tests with no key. Claude is an upgrade
   path, not a hard dependency.

## The platform layer (`src/platform`) → canonical `@aion/core`

Revenue Copilot owns AI task definitions and sales interpretation; `@aion/core`
owns governance, permission, risk routing, run state, and the execution
contract. The seam:

```
engine ─AiTask→ AiExecutionService.run(task)         (src/platform/ai-execution.ts)
                   │  builds a governed Command (actor, capability, mission, payload)
                   ▼
             @aion/core  Orchestrator.submit(command)   ← the chokepoint
                   │  policy → risk → (human gate) → capability routing
                   ▼
             RevenueExecutionAdapter.execute(request)  (implements @aion/core ExecutionAdapter)
                   ├─ LLM path:  buildPrompt → provider.complete → task.parse
                   │                └─ on error ▶ deterministic fallback (fellBack=true)
                   └─ deterministic path: task.deterministic(input)
                   ▼
             ExecutionResult  +  canonical trace (correlationId, telemetry, events)
```

- **`revenue-ai-tasks.ts`** — the product's `AiTask<I,O>` type and the engine →
  capability map (`revenue.extraction`, `revenue.conversationstate`, …; dotted
  lower-case, per `@aion/core`'s Capability contract). `AiTask` bundles the LLM
  path (`buildPrompt` + `parse`) with a `deterministic` implementation.
- **`ai-execution.ts`** — `AiExecutionService` (implements the narrow
  `AiExecutor` the engines depend on). It stands up an `@aion/core`
  `createInMemoryControlPlane`, registers a governed agent actor granted exactly
  the `revenue.*` capabilities at an R1 ceiling, and submits one `Command` per
  task. It maps the `OrchestrationResult` back to the task's typed output and
  keeps a read-model over the canonical telemetry for reporting. It does **not**
  implement governance itself.
- **`provider-adapter.ts`** — `RevenueExecutionAdapter implements
  ExecutionAdapter`. It handles every `revenue.*` capability, runs the LLM when a
  provider is configured, and falls back to the task's deterministic path on any
  error, returning a **successful** `ExecutionResult` either way with `fellBack`
  in `metadata` (fallback is vendor-aware, so it lives here — the control plane
  stays vendor-agnostic). `LlmProvider`/`AnthropicProvider` lazily import
  `@anthropic-ai/sdk`. Tests inject fakes.
- **CRM-write precondition** (`AiExecutionService.canAutoWriteFact`): a fact is
  auto-writable only if **stated explicitly** and above a confidence bar
  (default 0.85). The durable write itself is a separately governed capability;
  this gate decides whether to even request it.
- **Trace** is canonical: `@aion/core` mints the `runId`/`correlationId` and
  records telemetry + events per governed run. `TraceSummary` is a read-model
  over that, not a parallel tracer.

### Consuming `@aion/core` (six-repo boundary)

`@aion/core` is a separate repo and is not published to a registry, so
`scripts/setup-core.sh` clones it at a **pinned commit** and builds it into
`.vendor/aion-core` (dist + trimmed manifest), consumed via a `file:`
dependency. `aion-products` depends on the Core **contracts** directly and does
**not** code-depend on `aion-runtime` — Runtime composes the production
deployment (durable stores, real runtimes); here we use the in-memory control
plane `@aion/core` ships for development, tests, and CI. Bumping the pinned
commit is a deliberate, reviewed change. (A published `@aion/core` package would
replace the `file:` bootstrap with a normal version range — a future
improvement.)

## Domain (`src/domain`)

- **`ladder.ts`** — configurable rungs with gates (`gateFacts`,
  `requiresObjectionsResolved`, `requiresCommitment`). `outcomeOnly` rungs
  (approved/funded/closed) are never inferred live — they are recorded post-call.
- **`facts.ts`** — the shared fact vocabulary; each `FactSlot` carries value,
  confidence, explicit-vs-inferred, and evidence.
- **`deal.ts`** — the `DealState`: the live interpretation (facts, sentiment,
  urgency, conversation stage, objections, buying signals, commitments, gaps,
  readiness, ladder position).
- **`lineage.ts` / `report.ts`** — the durable learning chain and the post-call
  `CallIntelligence` record.

## Engines (`src/engines`)

| Engine | Responsibility | LLM path | Deterministic path |
|---|---|---|---|
| `context` | pre-call briefing | summarize context | template briefing |
| `extraction` | facts → structured slots | JSON extraction | cue/regex heuristics |
| `stage` | conversation stage + sentiment | classify | cue heuristics |
| `signals` | buying signals + commitments | detect | cue heuristics |
| `objection` | interpret + lifecycle | interpret concern | playbook cue matching |
| `gaps` | where the call *should* be | — (pure) | rules over state |
| `readiness` | explainable readiness | — (pure) | weighted schema signals |
| `ladder` | ladder position | — (pure) | prefix-gate evaluation |
| `nba` | next-best-action | reason | sales-judgment policy |

The **signature behavior** lives in `nba`: when a pricing objection lands before
urgency/impact is established, the engine returns the rep to impact questions
rather than defending price.

## Pipeline (`src/pipeline`)

`LiveCopilot.begin()` assembles context and seeds state (including prior
objections carried in from CRM). Each `ingest(turn)`:

1. runs extraction / stage / signals / objection **concurrently** through the Core,
2. merges them into the live state,
3. reconciles urgency (fact text → enum),
4. recomputes ladder position, readiness, gaps (deterministic, explainable),
5. attributes pending lineage records to the prospect's response,
6. runs next-best-action and opens a lineage record per surfaced recommendation.

`buildReport()` freezes everything into `CallIntelligence`: outcome
(stage before → after), qualification (+ CRM-writable facts), deal signals, rep
intelligence, next action, and the learning lineage + trace summary.

## Why no build step / few dependencies

Node ≥ 22.18 strips TypeScript types natively, so `.ts` files run and test
directly. Runtime dependencies are `@aion/core` (the control-plane kernel, built
from a pinned commit) and the optional, lazily-imported Anthropic SDK. With no
API key the loop still runs end-to-end through `@aion/core` on the deterministic
path — nothing about the architecture depends on a network or model being
present.

## What is intentionally out of scope for Mission-001

Live call analysis is **in** (the conversation stream + live intelligence loop).
Full telephony infrastructure and autonomous calling are **out** — we ingest a
turn stream (from a transcription source or a replayed transcript); we do not
need to become a phone carrier to prove the loop.
