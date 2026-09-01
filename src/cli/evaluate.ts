/**
 * Evaluation CLI: runs all fixtures and prints the Mission-001 gate scorecard.
 *
 *   node src/cli/evaluate.ts
 *
 * Deterministic unless ANTHROPIC_API_KEY is set.
 */

import { runEval } from '../eval/evaluate.ts';
import { detectProvider } from '../platform/provider-adapter.ts';
import { h1 } from './format.ts';

const GATES = {
  extractionAccuracy: 0.85,
  objectionAccuracy: 0.85,
  conversionEvents: 10,
  meaningfulConversions: 3,
  repValueRate: 0.6,
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function pass(ok: boolean): string {
  return ok ? 'PASS ✅' : 'FAIL ❌';
}

async function main(): Promise<void> {
  const agg = await runEval();
  const path = detectProvider() ? 'Claude (governed)' : 'deterministic (no key)';

  console.log(h1('AION REVENUE COPILOT — MISSION-001 EVALUATION'));
  console.log(`  AI path: ${path}   Fixtures: ${agg.fixtures.length}`);

  console.log('\n  PER-FIXTURE');
  for (const f of agg.fixtures) {
    console.log(`  • ${f.id} [${f.industry}]`);
    console.log(`      extraction ${pct(f.factAccuracy)} (${f.factChecks.filter((c) => c.correct).length}/${f.factChecks.length})   objections ${pct(f.objectionAccuracy)} (${f.objectionsDetected.join(',') || '-'})`);
    console.log(`      advance exp/act ${f.stageAdvanceExpected}/${f.stageAdvanceActual}   meaningful exp/act ${f.meaningfulExpected}/${f.meaningfulActual}   events ${f.conversionEvents}`);
    console.log(`      next-action ${f.nextActionType ?? '-'} (${f.nextActionOk === null ? 'n/a' : f.nextActionOk ? 'ok' : 'off'})   lineage ${f.lineageComplete ? 'complete' : 'INCOMPLETE'}`);
    const misses = f.factChecks.filter((c) => !c.correct);
    if (misses.length) console.log(`      misses: ${misses.map((m) => `${m.key}(got:${m.extractedValue ?? 'none'})`).join(', ')}`);
  }

  const gateResults: [string, boolean, string][] = [
    ['Live extraction accuracy (≥85% on clearly-stated facts)', agg.extractionAccuracy >= GATES.extractionAccuracy, `${pct(agg.extractionAccuracy)} (${agg.correctFactChecks}/${agg.totalFactChecks})`],
    ['Objection detection accuracy (≥85%)', agg.objectionAccuracy >= GATES.objectionAccuracy, pct(agg.objectionAccuracy)],
    ['Stage-outcome correctness (advance + meaningful vs label)', agg.stageOutcomeCorrect === agg.stageOutcomeTotal, `${agg.stageOutcomeCorrect}/${agg.stageOutcomeTotal}`],
    ['Conversion events (≥10 across calls)', agg.totalConversionEvents >= GATES.conversionEvents, `${agg.totalConversionEvents}`],
    ['Meaningful conversions (≥3 calls)', agg.meaningfulConversions >= GATES.meaningfulConversions, `${agg.meaningfulConversions}`],
    ['Rep-value (≥60% of rated interventions useful/acted)', (agg.repValueRate ?? 0) >= GATES.repValueRate, `${agg.repValueRate === null ? 'n/a' : pct(agg.repValueRate)} (${agg.interventionsValuable}/${agg.interventionsRated} rated; ${agg.interventionsSurfaced} surfaced)`],
    ['Learning lineage complete (context→state→rec→feedback→response→movement)', agg.lineageComplete, agg.lineageComplete ? 'yes' : 'no'],
  ];

  console.log(h1('GATE SCORECARD'));
  for (const [name, ok, detail] of gateResults) {
    console.log(`  ${pass(ok)}  ${name}\n            → ${detail}`);
  }

  const allPass = gateResults.every(([, ok]) => ok);
  console.log(`\n  OVERALL: ${allPass ? 'ALL GATES PASS ✅' : 'SOME GATES NOT MET ❌'}`);
  console.log('\n  Note: production validation requires ≥25 real sales conversations (docs/GATES.md).');
  console.log('  The fixture set is a synthetic offline harness proving the loop and gate instrumentation.');
  console.log('  Green here is a SYNTHETIC engineering gate, NOT real-world validation.');

  // Make this a real CI gate.
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
