/**
 * Top-level AION Revenue Copilot API.
 *
 * Example:
 *   const { copilot, core } = await createCopilot({ callId, industry: 'funding', context });
 *   for (const turn of turns) console.log(await copilot.ingest(turn));
 *   const report = buildReport(copilot, core, getSchema('funding'));
 */

import type { CorePolicy } from './core/policy.ts';
import type { ContextInput } from './engines/context.ts';
import type { LlmProvider } from './core/llm.ts';
import { Core } from './core/core.ts';
import { detectProvider } from './core/llm.ts';
import { getSchema } from './config/registry.ts';
import { LiveCopilot } from './pipeline/copilot.ts';

export interface CreateCopilotOptions {
  callId: string;
  industry: string;
  context: ContextInput;
  policy?: Partial<CorePolicy>;
  /** Override provider detection (e.g. inject a fake in tests). Pass null to force deterministic. */
  llm?: LlmProvider | null;
}

export async function createCopilot(opts: CreateCopilotOptions): Promise<{ copilot: LiveCopilot; core: Core }> {
  const schema = getSchema(opts.industry);
  const llm = opts.llm === undefined ? detectProvider() : opts.llm;
  const core = new Core({ callId: opts.callId, policy: opts.policy, llm });
  const copilot = await LiveCopilot.begin({ core, schema, context: opts.context });
  return { copilot, core };
}

// Public surface re-exports.
export { Core } from './core/core.ts';
export { detectProvider, AnthropicProvider } from './core/llm.ts';
export { DEFAULT_POLICY } from './core/policy.ts';
export { Tracer } from './core/trace.ts';
export { LiveCopilot } from './pipeline/copilot.ts';
export { buildReport } from './pipeline/report.ts';
export { getSchema, listSchemas } from './config/registry.ts';
export type { CallIntelligence } from './domain/report.ts';
export type { DealState } from './domain/deal.ts';
export type { LiveUpdate } from './pipeline/copilot.ts';
