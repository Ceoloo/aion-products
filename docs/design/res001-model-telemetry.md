# RES-001 — Model telemetry spike (products)

- **Status:** Prototype complete (isolated; keyless CI)
- **Architect gate:** CONDITIONAL GO — see `aion-docs` `.aion/research/RES-001-architect-decision.md`
- **Non-goals honored:** no Core/Runtime SDK imports; no stream/tool_call; no adaptive routing

## What changed

| Surface | Change |
|---|---|
| `LlmResponse` | Required telemetry: `provider`, `latencyMs`, `costUnits`, `ok`, `errorCode?` |
| `safeGenerate()` | Non-throwing wrapper; redacts secret-like fragments in `errorCode` |
| Anthropic / OpenRouter providers | Emit success telemetry on `complete()` |
| `RevenueExecutionAdapter` | Metadata `provider` uses `llm.name` / response provider (not hardcoded `anthropic`); forwards latency/cost/tokens |
| Tests | `test/model-telemetry.test.ts` + OpenRouter telemetry assertions |

## Proof

```bash
npm test          # includes model-telemetry + openrouter
npm run typecheck
```

## Promotion path

1. Short ADR for Core types (`model.generate@1`) — Architect
2. Second consumer **or** explicit OL Runtime capability need
3. Only then: Core types + Runtime registration (still no vendor SDKs in Runtime)
