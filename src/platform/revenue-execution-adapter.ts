/** Canonical Core adapter. Providers are injected; no environment or SDK access. */
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from '@aion/core';
import type { AiTask } from './revenue-ai-tasks.ts';
import type { Effort, LlmProvider } from './provider-contracts.ts';

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
