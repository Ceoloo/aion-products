/**
 * Revenue Copilot AI task definitions.
 *
 * The PRODUCT owns AI task definitions and sales interpretation. A task bundles
 * the LLM path (prompt + parser) with a deterministic implementation; the
 * canonical @aion/core control plane decides which path runs, governs it, and
 * traces it. This module is the product's side of the boundary — it does NOT
 * implement governance, routing, or run state (those belong to @aion/core).
 */

export interface AiPrompt {
  system: string;
  user: string;
}

export interface AiTask<I, O> {
  /** issuing engine, e.g. "extraction". */
  engine: string;
  /** task kind, e.g. "extract_facts". */
  kind: string;
  input: I;
  turnIndex: number;
  /** Build the LLM prompt from the input. */
  buildPrompt: (input: I) => AiPrompt;
  /** Parse raw model JSON text into O. Should throw on malformed output. */
  parse: (raw: string) => O;
  /** Deterministic implementation used offline or as governed fallback. */
  deterministic: (input: I) => O;
  /** Short, safe input summary for the trace. */
  summarizeInput: (input: I) => string;
  /** Short output summary for the trace. */
  summarizeOutput: (output: O) => string;
}

/**
 * Engine → canonical capability (dotted lower-case taxonomy, no underscores, as
 * required by @aion/core's Capability contract). @aion/core authorizes,
 * classifies risk for, and routes each capability; it never learns which model
 * sits behind it.
 */
export const ENGINE_CAPABILITY: Record<string, string> = {
  context: 'revenue.context',
  extraction: 'revenue.extraction',
  stage: 'revenue.conversationstate',
  signals: 'revenue.signals',
  objection: 'revenue.objection',
  nba: 'revenue.nextaction',
};

export function capabilityForEngine(engine: string): string {
  return ENGINE_CAPABILITY[engine] ?? `revenue.${engine.replace(/[^a-z0-9]/g, '')}`;
}

/** All capabilities the Revenue Copilot agent is granted. */
export const REVENUE_CAPABILITIES: string[] = Object.values(ENGINE_CAPABILITY);
