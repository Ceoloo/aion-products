/**
 * Validation harness: transcript adapter, evaluability model, store round-trip,
 * real scoring against rep ground truth, and dashboard aggregation — plus an
 * end-to-end that drives the real pipeline from a pasted transcript to a
 * persisted canonical record and dashboard metrics.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTranscript } from '../src/validation/transcript.ts';
import { suggestEvaluable, suggestKind } from '../src/domain/session.ts';
import type { GroundTruth, SessionRecord } from '../src/domain/session.ts';
import { InMemorySessionStore, JsonSessionStore } from '../src/validation/store.ts';
import { scoreRecord, buildDashboard } from '../src/validation/scoring.ts';
import { assembleSessionRecord } from '../src/validation/record.ts';
import { createCopilot, buildReport } from '../src/aion.ts';
import { getSchema } from '../src/config/registry.ts';
import { getFixture } from '../fixtures/index.ts';

test('parseTranscript attributes speakers, handles aliases and continuations', () => {
  const turns = parseTranscript(
    'Rep: Hi there\nProspect: We do $80k a month\nand we have 4 employees\nAgent - thanks\nCustomer: not interested',
  );
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.map((t) => t.speaker), ['rep', 'prospect', 'rep', 'prospect']);
  assert.match(turns[1]!.text, /80k a month and we have 4 employees/); // continuation merged
  assert.equal(turns[2]!.text, 'thanks'); // "Agent -" alias
});

test('evaluability: unanswered/thin sessions are not conversations', () => {
  assert.equal(suggestEvaluable(parseTranscript('Rep: hello? anyone there?')), false);
  const thin = parseTranscript('Rep: hi\nProspect: no thanks');
  assert.equal(suggestEvaluable(thin), false);
  assert.equal(suggestKind(thin, false), 'session');
  const real = parseTranscript(
    'Rep: hi, tell me about the business\n' +
    'Prospect: We do about eighty five thousand a month in revenue and have been in business six years, I own the shop.\n' +
    'Rep: what do you need\n' +
    'Prospect: I need working capital for inventory soon because cash flow is tight and I keep missing out on the bigger bulk orders that would really grow the business this year.',
  );
  assert.equal(suggestEvaluable(real), true);
});

test('JsonSessionStore round-trips a record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aion-store-'));
  try {
    const store = new JsonSessionStore(dir);
    const rec = { sessionId: 'sess_x', createdAt: '2026-09-01T00:00:00Z' } as unknown as SessionRecord;
    await store.save(rec);
    const back = await store.get('sess_x');
    assert.equal(back?.sessionId, 'sess_x');
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function recordFromFixture(fixtureId: string, gt: GroundTruth | null): Promise<SessionRecord> {
  const fx = getFixture(fixtureId);
  const { copilot, exec } = await createCopilot({ callId: `t_${fixtureId}`, industry: fx.industry, context: fx.context, llm: null });
  for (const turn of fx.turns) await copilot.ingest(turn);
  const report = buildReport(copilot, exec, getSchema(fx.industry));
  return assembleSessionRecord({
    sessionId: `t_${fixtureId}`,
    prospectId: fx.context.prospect.id,
    repId: 'rep_test',
    industry: fx.industry,
    createdAt: new Date().toISOString(),
    context: fx.context,
    copilot,
    report,
    groundTruth: gt,
  });
}

function allCorrectGT(overrides: Partial<GroundTruth> = {}): GroundTruth {
  return {
    fields: {
      pain: { verdict: 'correct' }, urgency: { verdict: 'correct' }, authority: { verdict: 'correct' },
      objection: { verdict: 'correct' }, conversation_stage: { verdict: 'correct' }, buying_signals: { verdict: 'correct' },
    },
    guidance: 'acted_on', outcome: 'application', advanced: true, downstreamConversion: 'application',
    disposition: 'conversation', evaluable: true, notes: '',
    ...overrides,
  };
}

test('scoreRecord scores AI interpretation against rep ground truth', async () => {
  const rec = await recordFromFixture('funding-discovery-call', allCorrectGT());
  const s = scoreRecord(rec);
  assert.equal(s.evaluable, true);
  assert.equal(s.finalized, true);
  assert.equal(s.fieldsJudged, 6);
  assert.equal(s.fieldsCorrect, 6);
  assert.equal(s.objectionCorrect, true);
  assert.equal(s.conversionAdvanced, true);
  assert.equal(s.downstreamConversion, true);
  assert.equal(s.lineageComplete, true, 'lineage carries canonical trace ids + snapshots');
});

test('an incorrect verdict lowers fact accuracy', async () => {
  const rec = await recordFromFixture('funding-discovery-call', allCorrectGT({
    fields: {
      pain: { verdict: 'incorrect' }, urgency: { verdict: 'correct' }, authority: { verdict: 'correct' },
      objection: { verdict: 'correct' }, conversation_stage: { verdict: 'edited', corrected: 'negotiation' }, buying_signals: { verdict: 'correct' },
    },
  }));
  const s = scoreRecord(rec);
  assert.equal(s.fieldsJudged, 6);
  assert.equal(s.fieldsCorrect, 4); // incorrect + edited both count as not-correct
});

test('dashboard aggregates gates and excludes non-evaluable sessions from real calls', async () => {
  const store = new InMemorySessionStore();
  await store.save(await recordFromFixture('funding-discovery-call', allCorrectGT()));
  await store.save(await recordFromFixture('contractor-estimate-call', allCorrectGT({ outcome: 'appointment', downstreamConversion: 'appointment', disposition: 'conversation' })));
  // A thin, non-evaluable session must not count toward the 25.
  const dial = await recordFromFixture('funding-brushoff-call', allCorrectGT({ evaluable: false, disposition: 'instant_rejection', outcome: 'no_contact', advanced: false, downstreamConversion: null, guidance: 'ignored' }));
  await store.save(dial);

  const m = buildDashboard(await store.list());
  assert.equal(m.totalSessions, 3);
  assert.equal(m.realCalls.value, 2, 'only evaluable finalized conversations count');
  assert.equal(m.factAccuracy, 1);
  assert.equal(m.conversionAdvances.value, 2);
  assert.equal(m.downstreamConversions.value, 2);
  assert.equal(m.lineageCompleteness, 1);
  assert.ok((m.usefulInterventionRate ?? 0) >= 0.6);
  assert.equal(m.gatesMet, false, 'not enough real calls yet');
  assert.ok(m.dispositions.instant_rejection === 1);
});

test('end-to-end: pasted transcript → live pipeline → persisted record → dashboard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aion-e2e-'));
  try {
    const store = new JsonSessionStore(dir);
    const industry = 'funding';
    const fx = getFixture('funding-discovery-call');
    const { copilot, exec } = await createCopilot({ callId: 'e2e_1', industry, context: fx.context, llm: null });

    // Ingest via the transcript adapter (as the console does with pasted text).
    const pasted = fx.turns.map((t) => `${t.speaker === 'rep' ? 'Rep' : 'Prospect'}: ${t.text}`).join('\n');
    const turns = parseTranscript(pasted);
    assert.ok(turns.length >= 10);
    for (const t of turns) await copilot.ingest(t);

    const report = buildReport(copilot, exec, getSchema(industry));
    const rec = assembleSessionRecord({
      sessionId: 'e2e_1', prospectId: fx.context.prospect.id, repId: 'rep_test', industry,
      createdAt: new Date().toISOString(), context: fx.context, copilot, report, groundTruth: allCorrectGT(),
    });
    await store.save(rec);

    const back = await store.get('e2e_1');
    assert.ok(back && back.during.transcript.length >= 10);
    assert.ok(back!.during.lineage.every((l) => l.traceId.length > 0), 'canonical trace ids present');
    assert.equal(back!.kind, 'qualified_conversation');

    const m = buildDashboard(await store.list());
    assert.equal(m.realCalls.value, 1);
    assert.equal(m.lineageCompleteness, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
