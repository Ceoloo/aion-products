/**
 * LLM provider abstraction + Anthropic implementation.
 *
 * The Anthropic SDK is an optional dependency and is imported lazily, so the
 * project installs, type-checks, runs, and tests with zero network/keys via the
 * deterministic path. When ANTHROPIC_API_KEY is present the real Claude model
 * is used, governed by the Core.
 */

import type { CorePolicy } from './policy.ts';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort: CorePolicy['effort'];
  model: string;
}

export interface LlmResponse {
  text: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/**
 * Anthropic-backed provider. Constructed lazily so importing this module never
 * requires the SDK to be installed.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: unknown = null;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    // Lazy dynamic import: only touched when an LLM call actually happens.
    const mod: any = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;
    this.client = new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const client = await this.getClient();
    // Structured-output-style request: we instruct the model (in the system
    // prompt) to return strict JSON and parse it at the task layer.
    const resp = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.effort },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });

    if (resp.stop_reason === 'refusal') {
      throw new Error('model refused the request');
    }

    let text = '';
    for (const block of resp.content ?? []) {
      if (block.type === 'text') text += block.text;
    }

    return {
      text,
      model: resp.model ?? req.model,
      tokensIn: resp.usage?.input_tokens ?? null,
      tokensOut: resp.usage?.output_tokens ?? null,
    };
  }
}

/**
 * Detect an LLM provider from the environment. Returns null when no key is
 * configured — the Core then runs deterministically.
 */
export function detectProvider(): LlmProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) {
    return new AnthropicProvider(key.trim());
  }
  return null;
}
