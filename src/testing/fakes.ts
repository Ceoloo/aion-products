/**
 * Test doubles for the LLM provider, so the governed LLM path (parsing,
 * tracing, fallback) through @aion/core can be exercised without network or keys.
 */

import type { LlmProvider, LlmRequest, LlmResponse } from '../platform/provider-adapter.ts';

/** Always throws — used to prove execution falls back to the deterministic path. */
export class ThrowingLlm implements LlmProvider {
  readonly name = 'throwing-fake';
  async complete(_req: LlmRequest): Promise<LlmResponse> {
    throw new Error('simulated model failure');
  }
}

/**
 * Returns canned JSON keyed by a marker the caller injects into the system
 * prompt via `responder`. Lets a test assert that the LLM path (not the
 * deterministic path) produced the parsed output.
 */
export class ScriptedLlm implements LlmProvider {
  readonly name = 'scripted-fake';
  readonly model: string;
  private readonly responder: (req: LlmRequest) => string;

  constructor(responder: (req: LlmRequest) => string, model = 'fake-model-1') {
    this.responder = responder;
    this.model = model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    return { text: this.responder(req), model: this.model, tokensIn: 123, tokensOut: 45 };
  }
}
