/**
 * OpenRouter model provider.
 *
 * A sibling of `AnthropicProvider` implementing the same `LlmProvider` contract
 * (provider-adapter.ts). OpenRouter exposes an OpenAI-compatible
 * chat-completions endpoint, so this is a plain `fetch` — no vendor SDK, no
 * dependency. `@aion/core` never learns OpenRouter exists; the model provider
 * is an execution adapter behind the vendor-neutral boundary, not the authority.
 *
 * The API key is read from the environment by `detectProvider()`
 * (`OPENROUTER_API_KEY`) and passed in — it never appears in code, and it is
 * never logged (failures surface a non-secret `openrouter_error status=<n>`).
 */

import type { LlmProvider, LlmRequest, LlmResponse } from '../provider-adapter.ts';
import { successTelemetry } from '../provider-contracts.ts';

/**
 * The minimal slice of `fetch` this provider needs. Declared structurally so the
 * provider is trivially testable with a fake and does not depend on DOM types.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpenRouterOptions {
  /** Override the endpoint (tests inject a fake; default is OpenRouter's live URL). */
  baseUrl?: string;
  /** Injectable fetch, for testing without network. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

const DEFAULT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Narrow the untyped JSON body into the fields we read, defensively. */
interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(apiKey: string, options: OpenRouterOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_URL;
    // Cast the global once, at the seam, so the rest of the class stays typed.
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const resp = await this.fetchImpl(this.baseUrl, {
      method: 'POST',
      headers: {
        // The key value comes from the environment via detectProvider — never a literal.
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        // Attribution headers OpenRouter recognizes (non-secret, optional).
        'X-Title': 'AION Revenue Copilot',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });

    if (!resp.ok) {
      // Non-secret reason only — never echo the key or the Authorization header.
      throw new Error(`openrouter_error status=${resp.status}`);
    }

    const data = (await resp.json()) as ChatCompletion;
    const text = data.choices?.[0]?.message?.content ?? '';
    // OpenRouter may include a usage cost in native units; capture when present.
    const costRaw = (data as { usage?: { cost?: number } }).usage?.cost;
    const costUnits = typeof costRaw === 'number' && Number.isFinite(costRaw) ? costRaw : null;
    return {
      text,
      model: data.model ?? req.model,
      tokensIn: data.usage?.prompt_tokens ?? null,
      tokensOut: data.usage?.completion_tokens ?? null,
      ...successTelemetry(this.name, Date.now() - started, costUnits),
    };
  }
}
