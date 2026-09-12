import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

test('Runtime client reports gateway failures instead of a successful empty dashboard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aion-runtime-client-'));
  const originalFetch = globalThis.fetch;
  try {
    await build({ configFile: false, logLevel: 'error', build: {
      outDir: dir, lib: { entry: resolve('src/lib/runtime-api.ts'), formats: ['es'], fileName: () => 'client.mjs' },
    } });
    const { RuntimeApi, RuntimeHttpError } = await import(pathToFileURL(join(dir, 'client.mjs')).href);
    for (const [body, status, code] of [
      ['<html>SPA fallback</html>', 200, 'invalid_json'],
      ['<html>Gateway error</html>', 502, 'invalid_json'],
      ['', 200, 'empty_response'],
      ['null', 403, 'http_error'],
      ['{"error":"forbidden","message":"Denied"}', 403, 'forbidden'],
    ]) {
      globalThis.fetch = async () => new Response(body, { status });
      await assert.rejects(RuntimeApi.listMissions('test'), err =>
        err instanceof RuntimeHttpError && err.status === status && err.code === code);
    }
    globalThis.fetch = async () => new Response('{"missions":[]}');
    assert.deepEqual(await RuntimeApi.listMissions('test'), { missions: [] });

    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.match(url, /\/v1\/outcomes\?missionId=m1/);
      return new Response(JSON.stringify({
        outcomes: [{ outcomeId: 'out_1', runId: 'run_1', status: 'realized', outcomeType: 'revenue.call' }],
        count: 1,
      }));
    };
    const listed = await RuntimeApi.listOutcomes('test', { missionId: 'm1' });
    assert.equal(listed.count, 1);
    assert.equal(listed.outcomes[0].outcomeId, 'out_1');

    globalThis.fetch = async (input) => {
      assert.match(String(input), /\/v1\/outcomes\/out_1$/);
      return new Response(JSON.stringify({
        outcome: { outcomeId: 'out_1', runId: 'run_1', status: 'pending' },
      }));
    };
    const got = await RuntimeApi.getOutcome('test', 'out_1');
    assert.equal(got.outcome.outcomeId, 'out_1');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
