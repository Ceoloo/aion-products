/**
 * Provider execution adapter.
 *
 * The model provider is an EXECUTION ADAPTER, not the authority. This module
 * implements @aion/core's `ExecutionAdapter` contract: the canonical control
 * plane resolves this adapter by capability and hands it a governed
 * `ExecutionRequest`; the adapter performs the vendor (or deterministic) work
 * and returns a normalized `ExecutionResult`. @aion/core never learns which
 * vendor sits behind it (vendor specifics live in `metadata`).
 *
 * The Anthropic SDK is an optional dependency, imported lazily, so the product
 * installs/tests/runs with no key via the deterministic path.
 */

import type { ExecutionAdapter, ExecutionRequest } from '@aion/core';
import type { ExecutionResult } from '@aion/core';
import type { AiTask } from './revenue-ai-tasks.ts';

export type Effort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
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
    };
  }
}

/** Detect a provider from the environment; null → deterministic execution. */
export function detectProvider(): LlmProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key && key.trim().length > 0 ? new AnthropicProvider(key.trim()) : null;
}

export interface RevenueAdapterDeps {
  llm: LlmProvider | null;
  /** Resolves the concrete AiTask carried by-token in the command payload. */
  resolveTask: (token: string) => AiTask<unknown, unknown> | undefined;
  model: string;
  effort: Effort;
  maxTokens: number;
}

/**
 * The Revenue Copilot's single execution runtime, registered with @aion/core.
 *
 * It handles every `revenue.*` capability. It runs the governed unit of work
 * via the LLM when a provider is configured, and falls back to the task's
 * deterministic implementation on ANY model error — returning a *successful*
 * ExecutionResult either way, with `fellBack` recorded in metadata. (Keeping
 * fallback inside the adapter is correct: it is vendor-aware behavior, and the
 * control plane must stay vendor-agnostic.)
 */
export class RevenueExecutionAdapter implements ExecutionAdapter {
  readonly name = 'revenue-copilot-executor';
  private readonly deps: RevenueAdapterDeps;

  constructor(deps: RevenueAdapterDeps) {
    this.deps = deps;
  }

  canHandle(request: ExecutionRequest): boolean {
    return String(request.capability).startsWith('revenue.');
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const token = String((request.command.payload as Record<string, unknown>)?.taskToken ?? '');
    const task = this.deps.resolveTask(token);

    if (!task) {
      const now = new Date().toISOString();
      return {
        status: 'failed',
        error: { code: 'TASK_NOT_FOUND', message: `no task registered for token "${token}"`, retryable: false },
        executor: this.name,
        startedAt,
        completedAt: now,
        durationMs: 0,
        cost: { units: 0 },
        metadata: {},
      };
    }

    let output: unknown;
    let model = 'deterministic';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let fellBack = false;

    if (this.deps.llm) {
      try {
        const prompt = task.buildPrompt(task.input);
        const resp = await this.deps.llm.complete({
          system: prompt.system,
          user: prompt.user,
          maxTokens: this.deps.maxTokens,
          effort: this.deps.effort,
          model: this.deps.model,
        });
        model = resp.model;
        tokensIn = resp.tokensIn;
        tokensOut = resp.tokensOut;
        output = task.parse(resp.text);
      } catch {
        fellBack = true;
        model = 'deterministic';
        output = task.deterministic(task.input);
      }
    } else {
      output = task.deterministic(task.input);
    }

    const completedAt = new Date().toISOString();
    const tokens = tokensIn !== null || tokensOut !== null ? (tokensIn ?? 0) + (tokensOut ?? 0) : undefined;

    return {
      status: 'succeeded',
      output: { value: output },
      executor: this.name,
      model,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      cost: tokens !== undefined ? { units: 1, tokens } : { units: 1 },
      metadata: {
        engine: task.engine,
        kind: task.kind,
        turnIndex: task.turnIndex,
        provider: fellBack || !this.deps.llm ? 'deterministic' : 'anthropic',
        fellBack,
      },
    };
  }
}
