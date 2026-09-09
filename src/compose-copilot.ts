/** Browser-safe product composition. Canonical Core remains the execution authority. */
import type { ContextInput } from './engines/context.ts';
import type { Effort, LlmProvider } from './platform/provider-contracts.ts';
import { SharedExecutionService as AiExecutionService } from './platform/shared-execution.ts';
import { getSchema } from './config/registry.ts';
import { LiveCopilot } from './pipeline/copilot.ts';

export interface CopilotOptions {
  callId: string;
  industry: string;
  context: ContextInput;
  /** Explicit dependency injection. Null selects canonical deterministic execution. */
  llm: LlmProvider | null;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  crmWriteConfidence?: number;
}

export async function composeCopilot(opts: CopilotOptions): Promise<{ copilot: LiveCopilot; exec: AiExecutionService }> {
  const schema = getSchema(opts.industry);
  const llm = opts.llm;
  const exec = new AiExecutionService({
    callId: opts.callId,
    llm,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.crmWriteConfidence !== undefined ? { crmWriteConfidence: opts.crmWriteConfidence } : {}),
  });
  const copilot = await LiveCopilot.begin({ exec, schema, context: opts.context });
  return { copilot, exec };
}
