/**
 * Real-call scoring and the validation dashboard.
 *
 * Unlike the synthetic fixture eval, this scores the AI's live interpretation
 * against the REP'S CORRECTED GROUND TRUTH — the manual evaluation the mission
 * requires before trusting the system. It also enforces the evaluability model:
 * only evaluable conversations count toward the 25-real-conversation gate.
 */

import type { SessionRecord } from '../domain/session.ts';
import { FACT_ACCURACY_FIELDS, MEANINGFUL_OUTCOMES } from '../domain/session.ts';

export interface RecordScore {
  sessionId: string;
  evaluable: boolean;
  finalized: boolean;
  fieldsJudged: number;
  fieldsCorrect: number;
  objectionJudged: boolean;
  objectionCorrect: boolean;
  ratedInterventions: number;
  valuableInterventions: number;
  conversionAdvanced: boolean;
  downstreamConversion: boolean;
  lineageComplete: boolean;
}

/** Score one finalized record's AI interpretation against the rep's ground truth. */
export function scoreRecord(record: SessionRecord): RecordScore {
  const gt = record.after.groundTruth;
  const finalized = gt !== null;

  // Fact accuracy is measured over clearly-stated STRUCTURED FACTS only
  // (pain/urgency/authority). Objection is scored by its own gate; conversation
  // stage and buying signals are interpretation, not part of the fact gate.
  let fieldsJudged = 0;
  let fieldsCorrect = 0;
  if (gt) {
    for (const field of FACT_ACCURACY_FIELDS) {
      const v = gt.fields[field];
      if (!v || v.verdict === 'not_applicable') continue;
      fieldsJudged += 1;
      if (v.verdict === 'correct') fieldsCorrect += 1;
    }
  }
  const objV = gt?.fields.objection;
  const objectionJudged = !!objV && objV.verdict !== 'not_applicable';
  const objectionCorrect = objectionJudged && objV!.verdict === 'correct';

  // Rep-value: count only the LATEST feedback per recommendation (the UI
  // presents a rating change as a replacement, but records append), then fall
  // back to the overall guidance rating when no per-rec feedback exists.
  const latest = new Map<string, string>();
  for (const o of record.repBehavior.outcomes) latest.set(o.recommendationId, o.feedback);
  let rated = 0;
  let valuable = 0;
  for (const fb of latest.values()) {
    rated += 1;
    if (fb === 'useful' || fb === 'acted_on') valuable += 1;
  }
  if (rated === 0 && gt && gt.guidance) {
    if (gt.guidance === 'useful' || gt.guidance === 'acted_on') { rated = 1; valuable = 1; }
    else if (gt.guidance === 'ignored' || gt.guidance === 'wrong' || gt.guidance === 'mixed') { rated = 1; }
  }

  const conversionAdvanced = gt?.advanced ?? false;
  // Only a MEANINGFUL downstream outcome counts (application/appointment/etc.),
  // whether named explicitly or implied by the call outcome.
  const downstreamConversion =
    (gt?.downstreamConversion != null && MEANINGFUL_OUTCOMES.includes(gt.downstreamConversion)) ||
    (gt != null && MEANINGFUL_OUTCOMES.includes(gt.outcome));

  // Lineage completeness requires the whole documented chain to exist for the
  // call — context → detected state → recommendation → rep feedback → prospect
  // response → conversion movement — not merely a trace id + snapshot.
  const lineage = record.during.lineage;
  const hasStateLinked = lineage.length > 0 && lineage.every((r) => typeof r.traceId === 'string' && r.traceId.length > 0 && r.stateBefore !== undefined);
  const hasFeedback = record.repBehavior.outcomes.length > 0 || (gt != null && gt.guidance != null);
  const hasResponse = lineage.some((r) => r.prospectResponseTurn !== null);
  const hasMovement = gt != null; // rep-confirmed advancement + AI outcome recorded at finalize
  const lineageComplete = finalized && hasStateLinked && hasFeedback && hasResponse && hasMovement;

  return {
    sessionId: record.sessionId,
    evaluable: record.evaluable,
    finalized,
    fieldsJudged,
    fieldsCorrect,
    objectionJudged,
    objectionCorrect,
    ratedInterventions: rated,
    valuableInterventions: valuable,
    conversionAdvanced,
    downstreamConversion,
    lineageComplete,
  };
}

export interface GateStatus {
  value: number;
  target: number;
  met: boolean;
}

export interface DashboardMetrics {
  totalSessions: number;
  totalDials: number;
  evaluableConversations: number;
  // Gates
  realCalls: GateStatus; // evaluable & finalized, target 25
  factAccuracy: number | null; // target 0.85
  objectionAccuracy: number | null; // target 0.85
  usefulInterventionRate: number | null; // target 0.60
  conversionAdvances: GateStatus; // target 10
  downstreamConversions: GateStatus; // target 3
  lineageCompleteness: number | null; // fraction of evaluable finalized records
  // Failure data
  dispositions: Record<string, number>;
  gatesMet: boolean;
}

const TARGETS = { realCalls: 25, factAccuracy: 0.85, objectionAccuracy: 0.85, useful: 0.6, advances: 10, downstream: 3 };

/** Aggregate finalized records into the Mission-001 validation dashboard metrics. */
export function buildDashboard(records: SessionRecord[]): DashboardMetrics {
  const scores = records.map(scoreRecord);
  const evaluableFinal = records.filter((r, i) => r.evaluable && scores[i]!.finalized);
  const evalScores = scores.filter((s) => s.evaluable && s.finalized);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const fieldsJudged = sum(evalScores.map((s) => s.fieldsJudged));
  const fieldsCorrect = sum(evalScores.map((s) => s.fieldsCorrect));
  const objJudged = evalScores.filter((s) => s.objectionJudged).length;
  const objCorrect = evalScores.filter((s) => s.objectionCorrect).length;
  const rated = sum(evalScores.map((s) => s.ratedInterventions));
  const valuable = sum(evalScores.map((s) => s.valuableInterventions));
  const advances = evalScores.filter((s) => s.conversionAdvanced).length;
  const downstream = evalScores.filter((s) => s.downstreamConversion).length;
  const lineageComplete = evalScores.filter((s) => s.lineageComplete).length;

  const dispositions: Record<string, number> = {};
  for (const r of records) dispositions[r.disposition] = (dispositions[r.disposition] ?? 0) + 1;

  const realCalls: GateStatus = { value: evaluableFinal.length, target: TARGETS.realCalls, met: evaluableFinal.length >= TARGETS.realCalls };
  const conversionAdvances: GateStatus = { value: advances, target: TARGETS.advances, met: advances >= TARGETS.advances };
  const downstreamConversions: GateStatus = { value: downstream, target: TARGETS.downstream, met: downstream >= TARGETS.downstream };

  const factAccuracy = fieldsJudged ? Number((fieldsCorrect / fieldsJudged).toFixed(3)) : null;
  const objectionAccuracy = objJudged ? Number((objCorrect / objJudged).toFixed(3)) : null;
  const usefulInterventionRate = rated ? Number((valuable / rated).toFixed(3)) : null;
  const lineageCompleteness = evalScores.length ? Number((lineageComplete / evalScores.length).toFixed(3)) : null;

  const gatesMet =
    realCalls.met &&
    conversionAdvances.met &&
    downstreamConversions.met &&
    factAccuracy !== null && factAccuracy >= TARGETS.factAccuracy &&
    objectionAccuracy !== null && objectionAccuracy >= TARGETS.objectionAccuracy &&
    usefulInterventionRate !== null && usefulInterventionRate >= TARGETS.useful &&
    lineageCompleteness !== null && lineageCompleteness >= 1;

  return {
    totalSessions: records.length,
    totalDials: records.filter((r) => r.kind === 'dial').length,
    evaluableConversations: records.filter((r) => r.evaluable).length,
    realCalls,
    factAccuracy,
    objectionAccuracy,
    usefulInterventionRate,
    conversionAdvances,
    downstreamConversions,
    lineageCompleteness,
    dispositions,
    gatesMet,
  };
}

export { TARGETS };
