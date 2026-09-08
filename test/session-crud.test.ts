/**
 * Session CRUD — store adapters, ground-truth re-apply, console + production HTTP.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type http from 'node:http';

import { InMemorySessionStore, JsonSessionStore } from '../src/validation/store.ts';
import { applyGroundTruthToRecord } from '../src/validation/record.ts';
import type { GroundTruth, SessionRecord } from '../src/domain/session.ts';
import { startCopilotServer } from '../src/server.ts';
import { fundingDiscoveryCall } from '../fixtures/funding-discovery-call.ts';

function stubRecord(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: id,
    prospectId: 'acct_1',
    repId: 'rep_1',
    industry: 'funding',
    createdAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: '2026-09-01T00:05:00.000Z',
    kind: 'conversation',
    disposition: 'conversation',
    evaluable: true,
    before: {
      conversionStageId: 'contact',
      context: {
        prospect: { id: 'acct_1', name: 'Marcus' },
        company: { name: 'Acme' },
        offer: { name: 'Working capital', summary: '', constraints: [], differentiators: [] },
        crmState: {},
        priorConversations: [],
        priorObjections: [],
        outstandingQuestions: [],
        knownFacts: {},
        conversionStageId: 'contact',
        desiredNextStageId: 'application',
      },
    },
    during: {
      transcript: [
        { index: 0, speaker: 'rep', text: 'Hi Marcus' },
        { index: 1, speaker: 'prospect', text: 'We do eighty five thousand a month and I own the shop with four employees.' },
        { index: 2, speaker: 'prospect', text: 'I need working capital for inventory soon because cash flow is tight on bigger orders.' },
      ],
      finalState: {
        conversationStage: 'discovery',
        sentiment: 'neutral',
        urgency: 'medium',
        position: { startOrder: 0, currentOrder: 2, highWaterOrder: 2 },
        facts: {},
        readiness: { level: 'partial', score: 0.4, primaryBlocker: null, signals: [] },
        objections: [],
        buyingSignals: [],
        gaps: [],
        missingInformation: [],
      } as unknown as SessionRecord['during']['finalState'],
      recommendations: [],
      objections: [],
      buyingSignals: [],
      commitments: [],
      lineage: [],
      trace: { total: 0, telemetryRows: 0, executionRows: 0, byModel: {}, fallbacks: 0, avgLatencyMs: 0, correlationIds: 0 },
    },
    repBehavior: { outcomes: [] },
    after: {
      aiOutcome: {
        advanced: false,
        stageBeforeId: 'contact',
        stageAfterId: 'engaged',
        stageBeforeOrder: 0,
        stageAfterOrder: 1,
        reachedMeaningfulConversion: false,
        meaningfulConversionId: null,
      },
      groundTruth: null,
    },
    ...overrides,
  };
}

const gt = (overrides: Partial<GroundTruth> = {}): GroundTruth => ({
  fields: { pain: { verdict: 'correct' } },
  guidance: 'useful',
  outcome: 'application',
  advanced: true,
  downstreamConversion: 'application',
  disposition: 'conversation',
  evaluable: true,
  notes: 'ok',
  ...overrides,
});

describe('SessionStore CRUD', () => {
  it('InMemorySessionStore update + delete', async () => {
    const store = new InMemorySessionStore();
    const rec = stubRecord('sess_mem');
    assert.equal(await store.update(rec), false);
    await store.save(rec);
    assert.equal((await store.list()).length, 1);
    const patched = { ...rec, evaluable: false, kind: 'session' as const };
    assert.equal(await store.update(patched), true);
    assert.equal((await store.get('sess_mem'))?.evaluable, false);
    assert.equal(await store.delete('sess_mem'), true);
    assert.equal(await store.get('sess_mem'), undefined);
    assert.equal(await store.delete('sess_mem'), false);
  });

  it('JsonSessionStore update + delete round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aion-crud-'));
    try {
      const store = new JsonSessionStore(dir);
      const rec = stubRecord('sess_json');
      assert.equal(await store.update(rec), false);
      await store.save(rec);
      assert.ok(await store.get('sess_json'));
      const next = { ...rec, disposition: 'callback' as const, evaluable: false };
      assert.equal(await store.update(next), true);
      assert.equal((await store.get('sess_json'))?.disposition, 'callback');
      assert.equal(await store.delete('sess_json'), true);
      assert.equal(await store.get('sess_json'), undefined);
      assert.equal((await store.list()).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('applyGroundTruthToRecord', () => {
  it('reclassifies kind/evaluable from ground truth', () => {
    const base = stubRecord('sess_gt');
    const updated = applyGroundTruthToRecord(base, gt(), '2026-09-08T12:00:00.000Z');
    assert.equal(updated.finalizedAt, '2026-09-08T12:00:00.000Z');
    assert.equal(updated.evaluable, true);
    assert.equal(updated.disposition, 'conversation');
    assert.equal(updated.after.groundTruth?.outcome, 'application');
    assert.ok(updated.kind === 'conversation' || updated.kind === 'qualified_conversation');

    const cleared = applyGroundTruthToRecord(updated, null, '2026-09-08T13:00:00.000Z');
    assert.equal(cleared.finalizedAt, null);
    assert.equal(cleared.after.groundTruth, null);
  });
});

async function consoleJson(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handler(req, res).catch(reject);
    });
    server.listen(0, '127.0.0.1', async () => {
      try {
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method,
          headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        resolve({ status: res.status, body: text ? JSON.parse(text) : null });
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

describe('console persisted session CRUD HTTP', () => {
  let handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  let setSessionStoreForTests: (s: InMemorySessionStore) => void;
  let store: InMemorySessionStore;

  before(async () => {
    process.env.AION_CONSOLE_NO_AUTOSTART = '1';
    const mod = await import('../src/server/app.ts');
    handle = mod.handle;
    setSessionStoreForTests = mod.setSessionStoreForTests;
    store = new InMemorySessionStore();
    setSessionStoreForTests(store);
  });

  after(() => {
    setSessionStoreForTests(new InMemorySessionStore());
  });

  it('lists, reads, updates, and deletes persisted records', async () => {
    store = new InMemorySessionStore();
    setSessionStoreForTests(store);
    await store.save(stubRecord('sess_http_1', {
      after: {
        aiOutcome: {
          advanced: true,
          stageBeforeId: 'contact',
          stageAfterId: 'engaged',
          stageBeforeOrder: 0,
          stageAfterOrder: 1,
          reachedMeaningfulConversion: false,
          meaningfulConversionId: null,
        },
        groundTruth: gt({ outcome: 'engaged', advanced: false, downstreamConversion: null }),
      },
    }));

    const listed = await consoleJson(handle, 'GET', '/api/sessions');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.count, 1);
    assert.equal(listed.body.records[0].sessionId, 'sess_http_1');
    assert.equal(listed.body.records[0].prospect, 'Marcus');

    const one = await consoleJson(handle, 'GET', '/api/sessions/sess_http_1');
    assert.equal(one.status, 200);
    assert.equal(one.body.record.sessionId, 'sess_http_1');
    assert.ok(one.body.score);

    const patched = await consoleJson(handle, 'PATCH', '/api/sessions/sess_http_1', {
      groundTruth: gt({ outcome: 'application', advanced: true, notes: 'corrected' }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.updated, true);
    assert.equal(patched.body.record.after.groundTruth.notes, 'corrected');
    assert.equal(patched.body.record.after.groundTruth.outcome, 'application');

    const missingPatch = await consoleJson(handle, 'PATCH', '/api/sessions/nope', {
      groundTruth: gt(),
    });
    assert.equal(missingPatch.status, 404);

    const badPatch = await consoleJson(handle, 'PATCH', '/api/sessions/sess_http_1', { notes: 'x' });
    assert.equal(badPatch.status, 400);

    const del = await consoleJson(handle, 'DELETE', '/api/sessions/sess_http_1');
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, true);
    assert.equal(await store.get('sess_http_1'), undefined);

    const gone = await consoleJson(handle, 'GET', '/api/sessions/sess_http_1');
    assert.equal(gone.status, 404);
  });
});

async function prodJson(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('production /v1 session CRUD', () => {
  it('lists, reads, and deletes live sessions', async () => {
    const server = await startCopilotServer(0);
    try {
      const empty = await prodJson(server, 'GET', '/v1/sessions');
      assert.equal(empty.status, 200);
      assert.equal(empty.body.count, 0);

      const created = await prodJson(server, 'POST', '/v1/sessions', {
        industry: fundingDiscoveryCall.industry,
        context: fundingDiscoveryCall.context,
        callId: 'crud_live',
      });
      assert.equal(created.status, 201);
      const sessionId = created.body.sessionId as string;

      const listed = await prodJson(server, 'GET', '/v1/sessions');
      assert.equal(listed.status, 200);
      assert.equal(listed.body.count, 1);
      assert.equal(listed.body.sessions[0].sessionId, sessionId);

      const one = await prodJson(server, 'GET', `/v1/sessions/${sessionId}`);
      assert.equal(one.status, 200);
      assert.equal(one.body.callId, 'crud_live');
      assert.ok(one.body.state);
      assert.ok(Array.isArray(one.body.transcript));

      const del = await prodJson(server, 'DELETE', `/v1/sessions/${sessionId}`);
      assert.equal(del.status, 200);
      assert.equal(del.body.deleted, true);

      const gone = await prodJson(server, 'GET', `/v1/sessions/${sessionId}`);
      assert.equal(gone.status, 404);
      assert.equal((await prodJson(server, 'GET', '/v1/sessions')).body.count, 0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
