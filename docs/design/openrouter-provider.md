# Design Spec — OpenRouter Model Provider

- **Drives:** adding OpenRouter as a model option behind the existing
  vendor-neutral execution adapter
- **Priority:** per-mission (additive; deterministic path already works keyless)
- **Status:** Design — code sketch, not yet implemented

The Revenue Copilot already treats the model provider as an **execution
adapter**, not the authority: `src/platform/provider-adapter.ts` defines an
`LlmProvider` interface, ships an `AnthropicProvider` (lazy SDK import), and
falls back to a deterministic implementation on any model error or missing key.
OpenRouter slots in as a **sibling `LlmProvider`** — no control-plane change, no
new capability, no change to `@aion/core`.

## Why this is a small, in-pattern change

- `@aion/core` stays vendor-agnostic — it never learns OpenRouter exists; vendor
  specifics live in `ExecutionResult.metadata` as they do for Anthropic today.
- The deterministic fallback is untouched: no key → deterministic path, so tests
  and CI still run with **no credentials**.
- The credential is read from the environment only
  ([external-credentials](https://github.com/Ceoloo/aion-infra/blob/main/docs/design/external-credentials.md)):
  `OPENROUTER_API_KEY`, never a literal.

## Code sketch

OpenRouter exposes an **OpenAI-compatible** chat-completions endpoint, so the
provider is a thin `fetch` — no vendor SDK dependency at all (simpler than the
Anthropic path):

```ts
// src/platform/providers/openrouter.ts  (sketch)
import type { LlmProvider, LlmRequest, LlmResponse } from '../provider-adapter.ts';

/** OpenRouter-backed provider. OpenAI-compatible; no SDK, plain fetch. */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  constructor(private readonly apiKey: string) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,   // value from process.env only
        'Content-Type': 'application/json',
        // Optional attribution headers OpenRouter recognizes:
        'X-Title': 'AION Revenue Copilot',
      },
      body: JSON.stringify({
        model: req.model,                          // e.g. "anthropic/claude-3.5-sonnet"
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });
    if (!resp.ok) {
      // Non-secret reason only — never echo the key or auth header.
      throw new Error(`openrouter_error status=${resp.status}`);
    }
    const data: any = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    return {
      text,
      model: data.model ?? req.model,
      tokensIn: data.usage?.prompt_tokens ?? null,
      tokensOut: data.usage?.completion_tokens ?? null,
    };
  }
}
```

## Wiring: extend `detectProvider()`

`detectProvider()` picks a provider from the environment. Extend it to prefer an
explicitly configured provider, else fall back by which key is present, else
`null` (deterministic):

```ts
// src/platform/provider-adapter.ts (extended sketch)
export function detectProvider(): LlmProvider | null {
  const choice = process.env.AION_LLM_PROVIDER;                 // optional explicit pin
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  const anthKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (choice === 'openrouter' && orKey) return new OpenRouterProvider(orKey);
  if (choice === 'anthropic' && anthKey) return new AnthropicProvider(anthKey);

  if (orKey)  return new OpenRouterProvider(orKey);             // default order: OpenRouter…
  if (anthKey) return new AnthropicProvider(anthKey);           // …then Anthropic
  return null;                                                  // → deterministic path
}
```

The default model comes from `OPENROUTER_MODEL` (config, not secret); the
`RevenueExecutionAdapter` already carries `model` in its deps, so only the
wiring that constructs the adapter reads that env var.

## Governance & economics carry through unchanged

- **`metadata.provider`** records `'openrouter'` (or `'deterministic'` on
  fallback), keeping telemetry honest about which runtime actually did the work.
- **Cost/tokens** flow into `ExecutionResult.cost` exactly as today, so the
  [economics layer](https://github.com/Ceoloo/aion-docs/blob/main/architecture/agent-economics.md)
  gets OpenRouter spend with no special-casing. (OpenRouter can also return
  spend in its response; capture it into `cost.units` when present, so
  `compute_cost` is authoritative rather than token-estimated.)
- **No new risk surface:** this is model *reasoning* (R0-ish), not a side effect.
  Model calls do not need idempotency receipts — those are for state-changing
  tool calls ([execution gateway](https://github.com/Ceoloo/aion-docs/blob/main/architecture/execution-gateway.md)).

## Testing without a key

Because the deterministic fallback is preserved, the provider is testable with a
**fake `fetch`** (or a fake `LlmProvider`) and CI runs keyless. A live smoke test
runs only where `OPENROUTER_API_KEY` is injected, and asserts on shape, never on
the key.

## What this spec deliberately does NOT do

- Does not hardcode a key, model, or spend limit — all from env/config.
- Does not add a control-plane concept — OpenRouter is one more `LlmProvider`.
- Does not change the deterministic fallback or make a key required.
- Does not promote OpenRouter to a platform (`@aion/core`) package — that is the
  [platformization rule](https://github.com/Ceoloo/aion-docs/blob/main/roadmap/platform-maturity.md)
  only after the same provider is needed by multiple products.
