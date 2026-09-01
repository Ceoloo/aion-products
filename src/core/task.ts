/**
 * An AiTask is the unit of work an engine submits to the Core. It bundles the
 * LLM path (prompt + parser) with a deterministic fallback so the *same* task
 * runs whether or not a model key is present — the Core decides which path
 * executes and records the choice in the trace.
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
  /** Deterministic implementation used offline or as fallback. */
  deterministic: (input: I) => O;
  /** Short, safe input summary for the trace. */
  summarizeInput: (input: I) => string;
  /** Short output summary for the trace. */
  summarizeOutput: (output: O) => string;
}

export interface AiResult<O> {
  output: O;
  traceId: string;
}
