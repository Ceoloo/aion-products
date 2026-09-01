/**
 * Evaluation harness.
 *
 * Runs every labeled fixture through the full pipeline and scores it against
 * ground truth, then aggregates the Mission-001 gates:
 *   - Live extraction accuracy on clearly-stated facts (target ≥85%)
 *   - Objection detection accuracy
 *   - Conversion: measurable positive conversion events + meaningful conversions
 *   - Rep-value: share of surfaced interventions rated useful / acted-upon
 *   - Learning lineage: the full chain exists for surfaced recommendations
 *
 * Deterministic by default (no key); set ANTHROPIC_API_KEY to evaluate the
 * Claude-backed path.
 */

import type { CallFixture } from '../../fixtures/types.ts';
import type { LlmProvider } from '../platform/provider-adapter.ts';
import { createCopilot, buildReport } from '../aion.ts';
import { getSchema } from '../config/registry.ts';
import { FIXTURES } from '../../fixtures/index.ts';

export interface FactCheck {
  key: string;
  expectedSubstring: string;
  extractedValue: string | null;
  correct: boolean;
}

export interface FixtureEval {
  id: string;
  industry: string;
  factChecks: FactCheck[];
  factAccuracy: number;
  objectionsExpected: string[];
  objectionsDetected: string[];
  objectionAccuracy: number;
  urgencyExpected: string | null;
  urgencyDetected: string;
  urgencyCorrect: boolean | null;
  stageAdvanceExpected: boolean;
  stageAdvanceActual: boolean;
  meaningfulExpected: boolean;
  meaningfulActual: boolean;
  nextActionType: string | null;
  nextActionOk: boolean | null;
  conversionEvents: number;
  interventionsSurfaced: number;
  interventionsRated: number;
  interventionsValuable: number;
  lineageComplete: boolean;
}

export interface EvalAggregate {
  fixtures: FixtureEval[];
  totalFactChecks: number;
  correctFactChecks: number;
  extractionAccuracy: number;
  objectionAccuracy: number;
  stageOutcomeCorrect: number;
  stageOutcomeTotal: number;
  totalConversionEvents: number;
  meaningfulConversions: number;
  interventionsSurfaced: number;
  interventionsRated: number;
  interventionsValuable: number;
  repValueRate: number | null;
  lineageComplete: boolean;
}

export interface EvalOptions {
  /** Force a provider (or null for deterministic). Undefined = auto-detect. */
  llm?: LlmProvider | null;
}

async function evalFixture(fixture: CallFixture, opts: EvalOptions): Promise<FixtureEval> {
  const schema = getSchema(fixture.industry);
  const { copilot, exec } = await createCopilot({
    callId: `eval_${fixture.id}`,
    industry: fixture.industry,
    context: fixture.context,
    llm: opts.llm,
  });

  for (const turn of fixture.turns) {
    const update = await copilot.ingest(turn);
    for (const fb of fixture.scriptedFeedback.filter((f) => f.atTurn === turn.index)) {
      const match = update.recommendations.find((r) => r.type === fb.recommendationType);
      if (match) copilot.recordFeedback(match.id, fb.feedback, turn.index);
    }
  }

  const report = buildReport(copilot, exec, schema);
  const state = report.finalState;

  // Extraction accuracy on clearly-stated facts.
  const factChecks: FactCheck[] = [];
  for (const [key, expected] of Object.entries(fixture.groundTruth.facts)) {
    const slot = state.facts[key as keyof typeof state.facts];
    const extractedValue = slot?.value ?? null;
    const correct = !!extractedValue && extractedValue.toLowerCase().includes(String(expected).toLowerCase());
    factChecks.push({ key, expectedSubstring: String(expected), extractedValue, correct });
  }
  const correctFacts = factChecks.filter((c) => c.correct).length;
  const factAccuracy = factChecks.length ? correctFacts / factChecks.length : 1;

  // Objection detection accuracy.
  const objectionsExpected = fixture.groundTruth.objections ?? [];
  const objectionsDetected = [...new Set(report.objections.map((o) => o.category))];
  const detectedHits = objectionsExpected.filter((c) => objectionsDetected.includes(c as any)).length;
  const objectionAccuracy = objectionsExpected.length ? detectedHits / objectionsExpected.length : 1;

  // Urgency.
  const urgencyExpected = fixture.groundTruth.urgency ?? null;
  const urgencyCorrect = urgencyExpected ? state.urgency === urgencyExpected : null;

  // Next action.
  const nextActionType = report.nextAction?.recommendedType ?? null;
  const nextActionOk = fixture.groundTruth.nextActionOneOf
    ? !!nextActionType && fixture.groundTruth.nextActionOneOf.includes(nextActionType as any)
    : null;

  // Lineage completeness: every surfaced rec has a state snapshot + trace id,
  // and every rec surfaced before a later prospect turn was attributed.
  const lineage = report.learning.records;
  const lineageComplete = lineage.every((r) => !!r.traceId && r.stateBefore !== undefined) &&
    lineage.filter((r) => r.surfacedAtTurn < lastProspectTurn(fixture)).every((r) => r.prospectResponseTurn !== null);

  const rated = lineage.filter((r) => r.feedback !== null).length;
  const valuable = lineage.filter((r) => r.feedback === 'useful' || r.feedback === 'acted_on').length;

  return {
    id: fixture.id,
    industry: fixture.industry,
    factChecks,
    factAccuracy,
    objectionsExpected: objectionsExpected as string[],
    objectionsDetected: objectionsDetected as string[],
    objectionAccuracy,
    urgencyExpected,
    urgencyDetected: state.urgency,
    urgencyCorrect,
    stageAdvanceExpected: fixture.groundTruth.expectStageAdvance,
    stageAdvanceActual: report.outcome.advanced,
    meaningfulExpected: fixture.groundTruth.expectMeaningfulConversion,
    meaningfulActual: report.outcome.reachedMeaningfulConversion,
    nextActionType,
    nextActionOk,
    conversionEvents: report.learning.conversionEvents,
    interventionsSurfaced: report.learning.interventionsSurfaced,
    interventionsRated: rated,
    interventionsValuable: valuable,
    lineageComplete,
  };
}

function lastProspectTurn(fixture: CallFixture): number {
  const prospectTurns = fixture.turns.filter((t) => t.speaker === 'prospect');
  return prospectTurns.length ? prospectTurns[prospectTurns.length - 1]!.index : -1;
}

export async function runEval(opts: EvalOptions = {}): Promise<EvalAggregate> {
  const fixtures: FixtureEval[] = [];
  for (const f of FIXTURES) fixtures.push(await evalFixture(f, opts));

  const totalFactChecks = fixtures.reduce((s, f) => s + f.factChecks.length, 0);
  const correctFactChecks = fixtures.reduce((s, f) => s + f.factChecks.filter((c) => c.correct).length, 0);
  const objTotal = fixtures.reduce((s, f) => s + f.objectionsExpected.length, 0);
  const objHits = fixtures.reduce((s, f) => s + f.objectionsExpected.filter((c) => f.objectionsDetected.includes(c)).length, 0);

  const stageOutcomeTotal = fixtures.length * 2; // advance + meaningful per fixture
  const stageOutcomeCorrect = fixtures.reduce(
    (s, f) => s + (f.stageAdvanceActual === f.stageAdvanceExpected ? 1 : 0) + (f.meaningfulActual === f.meaningfulExpected ? 1 : 0),
    0,
  );

  const interventionsSurfaced = fixtures.reduce((s, f) => s + f.interventionsSurfaced, 0);
  const interventionsRated = fixtures.reduce((s, f) => s + f.interventionsRated, 0);
  const interventionsValuable = fixtures.reduce((s, f) => s + f.interventionsValuable, 0);

  return {
    fixtures,
    totalFactChecks,
    correctFactChecks,
    extractionAccuracy: totalFactChecks ? correctFactChecks / totalFactChecks : 1,
    objectionAccuracy: objTotal ? objHits / objTotal : 1,
    stageOutcomeCorrect,
    stageOutcomeTotal,
    totalConversionEvents: fixtures.reduce((s, f) => s + f.conversionEvents, 0),
    meaningfulConversions: fixtures.filter((f) => f.meaningfulActual).length,
    interventionsSurfaced,
    interventionsRated,
    interventionsValuable,
    repValueRate: interventionsRated ? interventionsValuable / interventionsRated : null,
    lineageComplete: fixtures.every((f) => f.lineageComplete),
  };
}
