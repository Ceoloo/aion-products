/**
 * Production-validation harness tests.
 *
 * Proves the exit-gate logic without needing real data: the same scorer runs,
 * but only real, consented conversations count toward the ≥25 gate, and
 * validation cannot complete on synthetic provenance or without consent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from '../fixtures/index.ts';
import {
  runValidation,
  REQUIRED_REAL_CALLS,
} from '../src/validation/validate.ts';
import { loadRealCalls } from '../src/validation/load.ts';
import type { ValidationCall } from '../src/validation/types.ts';

const DET = { llm: null } as const;

/** Wrap a synthetic fixture as a real, consented call with a unique id. */
function asReal(i: number): ValidationCall {
  const f = FIXTURES[i % FIXTURES.length]!;
  return {
    provenance: { source: 'real', consent: true },
    call: { ...f, id: `${f.id}-r${i}` },
  };
}

test('no real calls → not validated (does not falsely pass on empty)', async () => {
  const r = await runValidation({ calls: [], opts: DET });
  assert.equal(r.realCallCount, 0);
  assert.equal(r.countGatePass, false);
  assert.equal(r.consentGatePass, false);
  assert.equal(r.aggregate, null);
  assert.deepEqual(r.missionGates, []);
  assert.equal(r.missionGatesPass, false);
  assert.equal(r.validationComplete, false);
});

test('synthetic-provenance calls never count toward real-world validation', async () => {
  const synthetic: ValidationCall[] = FIXTURES.map((f) => ({
    provenance: { source: 'synthetic', consent: true },
    call: f,
  }));
  const r = await runValidation({ calls: synthetic, opts: DET });
  assert.equal(r.realCallCount, 0);
  assert.equal(r.syntheticExcluded, FIXTURES.length);
  assert.equal(r.validationComplete, false);
});

test('count gate blocks completion even when mission gates would pass', async () => {
  // 5 real calls: the mission metrics may pass, but 5 < 25, so not validated.
  const calls = FIXTURES.map((_, i) => asReal(i));
  const r = await runValidation({ calls, opts: DET });
  assert.equal(r.realCallCount, FIXTURES.length);
  assert.equal(r.countGatePass, false);
  assert.ok(r.aggregate, 'mission gates are still computed on the real data');
  assert.equal(r.validationComplete, false);
});

test('a real call missing consent fails the consent gate and is not scored', async () => {
  const calls: ValidationCall[] = [
    ...Array.from({ length: 24 }, (_, i) => asReal(i)),
    { provenance: { source: 'real', consent: false }, call: { ...FIXTURES[0]!, id: 'unconsented-1' } },
  ];
  const r = await runValidation({ calls, opts: DET });
  assert.equal(r.realCallCount, 25); // counted as real
  assert.equal(r.countGatePass, true);
  assert.equal(r.consentGatePass, false); // but not all consented
  assert.deepEqual(r.missingConsent, ['unconsented-1']);
  assert.equal(r.validationComplete, false); // consent blocks completion
});

test('≥25 real, consented calls with passing gates → validation complete', async () => {
  const calls = Array.from({ length: REQUIRED_REAL_CALLS }, (_, i) => asReal(i));
  const r = await runValidation({ calls, opts: DET });
  assert.equal(r.realCallCount, REQUIRED_REAL_CALLS);
  assert.equal(r.countGatePass, true);
  assert.equal(r.consentGatePass, true);
  assert.ok(r.missionGatesPass, 'mission gates pass on this (passing) data');
  assert.equal(r.validationComplete, true);
});

test('intake loader returns [] on a clean checkout (template is skipped)', async () => {
  const calls = await loadRealCalls();
  // Real call files are gitignored; only the _-prefixed template exists, which
  // the loader skips. So a clean checkout yields no real calls.
  assert.ok(Array.isArray(calls));
  assert.equal(calls.length, 0);
});
