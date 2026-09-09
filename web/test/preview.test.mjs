import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// Build the real preview adapter through the same Vite boundary as the SPA.
// Importing its browser bundle catches runtime regressions hidden by typecheck.
test('canonical browser preview: no credentials/network, ordered writes, CRUD and synthetic exclusion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aion-preview-'));
  const modules = [];
  const previousFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const memory = new Map();
  let failWrite = false;
  try {
    await build({
      root: resolve('.'), mode: 'preview', logLevel: 'error',
      plugins: [{ name: 'collect-preview-graph', moduleParsed(info) { modules.push(info.id); } }],
      build: {
        outDir: dir, minify: false,
        lib: { entry: resolve('src/lib/preview-api.ts'), formats: ['es'], fileName: () => 'preview.mjs' },
      },
    });
    assert.ok(modules.some(id => id.includes('aion-core/dist/orchestration/control-plane.js')));
    assert.ok(modules.some(id => id.endsWith('/browser-crypto.ts')));
    assert.equal(modules.some(id => /(?:provider-adapter|runtime-client|\/providers\/|node:|@anthropic-ai)/.test(id)), false);
    const source = await readFile(join(dir, 'preview.mjs'), 'utf8');
    assert.equal(source.match(/process\.env|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|AION_RUNTIME_URL|__vite-browser-external/)?.[0], undefined, 'Browser bundle must not contain server environment access');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { if (failWrite) throw new Error('Quota exceeded'); memory.set(key, value); },
    }});
    globalThis.fetch = () => { throw new Error('Preview attempted a network request'); };
    const { previewApi: api } = await import(pathToFileURL(join(dir, 'preview.mjs')).href);
    const { schemas } = await api('/api/schemas', 'GET');
    assert.equal(schemas.length, 3);
    const gt = { fields: {}, guidance: 'useful', outcome: 'qualified', disposition: 'conversation', advanced: true, downstreamConversion: null, evaluable: true };
    for (const schema of schemas) {
      const { sessionId, aiPath } = await api('/api/session', 'POST', { industry: schema.key, prospectName: 'Synthetic sample' });
      assert.equal(aiPath, 'deterministic');
      const route = `/api/session/${sessionId}`;
      const first = await api(`${route}/ingest`, 'POST', { speaker: 'prospect', text: 'I own the business and need help this week because cash flow is tight.' });
      assert.ok(first.recommendations.length);
      await api(`${route}/feedback`, 'POST', { recommendationId: first.recommendations[0].id, feedback: 'useful' });
      // Finalize immediately while multiple ingests are still pending.
      const work = [
        api(`${route}/ingest`, 'POST', { speaker: 'rep', text: 'What is your main priority?' }),
        api(`${route}/ingest`, 'POST', { speaker: 'prospect', text: 'I need a solution now and I make the final decision for my company.' }),
        api(`${route}/finalize`, 'POST', { groundTruth: gt }),
      ];
      await Promise.all(work);
      const saved = (await api(`/api/sessions/${sessionId}`, 'GET')).record;
      assert.equal(saved.during.transcript.length, 3);
      assert.deepEqual(saved.during.transcript.map(t => t.index), [0, 1, 2]);
      assert.ok(saved.during.trace.executionRows > 0);
      assert.ok(saved.during.trace.correlationIds > 0);
      assert.equal(saved.synthetic, true);
      assert.ok(saved.repBehavior.outcomes.length > 0);
      await assert.rejects(api(`${route}/ingest`, 'POST', { text: 'Too late' }), /ended/);
      const updated = await api(`/api/sessions/${sessionId}`, 'PATCH', { groundTruth: { ...gt, notes: 'Corrected sample' } });
      assert.equal(updated.record.after.groundTruth.notes, 'Corrected sample');
    }
    let dashboard = await api('/api/dashboard', 'GET');
    assert.equal(dashboard.records.length, 3);
    assert.equal(dashboard.metrics.syntheticSessions, 3);
    assert.equal(dashboard.metrics.realCalls.value, 0);
    assert.equal(dashboard.metrics.conversionAdvances.value, 0);
    assert.equal(dashboard.metrics.factAccuracy, null);
    assert.equal(dashboard.metrics.gatesMet, false);
    const { sessionId } = await api('/api/session', 'POST', {});
    await assert.rejects(api(`/api/session/${sessionId}/finalize`, 'POST', {}), /Select outcome/);
    failWrite = true;
    await assert.rejects(api(`/api/session/${sessionId}/finalize`, 'POST', { groundTruth: gt }), /Quota/);
    failWrite = false;
    await api(`/api/session/${sessionId}/finalize`, 'POST', { groundTruth: gt });
    await api(`/api/sessions/${sessionId}`, 'DELETE');
    await assert.rejects(api(`/api/sessions/${sessionId}`, 'GET'), /not found/);
    const abandon = await api('/api/session', 'POST', {});
    await api(`/api/session/${abandon.sessionId}`, 'DELETE');
    await assert.rejects(api(`/api/session/${abandon.sessionId}/state`, 'GET'), /ended/);
    // Reload resets active calls but preserves samples in tab storage.
    const active = await api('/api/session', 'POST', {});
    const { previewApi: reloaded } = await import(pathToFileURL(join(dir, 'preview.mjs')).href + '?reload');
    await assert.rejects(reloaded(`/api/session/${active.sessionId}/state`, 'GET'), /ended/);
    dashboard = await reloaded('/api/dashboard', 'GET');
    assert.equal(dashboard.records.length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor);
    else delete globalThis.sessionStorage;
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser boundary rejects Node imports and provider modules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aion-boundary-'));
  try {
    for (const entry of ['node:fs', 'node:crypto', '@anthropic-ai/sdk', resolve('../src/platform/ai-execution.ts'), resolve('../src/platform/provider-adapter.ts'), resolve('../src/platform/runtime-client.ts')]) {
      const fixture = join(dir, 'entry.mjs');
      await writeFile(fixture, `export * from ${JSON.stringify(entry)};`);
      await assert.rejects(build({
        mode: 'preview', logLevel: 'silent',
        build: { outDir: join(dir, 'out'), lib: { entry: fixture, formats: ['es'], fileName: 'forbidden' } },
      }), /Server (dependency|only)|Server-only/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
