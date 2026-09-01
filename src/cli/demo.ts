/**
 * Demo runner: replays a labeled transcript through the full live loop and
 * prints the pre-call briefing, per-turn live guidance, and the post-call
 * intelligence record.
 *
 *   node src/cli/demo.ts [--fixture <id>] [--quiet]
 *
 * Runs deterministically with no API key; set ANTHROPIC_API_KEY to route the
 * AI steps through Claude (governed by the Core).
 */

import { createCopilot, buildReport } from '../aion.ts';
import { getSchema } from '../config/registry.ts';
import { getFixture, FIXTURES } from '../../fixtures/index.ts';
import { h1, liveState, gapsBlock, recsBlock, report } from './format.ts';

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main(): Promise<void> {
  const fixtureId = arg('fixture', FIXTURES[0]!.id)!;
  const quiet = process.argv.includes('--quiet');
  const fixture = getFixture(fixtureId);
  const schema = getSchema(fixture.industry);

  const { copilot, core } = await createCopilot({
    callId: `demo_${fixture.id}`,
    industry: fixture.industry,
    context: fixture.context,
  });

  console.log(h1(`AION REVENUE COPILOT — ${fixture.title}`));
  console.log(`  Industry: ${schema.label}   AI path: ${core.llmAvailable ? 'Claude (governed)' : 'deterministic (no key)'}`);
  console.log(`\n  PRE-CALL BRIEFING\n  ${copilot.context.briefing}`);

  for (const turn of fixture.turns) {
    const update = await copilot.ingest(turn);

    // Apply any scripted rep feedback for this turn (rep-value loop).
    for (const fb of fixture.scriptedFeedback.filter((f) => f.atTurn === turn.index)) {
      const match = update.recommendations.find((r) => r.type === fb.recommendationType);
      if (match) copilot.recordFeedback(match.id, fb.feedback, turn.index);
    }

    if (quiet) continue;
    console.log(h1(`TURN #${turn.index} — ${turn.speaker.toUpperCase()}`));
    console.log(`  "${turn.text}"`);
    console.log('');
    console.log(liveState(update.state));
    console.log(gapsBlock(update.gaps));
    console.log(recsBlock(update.recommendations));
  }

  console.log(report(buildReport(copilot, core, schema)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
