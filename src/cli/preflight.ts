/**
 * MISSION-001 preflight — verify the Revenue Copilot is ready to ingest a REAL
 * sales conversation, and print the exact URL for the operator to open.
 *
 *   npm run preflight
 *
 * Exit code 0 when ready (no blockers), 1 otherwise — so `golive` and CI can
 * gate on it.
 */

import { gatherReadiness, isLoopback } from '../validation/readiness.ts';

const ICON = { ok: '✅', warn: '⚠️ ', blocker: '⛔' } as const;

function operatorUrl(): string {
  const host = process.env.AION_HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 4173);
  const token = (process.env.AION_TOKEN ?? '').trim();
  const shownHost = isLoopback(host) ? 'localhost' : host;
  // Token travels in the URL fragment (never the request line) per the console's
  // auth model; the operator pastes their real AION_TOKEN in place of <token>.
  return `http://${shownHost}:${port}/${token ? '#token=<AION_TOKEN>' : ''}`;
}

async function main(): Promise<void> {
  const report = await gatherReadiness();

  console.log('\nMISSION-001 · Production readiness preflight\n');
  for (const c of report.checks) {
    console.log(`  ${ICON[c.level]} ${c.title}`);
    console.log(`      ${c.detail}`);
  }

  const blockers = report.checks.filter((c) => c.level === 'blocker').length;
  const warns = report.checks.filter((c) => c.level === 'warn').length;

  console.log('');
  console.log(`  Interpretation path: ${report.aiPath === 'claude' ? 'Claude (governed)' : 'deterministic (governed)'}`);
  console.log('');

  if (report.ready) {
    console.log(`  READY ✅  ${warns ? `(${warns} warning${warns > 1 ? 's' : ''} — review above)` : ''}`);
    console.log(`  Start the console:  npm run console`);
    console.log(`  Then open:          ${operatorUrl()}`);
    console.log(`  Runbook:            docs/FIRST-CALL.md\n`);
    process.exit(0);
  } else {
    console.log(`  NOT READY ⛔  ${blockers} blocker${blockers > 1 ? 's' : ''} must be resolved before a real call (see above).\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('preflight failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
