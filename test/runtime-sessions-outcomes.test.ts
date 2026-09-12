/**
 * Runtime revenue-sessions + outcomes client / store — mocked HTTP.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RuntimeClient,
  RuntimeApiError,
} from '../src/platform/runtime-client.ts';
import {
  buildCallOutcomeAttribution,
  toCreateOutcomeInput,
  publishCallOutcome,
} from '../src/platform/outcome.ts';
import { RuntimeRevenueSessionStore } from '../src/validation/runtime-session-store.ts';
import { createSessionStore } from '../src/validation/runtime-session-store.ts';
import { InMemorySessionStore } from '../src/validation/store.ts';
import type { SessionRecord } from '../src/domain/session.ts';

function stubRecord(id: string, finalized = true): SessionRecord {
  return {
    sessionId: id,
    prospectId: 'acct_1',
    repId: 'rep_1',
    industry: 'funding',
    createdAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: finalized ? '2026-09-01T00:05:00.000Z' : null,
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
      transcript: [],
      finalState: {
        conversationStage: 'discovery',
        sentiment: 'neutral',
        urgency: 'medium',
        position: { startOrder: 0, currentOrder: 1, highWaterOrder: 1 },
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
      trace: {
        total: 0,
        telemetryRows: 0,
        executionRows: 0,
        byModel: {},
        fallbacks: 0,
        avgLatencyMs: 0,
        correlationIds: 0,
      },
    },
    repBehavior: { outcomes: [] },
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
      groundTruth: null,
    },
  };
}

type MockRoute = {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  capture?: unknown[];
};

function mockFetch(routes: MockRoute[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname + new URL(url).search;
    const pathOnly = new URL(url).pathname;
    for (const route of routes) {
      const match =
        typeof route.path === 'string'
          ? path === route.path || pathOnly === route.path
          : route.path.test(path) || route.path.test(pathOnly);
      if (match && route.method === method) {
        if (route.capture && init?.body) {
          route.capture.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify(route.body ?? {}), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'not_found', message: path }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('RuntimeClient outcomes + revenue-sessions', () => {
  it('creates and lists outcomes via /v1/outcomes', async () => {
    const creates: unknown[] = [];
    const client = new RuntimeClient({
      baseUrl: 'http://runtime.test',
      fetch: mockFetch([
        {
          method: 'POST',
          path: '/v1/outcomes',
          capture: creates,
          body: {
            outcome: {
              outcomeId: 'out_1',
              runId: 'run_a',
              status: 'realized',
              outcomeType: 'revenue.call',
              measuredAt: '2026-09-12T00:00:00.000Z',
              metadata: {},
            },
          },
        },
        {
          method: 'GET',
          path: '/v1/outcomes?runId=run_a',
          body: {
            outcomes: [
              {
                outcomeId: 'out_1',
                runId: 'run_a',
                status: 'realized',
                outcomeType: 'revenue.call',
              },
            ],
            count: 1,
          },
        },
      ]),
    });

    const created = await client.createOutcome({
      runId: 'run_a',
      status: 'realized',
      outcomeType: 'revenue.call',
    });
    assert.equal(created.outcome.outcomeId, 'out_1');
    assert.equal((creates[0] as { runId: string }).runId, 'run_a');

    const listed = await client.listOutcomes({ runId: 'run_a' });
    assert.equal(listed.count, 1);
    assert.equal(listed.outcomes[0]!.outcomeId, 'out_1');
  });

  it('CRUD revenue-sessions with revision', async () => {
    const puts: unknown[] = [];
    let revision = 0;
    const store = new Map<string, { checkpoint: unknown; finalRecord: unknown; revision: number }>();

    const client = new RuntimeClient({
      baseUrl: 'http://runtime.test',
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;

        if (method === 'POST' && url.pathname === '/v1/revenue-sessions') {
          store.set(body.sessionId, {
            checkpoint: body.checkpoint,
            finalRecord: null,
            revision: 0,
          });
          return Response.json({
            session: {
              sessionId: body.sessionId,
              checkpoint: body.checkpoint,
              finalRecord: null,
              revision: 0,
            },
          });
        }
        const m = url.pathname.match(/^\/v1\/revenue-sessions\/([^/]+)$/);
        if (m && method === 'GET') {
          const row = store.get(decodeURIComponent(m[1]!));
          if (!row) {
            return Response.json({ error: 'not_found', message: 'missing' }, { status: 404 });
          }
          return Response.json({
            session: { sessionId: decodeURIComponent(m[1]!), ...row },
          });
        }
        if (m && method === 'PUT') {
          puts.push(body);
          const id = decodeURIComponent(m[1]!);
          const row = store.get(id);
          if (!row || row.revision !== body.revision) {
            return Response.json(
              { error: 'stale_revision', message: 'conflict' },
              { status: 409 },
            );
          }
          revision = row.revision + 1;
          const next = {
            checkpoint: body.checkpoint === undefined ? row.checkpoint : body.checkpoint,
            finalRecord: body.finalRecord === undefined ? row.finalRecord : body.finalRecord,
            revision,
          };
          store.set(id, next);
          return Response.json({ session: { sessionId: id, ...next } });
        }
        if (method === 'GET' && url.pathname === '/v1/revenue-sessions') {
          const status = url.searchParams.get('status');
          const sessions = [...store.entries()]
            .filter(([, r]) =>
              status === 'finalized' ? r.finalRecord != null : r.finalRecord == null,
            )
            .map(([sessionId, r]) => ({ sessionId, ...r }));
          return Response.json({ sessions, count: sessions.length });
        }
        return Response.json({ error: 'not_found' }, { status: 404 });
      },
    });

    const sessionStore = new RuntimeRevenueSessionStore(client);
    const record = stubRecord('sess_rt_1');
    await sessionStore.save(record);
    const got = await sessionStore.get('sess_rt_1');
    assert.ok(got);
    assert.equal(got!.sessionId, 'sess_rt_1');
    assert.equal(got!.finalizedAt, record.finalizedAt);
    assert.ok(puts.length >= 1);
    assert.equal((puts[0] as { revision: number }).revision, 0);

    const listed = await sessionStore.list();
    assert.equal(listed.length, 1);
  });

  it('createSessionStore falls back offline when Runtime URL unset', () => {
    const store = createSessionStore({
      runtimeUrl: null,
      preferMemory: true,
    });
    assert.ok(store instanceof InMemorySessionStore);
  });

  it('toCreateOutcomeInput + publishCallOutcome map attribution', async () => {
    const attribution = buildCallOutcomeAttribution({
      callId: 'call_1',
      runIds: ['run_a', 'run_b'],
      executionIds: ['exec_a'],
      totalCostUnits: 10,
      advanced: true,
      stageBeforeId: 'discovery',
      stageAfterId: 'proposal',
      value: 5000,
      currency: 'USD',
    });
    const input = toCreateOutcomeInput(attribution);
    assert.ok(input);
    assert.equal(input!.runId, 'run_a');
    assert.equal(input!.outcomeType, 'revenue.call');
    assert.equal(input!.status, 'realized');
    assert.equal(input!.value, 5000);
    assert.equal(input!.currency, 'USD');
    assert.equal(input!.metadata!.callId, 'call_1');
    assert.deepEqual(input!.metadata!.executionIds, ['exec_a']);
    assert.equal(input!.metadata!.totalCostUnits, 10);

    assert.equal(toCreateOutcomeInput({ ...attribution, runIds: [] }), null);

    const creates: unknown[] = [];
    const client = new RuntimeClient({
      baseUrl: 'http://runtime.test',
      fetch: mockFetch([
        {
          method: 'POST',
          path: '/v1/outcomes',
          capture: creates,
          body: {
            outcome: {
              outcomeId: 'out_pub',
              runId: 'run_a',
              status: 'realized',
              outcomeType: 'revenue.call',
            },
          },
        },
      ]),
    });
    const published = await publishCallOutcome(client, attribution);
    assert.equal(published!.outcomeId, 'out_pub');
    assert.equal((creates[0] as { runId: string }).runId, 'run_a');
  });

  it('RuntimeApiError surfaces HTTP failures', async () => {
    const client = new RuntimeClient({
      baseUrl: 'http://runtime.test',
      fetch: mockFetch([
        {
          method: 'GET',
          path: '/v1/outcomes/missing',
          status: 404,
          body: { error: 'not_found', message: 'nope' },
        },
      ]),
    });
    await assert.rejects(
      () => client.getOutcome('missing'),
      (err: unknown) =>
        err instanceof RuntimeApiError && err.status === 404 && err.code === 'not_found',
    );
  });
});
