/** Server-only provider discovery and vendor loading. */
import type { LlmProvider, LlmRequest, LlmResponse } from './provider-contracts.ts';
export type { Effort, LlmProvider, LlmRequest, LlmResponse } from './provider-contracts.ts';
export { safeGenerate, successTelemetry } from './provider-contracts.ts';
export { RevenueExecutionAdapter } from './revenue-execution-adapter.ts';
export type { RevenueAdapterDeps } from './revenue-execution-adapter.ts';
// Value import (not a type): the reverse import in openrouter.ts is `import
// type` and is erased at runtime, so there is no runtime cycle.
import { OpenRouterProvider } from './providers/openrouter.ts';
import { successTelemetry } from './provider-contracts.ts';

/** Anthropic-backed provider (lazy SDK import). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: unknown = null;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;
    this.client = new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const client = await this.getClient();
    const resp = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.effort },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    if (resp.stop_reason === 'refusal') throw new Error('model refused the request');
    let text = '';
    for (const block of resp.content ?? []) {
      if (block.type === 'text') text += block.text;
    }
    return {
      text,
      model: resp.model ?? req.model,
      tokensIn: resp.usage?.input_tokens ?? null,
      tokensOut: resp.usage?.output_tokens ?? null,
      ...successTelemetry(this.name, Date.now() - started, null),
    };
  }
}

/**
 * Detect a provider from the environment; null → deterministic execution.
 *
 * Selection:
 *  - `AION_LLM_PROVIDER=openrouter|anthropic` pins a provider explicitly (and
 *    yields null if that provider's key is absent, rather than silently using
 *    the other one).
 *  - otherwise, whichever key is present is used; if both are, OpenRouter wins
 *    (the router is the more general default). Existing deployments that set
 *    only `ANTHROPIC_API_KEY` are unaffected.
 *  - no key → null → the governed deterministic path.
 */
export function detectProvider(): LlmProvider | null {
  const choice = process.env.AION_LLM_PROVIDER?.trim().toLowerCase();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (choice === 'openrouter') {
    return openRouterKey ? new OpenRouterProvider(openRouterKey) : null;
  }
  if (choice === 'anthropic') {
    return anthropicKey ? new AnthropicProvider(anthropicKey) : null;
  }

  if (openRouterKey) return new OpenRouterProvider(openRouterKey);
  if (anthropicKey) return new AnthropicProvider(anthropicKey);
  return null;
}
