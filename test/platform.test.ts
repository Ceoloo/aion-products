/**
 * Platform layer: proves the product's AI chokepoint resolves through the
 * canonical @aion/core control plane (not a product-local Core), that the
 * deterministic fallback stays governed and traced, and that the CRM-write
 * precondition holds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiExecutionService } from '../src/platform/ai-execution.ts';
import { resolveRuntimeUrl } from '../src/platform/runtime-client.ts';
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

import { buildCallOutcomeAttribution } from '../src/platform/outcome.ts';
import { serviceKeyForEngine } from '../src/platform/revenue-ai-tasks.ts';

function mockRuntimeFetch(handler: (req: {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}) => { status: number; body: unknown }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (init?.body && typeof init.body === 'string') {
      body = JSON.parse(init.body) as Record<string, unknown>;
    }
    const res = handler({ method, url, body });
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('Runtime mode submits serviceKey and surfaces cost + executionId', async () => {
  const captured: { body: Record<string, unknown> | null } = { body: null };
  const fetchFn = mockRuntimeFetch(({ body }) => {
    captured.body = body;
    return {
      status: 200,
      body: {
        status: 'completed',
        run: { runId: 'run_rt_1', correlationId: 'corr_rt_1' },
        execution: { executionId: 'exec_rt_1', cost: { units: 7, tokens: 42 } },
        decision: { riskLevel: 'R1', reason: 'allowed' },
        result: {
          status: 'succeeded',
          output: { value: 99 },
          executor: 'runtime-mock',
          model: 'mock-model',
          durationMs: 12,
          cost: { units: 7, tokens: 42 },
          metadata: {},
        },
      },
    };
  });

  const exec = new AiExecutionService({
    callId: 'c_rt_1',
    llm: null,
    runtimeUrl: 'http://runtime.test',
    runtimeFetch: fetchFn,
  });
  assert.equal(exec.usesRuntime, true);
  assert.throws(() => exec.controlPlane, /unavailable/i);

  const res = await exec.run(doubleTask(1));
  assert.equal(res.output, 99);
  assert.equal(res.runId, 'run_rt_1');
  assert.equal(res.correlationId, 'corr_rt_1');
  assert.equal(res.executionId, 'exec_rt_1');
  assert.equal(res.costUnits, 7);
  assert.equal(res.costTokens, 42);
  assert.equal(res.fellBack, false);
  assert.equal(captured.body?.serviceKey, serviceKeyForEngine('extraction'));
  assert.equal(typeof captured.body?.actor, 'object');

  const ids = exec.attributionIds();
  assert.deepEqual(ids.runIds, ['run_rt_1']);
  assert.deepEqual(ids.executionIds, ['exec_rt_1']);
  assert.equal(ids.totalCostUnits, 7);
  assert.equal(ids.totalTokens, 42);
});

test('Runtime mode denied path is enforced', async () => {
  const fetchFn = mockRuntimeFetch(() => ({
    status: 200,
    body: {
      status: 'denied',
      decision: { reason: 'capability not granted', riskLevel: 'R1' },
      run: { runId: 'run_deny', correlationId: 'corr_deny' },
    },
  }));

  const exec = new AiExecutionService({
    callId: 'c_rt_deny',
    llm: null,
    runtimeUrl: 'http://runtime.test',
    runtimeFetch: fetchFn,
  });
  await assert.rejects(() => exec.run(doubleTask(1)), /denied/i);
});

test('Runtime mode awaiting approval surfaces approvalId', async () => {
  const fetchFn = mockRuntimeFetch(() => ({
    status: 202,
    body: {
      status: 'awaiting_approval',
      approval: { approvalId: 'appr_1' },
      decision: { reason: 'risk gate', riskLevel: 'R2' },
      run: { runId: 'run_appr', correlationId: 'corr_appr' },
    },
  }));

  const exec = new AiExecutionService({
    callId: 'c_rt_appr',
    llm: null,
    runtimeUrl: 'http://runtime.test',
    runtimeFetch: fetchFn,
  });
  await assert.rejects(() => exec.run(doubleTask(1)), /approvalId=appr_1/);
});

test('Runtime stub without output value falls back to deterministic', async () => {
  const fetchFn = mockRuntimeFetch(() => ({
    status: 200,
    body: {
      status: 'completed',
      run: { runId: 'run_stub', correlationId: 'corr_stub' },
      execution: { executionId: 'exec_stub', cost: { units: 3 } },
      decision: { riskLevel: 'R1' },
      result: {
        status: 'succeeded',
        executor: 'runtime-stub',
        durationMs: 1,
        cost: { units: 3 },
        metadata: {},
      },
    },
  }));

  const exec = new AiExecutionService({
    callId: 'c_rt_stub',
    llm: null,
    runtimeUrl: 'http://runtime.test',
    runtimeFetch: fetchFn,
  });
  const res = await exec.run(doubleTask(21));
  assert.equal(res.output, 42, 'deterministic fallback');
  assert.equal(res.fellBack, true);
  assert.equal(res.costUnits, 3);
});

test('outcome attribution links run/execution ids and cost', () => {
  const attribution = buildCallOutcomeAttribution({
    callId: 'call_1',
    runIds: ['run_a', 'run_b'],
    executionIds: ['exec_a'],
    totalCostUnits: 10,
    totalTokens: 100,
    advanced: true,
    stageBeforeId: 'discovery',
    stageAfterId: 'proposal',
    summary: 'Moved to proposal',
  });
  assert.equal(attribution.callId, 'call_1');
  assert.deepEqual(attribution.runIds, ['run_a', 'run_b']);
  assert.deepEqual(attribution.executionIds, ['exec_a']);
  assert.equal(attribution.totalCostUnits, 10);
  assert.equal(attribution.totalTokens, 100);
  assert.equal(attribution.outcome.advanced, true);
  assert.equal(attribution.outcome.status, 'realized');
  assert.equal(attribution.metadata.product, 'revenue-copilot');
});

test('ADR-007 fail-closed: production without Runtime URL throws', () => {
  assert.throws(
    () =>
      resolveRuntimeUrl({
        AION_ENVIRONMENT: 'production',
      } as NodeJS.ProcessEnv),
    /AION_RUNTIME_URL is required/,
  );
});

test('ADR-007 fail-closed: staging with URL resolves', () => {
  assert.equal(
    resolveRuntimeUrl({
      AION_ENVIRONMENT: 'staging',
      AION_RUNTIME_URL: 'http://runtime.example',
    } as NodeJS.ProcessEnv),
    'http://runtime.example',
  );
});

test('ADR-007 packaging hatch allows in-memory under production label', () => {
  assert.equal(
    resolveRuntimeUrl({
      AION_ENVIRONMENT: 'production',
      AION_ALLOW_IN_MEMORY_CONTROL_PLANE: '1',
    } as NodeJS.ProcessEnv),
    undefined,
  );
});
