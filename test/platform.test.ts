/**
 * Platform layer: proves the product's AI chokepoint resolves through the
 * canonical @aion/core control plane (not a product-local Core), that the
 * deterministic fallback stays governed and traced, and that the CRM-write
 * precondition holds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiExecutionService } from '../src/platform/ai-execution.ts';
import { ScriptedLlm, ThrowingLlm } from '../src/testing/fakes.ts';
import type { AiTask } from '../src/platform/revenue-ai-tasks.ts';
import type { FactSlot } from '../src/domain/facts.ts';

// A trivial task mapped to a real granted capability (engine "extraction").
function doubleTask(input: number): AiTask<number, number> {
  return {
    engine: 'extraction',
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

test('deterministic execution when no provider — still governed + traced by @aion/core', async () => {
  const exec = new AiExecutionService({ callId: 'c1', llm: null });
  assert.equal(exec.llmAvailable(), false);

  const res = await exec.run(doubleTask(21));
  assert.equal(res.output, 42);
  assert.ok(res.correlationId.length > 0, 'canonical correlation id present');
  assert.ok(res.runId.length > 0, 'canonical run id present');
  assert.equal(res.model, 'deterministic');

  // Canonical control plane really ran: telemetry + events exist and share the trace.
  const telemetry = exec.controlPlane.telemetrySink.all();
  assert.ok(telemetry.some((t) => t.operation === 'execution' && t.status === 'ok'));
  const events = exec.controlPlane.eventSink.all();
  assert.ok(events.some((e) => e.eventType === 'policy.allowed'), 'policy decided ALLOW');
  assert.ok(events.some((e) => e.eventType === 'execution.completed'));
  assert.ok(events.every((e) => e.correlationId === events[0]!.correlationId), 'one connected trace');
});

test('LLM path routes through the canonical adapter and parses model output', async () => {
  const exec = new AiExecutionService({ callId: 'c2', llm: new ScriptedLlm(() => '{"value": 100}') });
  const res = await exec.run(doubleTask(1));
  assert.equal(res.output, 100, 'LLM output, not deterministic 2');
  assert.equal(res.model, 'fake-model-1');
  assert.equal(res.fellBack, false);
  assert.equal(exec.traceSummary().byModel['fake-model-1'], 1);
});

test('failing LLM falls back to deterministic inside the adapter and is marked fellBack', async () => {
  const exec = new AiExecutionService({ callId: 'c3', llm: new ThrowingLlm() });
  const res = await exec.run(doubleTask(5));
  assert.equal(res.output, 10, 'deterministic fallback result');
  assert.equal(res.fellBack, true);
  assert.equal(res.model, 'deterministic');
  // The execution is still a SUCCESS at the control-plane level (governed fallback).
  const telemetry = exec.controlPlane.telemetrySink.all();
  assert.ok(telemetry.some((t) => t.operation === 'execution' && t.status === 'ok'));
  assert.equal(exec.traceSummary().fallbacks, 1);
});

test('CRM-write precondition: only explicit, high-confidence facts qualify', () => {
  const exec = new AiExecutionService({ callId: 'c4', llm: null });
  const base: Omit<FactSlot, 'confidence' | 'statedExplicitly' | 'value'> = {
    key: 'revenue',
    label: 'Revenue',
    evidence: [],
    updatedAtTurn: 1,
  };
  assert.equal(exec.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.9, statedExplicitly: true }), true);
  assert.equal(exec.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.7, statedExplicitly: true }), false, 'below bar');
  assert.equal(exec.canAutoWriteFact({ ...base, value: '$50k', confidence: 0.95, statedExplicitly: false }), false, 'inferred');
  assert.equal(exec.canAutoWriteFact({ ...base, value: null, confidence: 0.99, statedExplicitly: true }), false, 'null value');
});

test('a capability the agent is not granted is denied by @aion/core (deny-by-default)', async () => {
  const exec = new AiExecutionService({ callId: 'c5', llm: null });
  const rogue = doubleTask(1);
  rogue.engine = 'notgranted'; // → capability "revenue.notgranted", not in the actor's grants
  await assert.rejects(() => exec.run(rogue), /denied/i);
});
