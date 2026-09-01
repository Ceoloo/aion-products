/**
 * Engine unit tests for the pure / deterministic paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMoney, extractMoneyRange, extractYears, extractJson } from '../src/engines/lib/text.ts';
import { extractionTask } from '../src/engines/extraction.ts';
import { evaluateLadder } from '../src/engines/ladder.ts';
import { computeReadiness } from '../src/engines/readiness.ts';
import { fundingSchema } from '../src/config/registry.ts';
import type { DealState } from '../src/domain/deal.ts';
import type { FactKey, FactSlot } from '../src/domain/facts.ts';
import { FACT_LABELS } from '../src/domain/facts.ts';

function slot(key: FactKey, value: string | null, confidence = 0.9, explicit = true): FactSlot {
  return { key, label: FACT_LABELS[key], value, confidence, statedExplicitly: explicit, evidence: [], updatedAtTurn: 0 };
}

function blankState(overrides: Partial<DealState> = {}): DealState {
  return {
    callId: 't', industry: 'funding', ladderKey: 'funding',
    position: { startOrder: 1, currentOrder: 1, highWaterOrder: 1 },
    facts: {}, sentiment: 'neutral', urgency: 'unknown', conversationStage: 'discovery',
    objections: [], buyingSignals: [], commitments: [], gaps: [], missingInformation: [],
    readiness: { signals: [], level: 'cold', primaryBlocker: null, score: 0 },
    updatedAtTurn: 0,
    ...overrides,
  };
}

test('money parsing handles k/m units and ranges', () => {
  assert.equal(extractMoney('we need $75k'), '$75,000');
  assert.equal(extractMoney('about 1.2 million'), '$1,200,000');
  assert.equal(extractMoney('the number is 5'), null, 'tiny bare number is not money');
  assert.equal(extractMoneyRange('somewhere between $75k and $100k'), '$75,000–$100,000');
  assert.equal(extractYears('been in business about 6 years'), '6 years');
});

test('extractJson tolerates fenced and prose-wrapped JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! [1,2,3] done'), [1, 2, 3]);
});

test('deterministic extraction pulls revenue and time in business from a prospect turn', () => {
  const task = extractionTask({
    turns: [{ index: 1, speaker: 'prospect', text: 'We do about $80,000 a month in revenue and have been in business 4 years.' }],
    factSlots: ['revenue', 'time_in_business'],
    existing: {},
    turnIndex: 1,
  });
  const updates = task.deterministic(task.input);
  const rev = updates.find((u) => u.key === 'revenue');
  const tib = updates.find((u) => u.key === 'time_in_business');
  assert.ok(rev && rev.value.includes('80,000'), 'revenue extracted');
  assert.ok(rev?.statedExplicitly, 'revenue stated explicitly');
  assert.ok(tib && tib.value.includes('4 years'), 'time in business extracted');
});

test('ladder gating advances only when prefix gates are satisfied and stops at outcome-only rungs', () => {
  // Only qualification facts known → should sit at "qualified" (order 2), blocked on need.
  const s = blankState({
    facts: { revenue: slot('revenue', '$80k/mo'), time_in_business: slot('time_in_business', '5 years'), decision_authority: slot('decision_authority', 'owner') },
  });
  const evalA = evaluateLadder(s, fundingSchema);
  assert.equal(evalA.currentOrder, 2, 'reached qualified');
  assert.equal(evalA.blockingStage?.id, 'need_confirmed');

  // Everything satisfied incl. commitment → caps at application (6), never funded (outcomeOnly).
  const full = blankState({
    urgency: 'high',
    facts: {
      revenue: slot('revenue', '$80k/mo'), time_in_business: slot('time_in_business', '5 years'),
      decision_authority: slot('decision_authority', 'owner'), need: slot('need', 'inventory'),
      pain: slot('pain', 'cash flow'), business_impact: slot('business_impact', 'impact $40,000'),
      urgency: slot('urgency', '30 days'), capital_amount: slot('capital_amount', '$90k'),
      use_of_funds: slot('use_of_funds', 'inventory'),
    },
    commitments: [{ id: 'c', description: 'apply', by: 'prospect', turnIndex: 9, confidence: 0.9 }],
  });
  const evalB = evaluateLadder(full, fundingSchema);
  assert.equal(evalB.currentOrder, 6, 'capped at application (outcome-only funded not auto-reached)');
});

test('readiness score is explainable — reconstructable from its signals', () => {
  const s = blankState({
    urgency: 'high',
    facts: {
      need: slot('need', 'x'), decision_authority: slot('decision_authority', 'owner'),
      business_impact: slot('business_impact', 'impact $40k'), capital_amount: slot('capital_amount', '$90k'),
    },
    commitments: [{ id: 'c', description: 'apply', by: 'prospect', turnIndex: 1, confidence: 0.9 }],
  });
  const r = computeReadiness(s, fundingSchema);

  // Recompute the weighted score from the returned signals + schema weights.
  let num = 0;
  let den = 0;
  for (const def of fundingSchema.readinessSignals) {
    const sig = r.signals.find((x) => x.key === def.key)!;
    den += def.weight;
    if (sig.state === 'confirmed') num += def.weight;
    else if (sig.state === 'partial') num += def.weight * 0.5;
  }
  assert.equal(r.score, Number((num / den).toFixed(3)), 'score equals the weighted signal fraction');
  assert.ok(['moderate', 'strong', 'ready'].includes(r.level));
});
