/**
 * OpenRouter provider: proves the provider builds an OpenAI-compatible request,
 * parses the response into the vendor-neutral LlmResponse, fails loudly (so the
 * governed adapter fallback engages) without leaking the key, and that
 * detectProvider() selects providers from the environment as specified.
 *
 * No network and no key: the provider is exercised with an injected fake fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenRouterProvider,
  type FetchLike,
} from '../src/platform/providers/openrouter.ts';
import { detectProvider, AnthropicProvider } from '../src/platform/provider-adapter.ts';
import type { LlmRequest } from '../src/platform/provider-adapter.ts';

const req: LlmRequest = {
  system: 'you are a test',
  user: 'hello',
  maxTokens: 256,
  effort: 'medium',
  model: 'anthropic/claude-3.5-sonnet',
};

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
}

test('builds an OpenAI-compatible request and parses the completion', async () => {
  const calls: CapturedCall[] = [];
  const fakeFetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as CapturedCall['body'] });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'anthropic/claude-3.5-sonnet',
        choices: [{ message: { content: '{"value": 7}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      }),
    };
  };

  const provider = new OpenRouterProvider('sk-or-test-key', { fetchImpl: fakeFetch });
  const res = await provider.complete(req);

  // Response is normalized to the vendor-neutral shape.
  assert.equal(res.text, '{"value": 7}');
  assert.equal(res.model, 'anthropic/claude-3.5-sonnet');
  assert.equal(res.tokensIn, 11);
  assert.equal(res.tokensOut, 4);

  // Request shape: OpenAI-compatible messages, model, max_tokens, bearer auth.
  assert.equal(calls.length, 1, 'fetch was called exactly once');
  const c = calls[0]!;
  assert.match(c.url, /openrouter\.ai/);
  assert.equal(c.headers['Authorization'], 'Bearer sk-or-test-key');
  assert.equal(c.body.model, 'anthropic/claude-3.5-sonnet');
  assert.equal(c.body.max_tokens, 256);
  assert.deepEqual(
    c.body.messages,
    [
      { role: 'system', content: 'you are a test' },
      { role: 'user', content: 'hello' },
    ],
  );
});

test('missing usage/content parses to empty text and null token counts', async () => {
  const fakeFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: 'x/y' }), // no choices, no usage
  });
  const provider = new OpenRouterProvider('sk-or-test-key', { fetchImpl: fakeFetch });
  const res = await provider.complete(req);
  assert.equal(res.text, '');
  assert.equal(res.model, 'x/y');
  assert.equal(res.tokensIn, null);
  assert.equal(res.tokensOut, null);
});

test('non-2xx throws a non-secret error (adapter fallback engages) and never leaks the key', async () => {
  const fakeFetch: FetchLike = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'rate_limited' }),
  });
  const provider = new OpenRouterProvider('sk-or-SECRET', { fetchImpl: fakeFetch });
  await assert.rejects(
    () => provider.complete(req),
    (err: unknown) => {
      const message = (err as Error).message;
      assert.equal(message, 'openrouter_error status=429');
      assert.ok(!message.includes('SECRET'), 'the API key must never appear in the error');
      return true;
    },
  );
});

test('detectProvider selects from the environment as specified', () => {
  const saved = {
    choice: process.env.AION_LLM_PROVIDER,
    or: process.env.OPENROUTER_API_KEY,
    anth: process.env.ANTHROPIC_API_KEY,
  };
  const reset = () => {
    delete process.env.AION_LLM_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  };
  try {
    // No keys → deterministic (null).
    reset();
    assert.equal(detectProvider(), null);

    // OpenRouter key only → OpenRouterProvider.
    reset();
    process.env.OPENROUTER_API_KEY = 'sk-or-x';
    assert.ok(detectProvider() instanceof OpenRouterProvider);

    // Anthropic key only → AnthropicProvider (existing behavior unchanged).
    reset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    assert.ok(detectProvider() instanceof AnthropicProvider);

    // Both keys → OpenRouter wins by default.
    reset();
    process.env.OPENROUTER_API_KEY = 'sk-or-x';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    assert.ok(detectProvider() instanceof OpenRouterProvider);

    // Explicit pin to anthropic wins even when both keys are present.
    process.env.AION_LLM_PROVIDER = 'anthropic';
    assert.ok(detectProvider() instanceof AnthropicProvider);

    // Explicit pin with the pinned key absent → null (never silently falls through).
    reset();
    process.env.AION_LLM_PROVIDER = 'openrouter';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    assert.equal(detectProvider(), null);
  } finally {
    reset();
    if (saved.choice !== undefined) process.env.AION_LLM_PROVIDER = saved.choice;
    if (saved.or !== undefined) process.env.OPENROUTER_API_KEY = saved.or;
    if (saved.anth !== undefined) process.env.ANTHROPIC_API_KEY = saved.anth;
  }
});
