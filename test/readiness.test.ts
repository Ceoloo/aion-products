import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateReadiness, isLoopback, type ReadinessInputs } from '../src/validation/readiness.ts';

// A fully-ready baseline; individual tests degrade one fact at a time.
const READY: ReadinessInputs = {
  nodeVersion: '22.22.2',
  coreResolved: true,
  schemaCount: 3,
  hasApiKey: true,
  host: '127.0.0.1',
  hasToken: false,
  dataDirResolved: '/home/op/aion-data',
  dataDirInsideRepo: false,
  dataDirIsDefaultIgnored: false,
  dataDirWritable: true,
  webBuilt: true,
};

const level = (r: ReturnType<typeof evaluateReadiness>, id: string) => r.checks.find((c) => c.id === id)?.level;

test('readiness: a fully-configured environment is READY on the Claude path', () => {
  const r = evaluateReadiness(READY);
  assert.equal(r.ready, true);
  assert.equal(r.aiPath, 'claude');
  assert.ok(r.checks.every((c) => c.level !== 'blocker'));
});

test('readiness: old Node is a blocker', () => {
  const r = evaluateReadiness({ ...READY, nodeVersion: '20.11.0' });
  assert.equal(r.ready, false);
  assert.equal(level(r, 'node'), 'blocker');
});

test('readiness: node 22.18 exactly is accepted', () => {
  assert.equal(level(evaluateReadiness({ ...READY, nodeVersion: '22.18.0' }), 'node'), 'ok');
});

test('readiness: missing @aion/core is a blocker', () => {
  const r = evaluateReadiness({ ...READY, coreResolved: false });
  assert.equal(r.ready, false);
  assert.equal(level(r, 'core'), 'blocker');
});

test('readiness: no schemas is a blocker', () => {
  assert.equal(evaluateReadiness({ ...READY, schemaCount: 0 }).ready, false);
});

test('readiness: no API key warns (deterministic) but is not a blocker', () => {
  const r = evaluateReadiness({ ...READY, hasApiKey: false });
  assert.equal(r.ready, true);
  assert.equal(r.aiPath, 'deterministic');
  assert.equal(level(r, 'ai-path'), 'warn');
});

test('readiness: data dir inside repo (non-default) is a blocker — PII could be committed', () => {
  const r = evaluateReadiness({ ...READY, dataDirInsideRepo: true, dataDirIsDefaultIgnored: false });
  assert.equal(r.ready, false);
  assert.equal(level(r, 'data-dir'), 'blocker');
});

test('readiness: the git-ignored default data dir is OK even though inside the repo', () => {
  const r = evaluateReadiness({ ...READY, dataDirInsideRepo: true, dataDirIsDefaultIgnored: true });
  assert.equal(level(r, 'data-dir'), 'ok');
  assert.equal(r.ready, true);
});

test('readiness: unwritable data dir is a blocker', () => {
  assert.equal(evaluateReadiness({ ...READY, dataDirWritable: false }).ready, false);
});

test('readiness: non-loopback bind without a token is a blocker', () => {
  const r = evaluateReadiness({ ...READY, host: '0.0.0.0', hasToken: false });
  assert.equal(r.ready, false);
  assert.equal(level(r, 'network'), 'blocker');
});

test('readiness: non-loopback bind WITH a token is allowed (warn)', () => {
  const r = evaluateReadiness({ ...READY, host: '0.0.0.0', hasToken: true });
  assert.equal(r.ready, true);
  assert.equal(level(r, 'network'), 'warn');
});

test('readiness: unbuilt web console warns but does not block (fallback console)', () => {
  const r = evaluateReadiness({ ...READY, webBuilt: false });
  assert.equal(r.ready, true);
  assert.equal(level(r, 'console'), 'warn');
});

test('isLoopback recognizes loopback hosts only', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('localhost'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('0.0.0.0'), false);
  assert.equal(isLoopback('192.168.1.5'), false);
});
