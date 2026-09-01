/**
 * The AION Core.
 *
 * Every engine submits AiTasks here; nothing calls a model directly. The Core:
 *   - applies governance policy (provider/model selection, CRM-write bar),
 *   - executes the LLM path or the deterministic path,
 *   - falls back to deterministic on any LLM error,
 *   - records an ExecutionTrace for lineage.
 */

import type { AiResult, AiTask } from './task.ts';
import type { LlmProvider } from './llm.ts';
import type { CorePolicy } from './policy.ts';
import type { FactSlot } from '../domain/facts.ts';
import { DEFAULT_POLICY, canAutoWriteFact } from './policy.ts';
import { Tracer, nextTraceId, type ExecutionTrace, type ProviderKind } from './trace.ts';

export interface CoreOptions {
  callId: string;
  policy?: Partial<CorePolicy>;
  /** Injected LLM provider. When absent, the Core runs deterministically. */
  llm?: LlmProvider | null;
  tracer?: Tracer;
}

export class Core {
  readonly callId: string;
  readonly policy: CorePolicy;
  readonly tracer: Tracer;
  private readonly llm: LlmProvider | null;

  constructor(opts: CoreOptions) {
    this.callId = opts.callId;
    this.policy = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) };
    this.llm = opts.llm ?? null;
    this.tracer = opts.tracer ?? new Tracer(opts.callId);
  }

  /** True when a governed LLM path is actually available. */
  get llmAvailable(): boolean {
    return this.policy.allowLLM && this.llm !== null;
  }

  async run<I, O>(task: AiTask<I, O>): Promise<AiResult<O>> {
    const start = Date.now();
    const useLlm = this.llmAvailable;
    let provider: ProviderKind = useLlm ? 'anthropic' : 'deterministic';
    let model: string | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let fellBack = false;
    let error: string | undefined;
    let output: O;

    if (useLlm && this.llm) {
      try {
        const prompt = task.buildPrompt(task.input);
        const resp = await this.llm.complete({
          system: prompt.system,
          user: prompt.user,
          maxTokens: this.policy.maxTokens,
          effort: this.policy.effort,
          model: this.policy.model,
        });
        model = resp.model;
        tokensIn = resp.tokensIn;
        tokensOut = resp.tokensOut;
        output = task.parse(resp.text);
      } catch (e) {
        // Governed fallback: never let a model hiccup break the live loop.
        fellBack = true;
        provider = 'deterministic';
        error = e instanceof Error ? e.message : String(e);
        output = task.deterministic(task.input);
      }
    } else {
      output = task.deterministic(task.input);
    }

    const trace: ExecutionTrace = {
      id: nextTraceId(),
      callId: this.callId,
      turnIndex: task.turnIndex,
      engine: task.engine,
      kind: task.kind,
      provider,
      model,
      fellBack,
      latencyMs: Date.now() - start,
      tokensIn,
      tokensOut,
      inputSummary: safe(() => task.summarizeInput(task.input)),
      outputSummary: safe(() => task.summarizeOutput(output)),
      error,
      at: new Date().toISOString(),
    };
    this.tracer.record(trace);

    return { output, traceId: trace.id };
  }

  /** Governance gate for automated CRM writes. */
  canAutoWriteFact(slot: FactSlot): boolean {
    return canAutoWriteFact(this.policy, slot);
  }
}

function safe(fn: () => string): string {
  try {
    return fn();
  } catch {
    return '(unavailable)';
  }
}
