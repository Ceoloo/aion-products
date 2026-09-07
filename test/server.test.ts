/**
 * HTTP entrypoint tests for Revenue Copilot (shape #2).
 * Deterministic — no API keys required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { startCopilotServer } from '../src/server.ts';
import { fundingDiscoveryCall } from '../fixtures/funding-discovery-call.ts';

async function json(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('revenue-copilot HTTP service', () => {
  it('serves health + release identity', async () => {
    const server = await startCopilotServer(0);
    try {
      const live = await json(server, 'GET', '/health/live');
      assert.equal(live.status, 200);
      assert.equal(live.body.status, 'ok');

      const ready = await json(server, 'GET', '/health/ready');
      assert.equal(ready.status, 200);
      assert.equal(ready.body.status, 'ready');
      assert.equal(ready.body.provider, 'deterministic');

      const root = await json(server, 'GET', '/');
      assert.equal(root.status, 200);
      assert.equal(root.body.service, 'aion-revenue-copilot');
      assert.equal(root.body.entrypoint, 'http-turn-stream');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('runs a session through turns and finish (deterministic)', async () => {
    const server = await startCopilotServer(0);
    try {
      const created = await json(server, 'POST', '/v1/sessions', {
        industry: fundingDiscoveryCall.industry,
        context: fundingDiscoveryCall.context,
        callId: 'test_http_funding',
      });
      assert.equal(created.status, 201);
      assert.ok(created.body.sessionId);
      assert.ok(typeof created.body.briefing === 'string');

      const sessionId = created.body.sessionId as string;
      const firstTurn = fundingDiscoveryCall.turns[0]!;
      const turnRes = await json(server, 'POST', `/v1/sessions/${sessionId}/turns`, {
        turn: firstTurn,
      });
      assert.equal(turnRes.status, 200);
      assert.equal(turnRes.body.turnIndex, firstTurn.index);
      assert.ok(turnRes.body.state);
      assert.ok(Array.isArray(turnRes.body.recommendations));

      const finished = await json(server, 'POST', `/v1/sessions/${sessionId}/finish`);
      assert.equal(finished.status, 200);
      assert.ok(finished.body.report);
      assert.equal(finished.body.callId, 'test_http_funding');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('rejects invalid industry', async () => {
    const server = await startCopilotServer(0);
    try {
      const res = await json(server, 'POST', '/v1/sessions', {
        industry: 'not-a-schema',
        context: fundingDiscoveryCall.context,
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_industry');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
