/**
 * RES-001 telemetry spike: safeGenerate returns ok/telemetry without throwing,
 * and never echoes secrets. Keyless — uses scripted/throwing fakes only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeGenerate } from '../src/platform/provider-adapter.ts';
import type { LlmProvider, LlmRequest } from '../src/platform/provider-adapter.ts';
import { ScriptedLlm } from '../src/testing/fakes.ts';

const req: LlmRequest = {
  system: 'sys',
  user: 'hi',
  maxTokens: 64,
  effort: 'low',
  model: 'fake-model-1',
};

test('safeGenerate returns success telemetry from a scripted provider', async () => {
  const llm = new ScriptedLlm(() => '{"ok":true}');
  const res = await safeGenerate(llm, req);
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'scripted-fake');
  assert.equal(res.text, '{"ok":true}');
  assert.equal(res.tokensIn, 123);
  assert.equal(res.tokensOut, 45);
  assert.ok(res.latencyMs >= 0);
  assert.equal(res.costUnits, null);
  assert.equal(res.errorCode, null);
});

test('safeGenerate captures failures without throwing or leaking secrets', async () => {
  const leaky: LlmProvider = {
    name: 'leaky-fake',
    async complete() {
      throw new Error('upstream failed sk-or-SECRET123 Bearer sk-or-SECRET123');
    },
  };
  const res = await safeGenerate(leaky, req);
  assert.equal(res.ok, false);
  assert.equal(res.provider, 'leaky-fake');
  assert.equal(res.text, '');
  assert.equal(res.tokensIn, null);
  assert.equal(res.tokensOut, null);
  assert.ok(res.latencyMs >= 0);
  assert.ok(res.errorCode);
  assert.ok(!res.errorCode!.includes('SECRET'), 'secrets must not appear in errorCode');
  assert.match(res.errorCode!, /\[redacted\]/i);
});
