import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCopilot, buildReport } from '../src/aion.ts';
import { AiExecutionService } from '../src/platform/ai-execution.ts';
import { LiveCopilot } from '../src/pipeline/copilot.ts';
import { getSchema } from '../src/config/registry.ts';
import { getFixture } from '../fixtures/index.ts';
import { RuntimeActiveSessionStore, type ActiveSessionCheckpoint } from '../src/validation/active-session.ts';
import type { RuntimeClient } from '../src/platform/runtime-client.ts';
import type { RevenueSessionRecord } from '../src/platform/runtime-contracts.ts';
import http from 'node:http';

test('restores a committed active call without replaying prior Core executions', async () => {
  const fixture = getFixture('funding-discovery-call');
  const callId = 'recovery_call';
  const { copilot, exec } = await createCopilot({
    callId, industry: fixture.industry, context: fixture.context, llm: null, runtimeUrl: '',
  });
  const initialTurns = fixture.turns.slice(0, 4);
  for (const turn of initialTurns) await copilot.ingest(turn);
  const first = copilot.getSurfaced()[0];
  assert.ok(first);
  copilot.recordFeedback(first.id, 'acted_on', initialTurns.at(-1)!.index);

  const copilotCheckpoint = JSON.parse(JSON.stringify(copilot.checkpoint()));
  const executionCheckpoint = JSON.parse(JSON.stringify(exec.checkpoint()));
  const resumedExec = new AiExecutionService({ callId, llm: null, runtimeUrl: '' });
  resumedExec.restore(executionCheckpoint);
  const resumed = LiveCopilot.restore(resumedExec, getSchema(fixture.industry), copilotCheckpoint);

  assert.deepEqual(resumed.getTranscript(), initialTurns);
  assert.deepEqual(resumed.getLineage(), copilot.getLineage());
  assert.deepEqual(resumedExec.attributionIds(), exec.attributionIds());
  const priorRuns = resumedExec.traceSummary().total;
  assert.equal(priorRuns, exec.traceSummary().total);

  for (const turn of fixture.turns.slice(4)) await resumed.ingest(turn);
  const report = buildReport(resumed, resumedExec, getSchema(fixture.industry));
  assert.equal(report.trace.total, resumedExec.traceSummary().total);
  assert.ok(report.trace.total > priorRuns);
  assert.equal(report.learning.records.find((r) => r.recommendationId === first.id)?.feedback, 'acted_on');
  assert.equal(resumed.getTranscript().length, fixture.turns.length);
});

test('active checkpoint uses expected revision so a concurrent writer cannot overwrite it', async () => {
  const fixture = getFixture('funding-discovery-call');
  const { copilot, exec } = await createCopilot({
    callId: 'cas_call', industry: fixture.industry, context: fixture.context, llm: null, runtimeUrl: '',
  });
  const checkpoint: ActiveSessionCheckpoint = {
    version: 1, sessionId: 'sess_cas', callId: 'cas_call', industry: fixture.industry,
    context: fixture.context, createdAt: Date.now(), lastAccessAt: Date.now(),
    inFlight: null, copilot: copilot.checkpoint(), execution: exec.checkpoint(),
  };
  let row: RevenueSessionRecord | undefined;
  const transport = {
    async createRevenueSession(input: { sessionId: string; checkpoint: unknown }) {
      row = { sessionId: input.sessionId, checkpoint: input.checkpoint, finalRecord: null, revision: 1 };
      return { session: structuredClone(row) };
    },
    async getRevenueSession() { assert.ok(row); return { session: structuredClone(row) }; },
    async updateRevenueSession(_id: string, input: { revision: number; checkpoint: unknown }) {
      assert.ok(row);
      if (row.revision !== input.revision) throw new Error('stale_revision');
      row = { ...row, checkpoint: input.checkpoint, revision: row.revision + 1 };
      return { session: structuredClone(row) };
    },
  } as unknown as RuntimeClient;
  const first = new RuntimeActiveSessionStore(transport);
  const second = new RuntimeActiveSessionStore(transport);
  const initialRevision = await first.create(checkpoint);
  const competing = await second.get(checkpoint.sessionId);
  assert.ok(competing);
  const next = { ...checkpoint, inFlight: 'turn' as const };
  assert.equal(await first.save(next, initialRevision), 2);
  await assert.rejects(second.save({ ...competing.checkpoint, inFlight: 'feedback' }, competing.revision), /stale_revision/);
  assert.equal((await first.get(checkpoint.sessionId))?.checkpoint.inFlight, 'turn');
});

test('HTTP session resumes a committed turn after the Copilot process restarts', async () => {
  const rows = new Map<string, RevenueSessionRecord>();
  let commandCount = 0;
  const runtime = http.createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let status = 200;
    let result: unknown;
    if (path === '/v1/commands' && req.method === 'POST') {
      commandCount += 1;
      result = {
        status: 'succeeded', run: { runId: `run_${commandCount}`, correlationId: `corr_${commandCount}` },
        execution: { executionId: `exe_${commandCount}` },
        decision: { riskLevel: 'R1' },
        result: { status: 'succeeded', output: {}, executor: 'mock-runtime', durationMs: 1, cost: { units: 1 } },
      };
    } else if (path === '/v1/revenue-sessions' && req.method === 'POST') {
      const row = { sessionId: body.sessionId, checkpoint: body.checkpoint, finalRecord: null, revision: 1 };
      rows.set(row.sessionId, row);
      result = { session: row };
    } else if (path === '/v1/revenue-sessions' && req.method === 'GET') {
      result = { sessions: [...rows.values()].filter((r) => r.finalRecord === null) };
    } else if (path.startsWith('/v1/revenue-sessions/')) {
      const id = decodeURIComponent(path.split('/').at(-1)!);
      const prior = rows.get(id);
      if (!prior) { status = 404; result = { error: 'not_found' }; }
      else if (req.method === 'GET') result = { session: prior };
      else if (req.method === 'PUT' && prior.revision === body.revision) {
        const row = { ...prior, checkpoint: body.checkpoint, finalRecord: body.finalRecord ?? null, revision: prior.revision + 1 };
        rows.set(id, row);
        result = { session: row };
      } else { status = 409; result = { error: 'stale_revision' }; }
    } else { status = 404; result = { error: 'not_found' }; }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => runtime.listen(0, '127.0.0.1', resolve));
  const runtimePort = (runtime.address() as { port: number }).port;
  const priorUrl = process.env.AION_RUNTIME_URL;
  process.env.AION_RUNTIME_URL = `http://127.0.0.1:${runtimePort}`;
  let firstServer: http.Server | undefined;
  let secondServer: http.Server | undefined;
  let thirdServer: http.Server | undefined;
  try {
    const firstPath = '../src/server.ts?restart-first';
    const first = await import(firstPath) as typeof import('../src/server.ts');
    firstServer = await first.startCopilotServer(0);
    const origin = (server: http.Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const fixture = getFixture('funding-discovery-call');
    const created = await fetch(`${origin(firstServer!)}/v1/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ industry: fixture.industry, context: fixture.context }),
    });
    assert.equal(created.status, 201);
    const { sessionId } = await created.json() as { sessionId: string };
    const postTurn = (server: http.Server, turn: unknown) => fetch(`${origin(server)}/v1/sessions/${sessionId}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turn }),
    });
    assert.equal((await postTurn(firstServer!, fixture.turns[0])).status, 200);
    const runsAfterFirstTurn = commandCount;
    await new Promise<void>((resolve) => firstServer!.close(() => resolve()));
    firstServer = undefined;

    const secondPath = '../src/server.ts?restart-second';
    const second = await import(secondPath) as typeof import('../src/server.ts');
    secondServer = await second.startCopilotServer(0);
    const recovered = await fetch(`${origin(secondServer!)}/v1/sessions/${sessionId}`);
    assert.equal(recovered.status, 200);
    assert.equal(((await recovered.json()) as { transcript: unknown[] }).transcript.length, 1);
    assert.equal(commandCount, runsAfterFirstTurn, 'read recovery must not replay AI work');
    assert.equal((await postTurn(secondServer!, fixture.turns[1])).status, 200);
    assert.equal((rows.get(sessionId)?.checkpoint as ActiveSessionCheckpoint).copilot.transcript.length, 2);

    // A crash after the operation marker but before the committed snapshot is
    // ambiguous; recovery must stop rather than execute the same turn twice.
    const row = rows.get(sessionId)!;
    rows.set(sessionId, { ...row, revision: row.revision + 1,
      checkpoint: { ...(row.checkpoint as ActiveSessionCheckpoint), inFlight: 'turn' } });
    await new Promise<void>((resolve) => secondServer!.close(() => resolve()));
    secondServer = undefined;
    const thirdPath = '../src/server.ts?restart-ambiguous';
    const third = await import(thirdPath) as typeof import('../src/server.ts');
    thirdServer = await third.startCopilotServer(0);
    const beforeRetry = commandCount;
    const retry = await postTurn(thirdServer, fixture.turns[2]);
    assert.equal(retry.status, 409);
    assert.equal((await retry.json() as { error: string }).error, 'reconciliation_required');
    assert.equal(commandCount, beforeRetry);
  } finally {
    if (firstServer?.listening) await new Promise<void>((resolve) => firstServer!.close(() => resolve()));
    if (secondServer?.listening) await new Promise<void>((resolve) => secondServer!.close(() => resolve()));
    if (thirdServer?.listening) await new Promise<void>((resolve) => thirdServer!.close(() => resolve()));
    await new Promise<void>((resolve) => runtime.close(() => resolve()));
    if (priorUrl === undefined) delete process.env.AION_RUNTIME_URL;
    else process.env.AION_RUNTIME_URL = priorUrl;
  }
});
