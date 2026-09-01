# Architecture

## Principles

1. **The call is a first-class data stream.** State is maintained turn-by-turn,
   not reconstructed from a transcript afterward.
2. **The Core governs every AI execution.** Engines never call a model directly.
   They submit an `AiTask` to the Core, which selects the provider, enforces
   policy, records a trace, and falls back deterministically on failure.
3. **Explainable where it matters.** Ladder position, gaps, and conversion
   readiness are deterministic functions of state — reconstructable, not opaque.
   The LLM is used for interpretation (extraction, objection meaning, phrasing),
   not for scoring that must be auditable.
4. **Industry-configurable.** Engines are reusable; a `SalesSchema` supplies the
   ladder, the facts that matter, readiness signals, and the objection playbook.
5. **Runs offline.** Every AI step has a deterministic implementation, so the
   full pipeline installs, runs, and tests with no key. Claude is an upgrade
   path, not a hard dependency.

## The Core (`src/core`)

```
engine ──AiTask──▶  Core.run(task)
                      │  policy: provider? model? effort? CRM-write bar?
                      ├─ LLM path:  buildPrompt → provider.complete → task.parse
                      │                └─ on error ▶ deterministic fallback
                      └─ deterministic path: task.deterministic(input)
                      ▼
                   ExecutionTrace  (call, turn, engine, provider, model,
                                    tokens, latency, fellBack, summaries)
```

- **`AiTask<I,O>`** bundles the LLM path (`buildPrompt` + `parse`) with a
  `deterministic` implementation. The Core decides which runs; the output type
  is identical either way.
- **`LlmProvider`** is the seam. `AnthropicProvider` lazily imports
  `@anthropic-ai/sdk` (so the import never fails when the SDK/key is absent) and
  calls Claude with adaptive thinking + effort. Tests inject fakes.
- **Policy** governs automated CRM writes: a fact is auto-writable only if it
  was **stated explicitly** and clears a confidence bar (default 0.85) — the
  code expression of the Mission-001 "trust automated writes" gate.
- **`Tracer`** collects every execution. This is the backbone of the technical
  gate (traceability) and the learning gate (lineage).

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
directly. The only runtime dependency is the optional Anthropic SDK, imported
lazily. This keeps the proof-of-loop honest: nothing about the architecture
depends on a network being present.

## What is intentionally out of scope for Mission-001

Live call analysis is **in** (the conversation stream + live intelligence loop).
Full telephony infrastructure and autonomous calling are **out** — we ingest a
turn stream (from a transcription source or a replayed transcript); we do not
need to become a phone carrier to prove the loop.
