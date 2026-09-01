/**
 * Mission-001 gate suite. Runs the full evaluation harness over the labeled
 * fixtures (deterministic path) and asserts each gate threshold. This is the
 * offline proof that the conversation → intelligence → action → conversion loop
 * travels end-to-end with traceability.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEval } from '../src/eval/evaluate.ts';

test('all Mission-001 gates pass on the deterministic fixture set', async () => {
  const agg = await runEval({ llm: null });

  assert.ok(agg.extractionAccuracy >= 0.85, `extraction accuracy ${agg.extractionAccuracy}`);
  assert.ok(agg.objectionAccuracy >= 0.85, `objection accuracy ${agg.objectionAccuracy}`);
  assert.equal(agg.stageOutcomeCorrect, agg.stageOutcomeTotal, 'every fixture stage outcome matches its label');
  assert.ok(agg.totalConversionEvents >= 10, `conversion events ${agg.totalConversionEvents}`);
  assert.ok(agg.meaningfulConversions >= 3, `meaningful conversions ${agg.meaningfulConversions}`);
  assert.ok((agg.repValueRate ?? 0) >= 0.6, `rep-value rate ${agg.repValueRate}`);
  assert.ok(agg.lineageComplete, 'learning lineage complete for every fixture');
});

test('technical gate: every AI execution is traced and attributable to a call+turn', async () => {
  const agg = await runEval({ llm: null });
  for (const f of agg.fixtures) {
    // Every surfaced recommendation carries a trace id and a state snapshot.
    assert.ok(f.lineageComplete, `${f.id} lineage incomplete`);
    assert.ok(f.interventionsSurfaced > 0, `${f.id} surfaced no interventions`);
  }
});
