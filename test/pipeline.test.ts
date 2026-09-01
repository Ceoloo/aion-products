/**
 * Pipeline integration: the live loop, the signature next-best-action, the
 * learning lineage, the rep-value loop, and Core-fallback resilience.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCopilot, buildReport } from '../src/aion.ts';
import { getSchema } from '../src/config/registry.ts';
import { getFixture } from '../fixtures/index.ts';
import { ThrowingLlm } from '../src/testing/fakes.ts';

async function runFixture(id: string, llm: any) {
  const fixture = getFixture(id);
  const { copilot, exec } = await createCopilot({ callId: `t_${id}`, industry: fixture.industry, context: fixture.context, llm });
  const updates = [];
  for (const turn of fixture.turns) {
    const u = await copilot.ingest(turn);
    for (const fb of fixture.scriptedFeedback.filter((f) => f.atTurn === turn.index)) {
      const match = u.recommendations.find((r) => r.type === fb.recommendationType);
      if (match) copilot.recordFeedback(match.id, fb.feedback, turn.index);
    }
    updates.push(u);
  }
  const report = buildReport(copilot, exec, getSchema(fixture.industry));
  return { copilot, exec, updates, report };
}

test('signature move: a pricing objection before urgency/impact yields a "return to impact" recommendation', async () => {
  const { updates } = await runFixture('funding-discovery-call', null);
  // Turn 9 is the price objection; the guidance at/after it should favor impact.
  const around = updates.filter((u) => u.turnIndex >= 9 && u.turnIndex <= 11);
  const hasReturnToImpact = around.some((u) => u.recommendations.some((r) => r.type === 'quantify_impact' && /impact/i.test(r.title)));
  assert.ok(hasReturnToImpact, 'copilot recommends returning to impact around the price objection');
});

test('the live loop advances the ladder and reaches a meaningful conversion', async () => {
  const { report } = await runFixture('funding-discovery-call', null);
  assert.ok(report.outcome.advanced, 'deal advanced');
  assert.equal(report.outcome.stageBeforeId, 'engaged');
  assert.equal(report.outcome.stageAfterId, 'application');
  assert.ok(report.outcome.reachedMeaningfulConversion);
});

test('learning lineage links recommendation → prospect response → conversion movement', async () => {
  const { report } = await runFixture('funding-discovery-call', null);
  const records = report.learning.records;
  assert.ok(records.length > 0);
  const advanced = records.filter((r) => r.conversionAdvanced === true);
  assert.ok(advanced.length > 0, 'some recommendations were followed by conversion movement');
  for (const r of advanced) {
    assert.ok(r.prospectResponseTurn !== null, 'attributed to a prospect response');
    assert.ok(r.ladderOrderAfter! > r.stateBefore.ladderOrder, 'order increased');
    assert.ok(r.traceId.length > 0, 'linked to a Core execution trace');
  }
  // The rep-value loop recorded feedback that flows into the report.
  assert.ok(report.learning.interventionsValuable >= 1);
});

test('CRM-write governance surfaces only explicit, high-confidence facts', async () => {
  const { report } = await runFixture('funding-discovery-call', null);
  assert.ok(report.qualification.crmWritable.includes('revenue'));
  assert.ok(report.qualification.crmWritable.includes('capital_amount'));
});

test('resilience: with a failing LLM the loop still produces state via governed fallback', async () => {
  const { report, exec } = await runFixture('funding-discovery-call', new ThrowingLlm());
  assert.ok(report.outcome.advanced, 'still advanced on deterministic fallback');
  const summary = exec.traceSummary();
  assert.ok(summary.total > 0);
  assert.equal(summary.fallbacks, summary.total, 'every AI execution fell back');
  // Fallbacks are still governed successes in the canonical control plane.
  const telemetry = exec.controlPlane.telemetrySink.all();
  const execRows = telemetry.filter((t) => t.operation === 'execution');
  assert.ok(execRows.length > 0 && execRows.every((t) => t.status === 'ok'), 'traced as governed successes');
});

test('industry configurability: the same engines drive a different ladder for contractors', async () => {
  const { report } = await runFixture('contractor-estimate-call', null);
  assert.equal(report.industry, 'contractor');
  assert.equal(report.outcome.stageAfterId, 'estimate');
  assert.ok(report.outcome.reachedMeaningfulConversion);
});
