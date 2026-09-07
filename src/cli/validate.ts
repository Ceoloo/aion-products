/**
 * Production-validation CLI: scores REAL sales calls against the Mission-001
 * exit gate and prints the validation scorecard.
 *
 *   npm run validate              # strict — exits non-zero until validated
 *   npm run validate -- --status  # report-only, always exits 0 (CI visibility)
 *
 * Distinct from `npm run eval` (the synthetic engineering gate): this counts
 * only real, consented conversations and requires ≥25 of them. Deterministic
 * unless ANTHROPIC_API_KEY is set.
 */

import { loadRealCalls, DEFAULT_INTAKE_DIR } from '../validation/load.ts';
import { runValidation } from '../validation/validate.ts';
import { detectProvider } from '../platform/provider-adapter.ts';
import { pct } from '../eval/gates.ts';
import { h1 } from './format.ts';

function pass(ok: boolean): string {
  return ok ? 'PASS ✅' : 'BLOCKED ⏳';
}

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const calls = await loadRealCalls();
  const report = await runValidation({ calls });
  const path = detectProvider() ? 'Claude (governed by @aion/core)' : 'deterministic (no key, governed by @aion/core)';

  console.log(h1('AION REVENUE COPILOT — MISSION-001 PRODUCTION VALIDATION'));
  console.log(`  AI path: ${path}`);
  console.log(`  Intake:  ${DEFAULT_INTAKE_DIR}/`);
  console.log(
    `  Real calls: ${report.realCallCount} / ${report.requiredRealCalls}` +
      (report.syntheticExcluded ? `   (excluded ${report.syntheticExcluded} synthetic)` : ''),
  );

  console.log(h1('EXIT-GATE SCORECARD'));
  console.log(
    `  ${pass(report.countGatePass)}  Real conversations (≥${report.requiredRealCalls})\n            → ${report.realCallCount}`,
  );
  console.log(
    `  ${pass(report.consentGatePass)}  Consent on every real call\n            → ${
      report.realCallCount === 0
        ? 'no real calls yet'
        : report.missingConsent.length === 0
          ? 'all consented'
          : `missing: ${report.missingConsent.join(', ')}`
    }`,
  );

  if (report.aggregate && report.missionGates.length) {
    console.log('\n  Mission gates (on real data):');
    for (const g of report.missionGates) {
      console.log(`  ${pass(g.pass)}  ${g.label}\n            → ${g.detail}`);
    }
  } else {
    console.log('\n  Mission gates (on real data): not yet evaluated — awaiting consented real calls.');
  }

  console.log(
    `\n  OVERALL: ${report.validationComplete ? 'VALIDATION COMPLETE ✅' : 'NOT YET VALIDATED ⏳'}`,
  );

  if (!report.validationComplete) {
    console.log(
      `\n  To validate: add ≥${report.requiredRealCalls} real, consented conversations under ${DEFAULT_INTAKE_DIR}/`,
    );
    console.log('  (copy _template.call.ts). See validation/real-calls/README.md.');
    console.log('  A green synthetic eval (npm run eval) is NOT production validation.');
  }

  // Strict mode makes this a real gate; --status is informational (CI visibility)
  // and never fails the build while real-world validation is still in progress.
  if (!statusOnly && !report.validationComplete) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
