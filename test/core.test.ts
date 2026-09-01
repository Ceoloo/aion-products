/**
 * Core governance: provider selection, deterministic fallback, tracing, and the
 * automated-CRM-write policy gate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Core } from '../src/core/core.ts';
import { ThrowingLlm, ScriptedLlm } from '../src/testing/fakes.ts';
import type { AiTask } from '../src/core/task.ts';
import type { FactSlot } from '../src/domain/facts.ts';

function sumTask(input: number): AiTask<number, number> {
  return {
    engine: 'test',
    kind: 'double',
    input,
    turnIndex: 0,
    buildPrompt: (n) => ({ system: 'return json', user: String(n) }),
    parse: (raw) => JSON.parse(raw).value as number,
    deterministic: (n) => n * 2,
    summarizeInput: (n) => `n=${n}`,
    summarizeOutput: (o) => `o=${o}`,
  };
}

test('runs deterministically when no LLM provider is present', async () => {
  const core = new Core({ callId: 'c1', llm: null });
  assert.equal(core.llmAvailable, false);
  const { output } = await core.run(sumTask(21));
  assert.equal(output, 42);
  const traces = core.tracer.all();
  assert.equal(traces.length, 1);
  assert.equal(traces[0]?.provider, 'deterministic');
  assert.equal(traces[0]?.fellBack, false);
});

test('uses the LLM path when a provider is present and parses its output', async () => {
  const core = new Core({ callId: 'c2', llm: new ScriptedLlm(() => '{"value": 100}') });
  assert.equal(core.llmAvailable, true);
  const { output } = await core.run(sumTask(1));
  assert.equal(output, 100, 'LLM output, not deterministic 2');
  const t = core.tracer.all()[0];
  assert.equal(t?.provider, 'anthropic');
  assert.equal(t?.model, 'fake-model-1');
  assert.equal(t?.tokensIn, 123);
});

test('falls back to deterministic when the LLM path throws, and records it', async () => {
  const core = new Core({ callId: 'c3', llm: new ThrowingLlm() });
  const { output } = await core.run(sumTask(5));
  assert.equal(output, 10, 'deterministic fallback result');
  const t = core.tracer.all()[0];
  assert.equal(t?.provider, 'deterministic');
  assert.equal(t?.fellBack, true);
  assert.match(t?.error ?? '', /simulated model failure/);
});

test('CRM-write governance: only explicit, high-confidence facts are auto-writable', () => {
  const core = new Core({ callId: 'c4', llm: null });
  const base: Omit<FactSlot, 'confidence' | 'statedExplicitly' | 'value'> = {
    key: 'revenue',
    label: 'Revenue',
    evidence: [],
    updatedAtTurn: 1,
  };
  assert.equal(core.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.9, statedExplicitly: true }), true);
  assert.equal(core.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.7, statedExplicitly: true }), false, 'below confidence bar');
  assert.equal(core.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.95, statedExplicitly: false }), false, 'inferred not auto-written');
  assert.equal(core.canAutoWriteFact({ ...base, value: null, confidence: 0.99, statedExplicitly: true }), false, 'null value');
});
