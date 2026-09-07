/**
 * Evaluation CLI: runs all fixtures and prints the Mission-001 gate scorecard.
 *
 *   node src/cli/evaluate.ts
 *
 * Deterministic unless ANTHROPIC_API_KEY is set.
 */

import { runEval } from '../eval/evaluate.ts';
import { computeGates, pct } from '../eval/gates.ts';
import { detectProvider } from '../platform/provider-adapter.ts';
import { h1 } from './format.ts';

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

  const gateResults = computeGates(agg);

  console.log(h1('GATE SCORECARD'));
  for (const g of gateResults) {
    console.log(`  ${pass(g.pass)}  ${g.label}\n            → ${g.detail}`);
  }

  const allPass = gateResults.every((g) => g.pass);
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
