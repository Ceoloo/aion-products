/**
 * Core governance policy.
 *
 * The Core is the single chokepoint through which all AI execution passes.
 * Policy decides which provider/model to use, and — critically for Mission-001
 * — governs automated CRM writes: we only auto-persist facts that were stated
 * explicitly and clear a confidence bar, echoing the "≥85% on clearly stated
 * structured facts before trusting automated CRM writes" gate.
 */

import type { FactSlot } from '../domain/facts.ts';

export interface CorePolicy {
  /** Allow calls to the LLM provider at all. */
  allowLLM: boolean;
  /** Model id for anthropic executions. */
  model: string;
  /** effort for anthropic executions. */
  effort: 'low' | 'medium' | 'high';
  /** Max output tokens per execution. */
  maxTokens: number;
  /**
   * Confidence bar an *explicitly stated* fact must clear before the Core will
   * mark it as safe for an automated CRM write.
   */
  crmWriteConfidence: number;
  /** If false, inferred (non-explicit) facts are never auto-written regardless of confidence. */
  autoWriteInferredFacts: boolean;
}

export const DEFAULT_POLICY: CorePolicy = {
  allowLLM: true,
  model: process.env.AION_MODEL ?? 'claude-opus-4-8',
  effort: (process.env.AION_EFFORT as CorePolicy['effort']) ?? 'medium',
  maxTokens: 1536,
  crmWriteConfidence: 0.85,
  autoWriteInferredFacts: false,
};

/** The governance decision for persisting a fact to CRM automatically. */
export function canAutoWriteFact(policy: CorePolicy, slot: FactSlot): boolean {
  if (slot.value === null) return false;
  if (!slot.statedExplicitly && !policy.autoWriteInferredFacts) return false;
  return slot.confidence >= policy.crmWriteConfidence;
}
