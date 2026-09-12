/**
 * Top-level AION Revenue Copilot API.
 *
 * AI work is orchestrated by the product's AiExecutionService, which routes
 * every task through the canonical @aion/core control plane. This module does
 * NOT define a Core — governance/routing/run-state/trace belong to @aion/core.
 *
 * Example:
 *   const { copilot, exec } = await createCopilot({ callId, industry: 'funding', context });
 *   for (const turn of turns) console.log(await copilot.ingest(turn));
 *   const report = buildReport(copilot, exec, getSchema('funding'));
 */

import type { ContextInput } from './engines/context.ts';
import type { Effort, LlmProvider } from './platform/provider-adapter.ts';
import { AiExecutionService } from './platform/ai-execution.ts';
import { detectProvider } from './platform/provider-adapter.ts';
import { getSchema } from './config/registry.ts';
import { LiveCopilot } from './pipeline/copilot.ts';

export interface CreateCopilotOptions {
  callId: string;
  industry: string;
  context: ContextInput;
  /** Override provider detection (e.g. inject a fake in tests). Pass null to force deterministic. */
  llm?: LlmProvider | null;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  crmWriteConfidence?: number;
  /** Durable Runtime base URL (or set AION_RUNTIME_URL). */
  runtimeUrl?: string;
  /** Optional fetch for RuntimeClient (tests). */
  runtimeFetch?: typeof fetch;
}

export async function createCopilot(opts: CreateCopilotOptions): Promise<{ copilot: LiveCopilot; exec: AiExecutionService }> {
  const schema = getSchema(opts.industry);
  const llm = opts.llm === undefined ? detectProvider() : opts.llm;
  const exec = new AiExecutionService({
    callId: opts.callId,
    llm,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.crmWriteConfidence !== undefined ? { crmWriteConfidence: opts.crmWriteConfidence } : {}),
    ...(opts.runtimeUrl ? { runtimeUrl: opts.runtimeUrl } : {}),
    ...(opts.runtimeFetch ? { runtimeFetch: opts.runtimeFetch } : {}),
  });
  const copilot = await LiveCopilot.begin({ exec, schema, context: opts.context });
  return { copilot, exec };
}

// Public surface re-exports.
export { AiExecutionService } from './platform/ai-execution.ts';
export type { AiExecutor, AiExecResult } from './platform/ai-execution.ts';
export { detectProvider, AnthropicProvider, RevenueExecutionAdapter } from './platform/provider-adapter.ts';
export type { LlmProvider } from './platform/provider-adapter.ts';
export { OpenRouterProvider } from './platform/providers/openrouter.ts';
export { LiveCopilot } from './pipeline/copilot.ts';
export { buildReport } from './pipeline/report.ts';
export { getSchema, listSchemas } from './config/registry.ts';
export type { CallIntelligence, TraceSummary } from './domain/report.ts';
export type { DealState } from './domain/deal.ts';
export type { LiveUpdate } from './pipeline/copilot.ts';
export { buildCallOutcomeAttribution, toCreateOutcomeInput, publishCallOutcome } from './platform/outcome.ts';
export type { CallOutcomeAttribution } from './platform/outcome.ts';
export { RuntimeClient, RuntimeApiError, runtimeUrlFromEnv } from './platform/runtime-client.ts';
export type {
  CreateOutcomeInput,
  OutcomeRecord,
  RevenueSessionRecord,
} from './platform/runtime-contracts.ts';
export {
  RuntimeRevenueSessionStore,
  createSessionStore,
} from './validation/runtime-session-store.ts';
export type { SessionStore } from './validation/store.ts';
export { InMemorySessionStore, JsonSessionStore } from './validation/store.ts';
