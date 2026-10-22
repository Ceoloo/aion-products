/**
 * AIO-39 — inbound auth, session ownership, body limits for Revenue Copilot HTTP.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import {
  resolveCopilotAuthMode,
  loadCopilotAuthConfig,
  CopilotAuthConfigError,
} from '../src/server/inbound-auth.ts';
import { startCopilotServer, setAuthConfigForTests } from '../src/server.ts';
import { fundingDiscoveryCall } from '../fixtures/funding-discovery-call.ts';

async function json(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('resolveCopilotAuthMode', () => {
  it('defaults open only on local; rejects open off-local', () => {
    assert.equal(resolveCopilotAuthMode('local', undefined), 'open');
    assert.equal(resolveCopilotAuthMode('staging', undefined), 'required');
    assert.equal(resolveCopilotAuthMode('production', undefined), 'required');
    assert.throws(
      () => resolveCopilotAuthMode('production', 'open'),
      (e: unknown) => e instanceof CopilotAuthConfigError,
    );
  });
});

describe('loadCopilotAuthConfig', () => {
  it('requires keys when mode is required', () => {
    assert.throws(
      () =>
        loadCopilotAuthConfig({
          AION_ENVIRONMENT: 'production',
          AION_COPILOT_AUTH_MODE: 'required',
        }),
      (e: unknown) => e instanceof CopilotAuthConfigError,
    );
  });

  it('accepts single API key shorthand', () => {
    const cfg = loadCopilotAuthConfig({
      AION_ENVIRONMENT: 'production',
      AION_COPILOT_API_KEY: 'test-key-at-least-8',
      AION_TENANT_ID: 'tenant_x',
    });
    assert.equal(cfg.mode, 'required');
    assert.equal(cfg.apiKeys.length, 1);
    assert.equal(cfg.apiKeys[0]!.caller.tenantId, 'tenant_x');
  });
});

describe('HTTP auth + ownership', () => {
  const keys = {
    mode: 'required' as const,
    apiKeys: [
      {
        token: 'caller-a-secret-token',
        caller: { callerId: 'caller_a', tenantId: 'tenant_a' },
      },
      {
        token: 'caller-b-secret-token',
        caller: { callerId: 'caller_b', tenantId: 'tenant_b' },
      },
    ],
  };

  let previous: ReturnType<typeof loadCopilotAuthConfig>;

  before(() => {
    // Capture open default so other suites stay isolated after this file.
    previous = loadCopilotAuthConfig({ AION_ENVIRONMENT: 'local' });
    setAuthConfigForTests(keys);
  });

  after(() => {
    setAuthConfigForTests(previous);
  });

  it('rejects unauthenticated session create', async () => {
    const server = await startCopilotServer(0);
    try {
      const res = await json(server, 'POST', '/v1/sessions', {
        industry: fundingDiscoveryCall.industry,
        context: fundingDiscoveryCall.context,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'auth_required');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('scopes list/read/delete to the owning caller', async () => {
    const server = await startCopilotServer(0);
    const authA = { authorization: 'Bearer caller-a-secret-token' };
    const authB = { authorization: 'Bearer caller-b-secret-token' };
    try {
      const created = await json(
        server,
        'POST',
        '/v1/sessions',
        {
          industry: fundingDiscoveryCall.industry,
          context: fundingDiscoveryCall.context,
          callId: 'owned_by_a',
        },
        authA,
      );
      assert.equal(created.status, 201);
      const sessionId = created.body.sessionId as string;
      assert.equal(created.body.callerId, 'caller_a');

      const listedA = await json(server, 'GET', '/v1/sessions', undefined, authA);
      assert.equal(listedA.status, 200);
      assert.equal(listedA.body.count, 1);

      const listedB = await json(server, 'GET', '/v1/sessions', undefined, authB);
      assert.equal(listedB.status, 200);
      assert.equal(listedB.body.count, 0);

      const readB = await json(
        server,
        'GET',
        `/v1/sessions/${sessionId}`,
        undefined,
        authB,
      );
      assert.equal(readB.status, 404);

      const delB = await json(
        server,
        'DELETE',
        `/v1/sessions/${sessionId}`,
        undefined,
        authB,
      );
      assert.equal(delB.status, 404);

      const delA = await json(
        server,
        'DELETE',
        `/v1/sessions/${sessionId}`,
        undefined,
        authA,
      );
      assert.equal(delA.status, 200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('rejects cross-tenant header spoofing', async () => {
    const server = await startCopilotServer(0);
    try {
      const res = await json(
        server,
        'GET',
        '/v1/sessions',
        undefined,
        {
          authorization: 'Bearer caller-a-secret-token',
          'x-aion-tenant-id': 'tenant_b',
        },
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'tenant_forbidden');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns 413 for oversized request bodies', async () => {
    const server = await startCopilotServer(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const huge = 'x'.repeat(1_048_576 + 64);
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer caller-a-secret-token',
        },
        body: `{"pad":"${huge}"}`,
      });
      assert.equal(res.status, 413);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, 'payload_too_large');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
