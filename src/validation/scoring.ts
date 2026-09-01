/**
 * Real-call scoring and the validation dashboard.
 *
 * Unlike the synthetic fixture eval, this scores the AI's live interpretation
 * against the REP'S CORRECTED GROUND TRUTH — the manual evaluation the mission
 * requires before trusting the system. It also enforces the evaluability model:
 * only evaluable conversations count toward the 25-real-conversation gate.
 */

import type { SessionRecord, GroundTruthField } from '../domain/session.ts';
import { GROUND_TRUTH_FIELDS, MEANINGFUL_OUTCOMES } from '../domain/session.ts';

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

export function scoreRecord(record: SessionRecord): RecordScore {
  const gt = record.after.groundTruth;
  const finalized = gt !== null;

  let fieldsJudged = 0;
  let fieldsCorrect = 0;
  let objectionJudged = false;
  let objectionCorrect = false;

  if (gt) {
    for (const field of GROUND_TRUTH_FIELDS as GroundTruthField[]) {
      const v = gt.fields[field];
      if (!v || v.verdict === 'not_applicable') continue;
      fieldsJudged += 1;
      const correct = v.verdict === 'correct';
      if (correct) fieldsCorrect += 1;
      if (field === 'objection') {
        objectionJudged = true;
        objectionCorrect = correct;
      }
    }
  }

  // Rep-value: prefer per-recommendation outcomes; fall back to the overall
  // guidance rating so every finalized call contributes one data point.
  let rated = 0;
  let valuable = 0;
  for (const o of record.repBehavior.outcomes) {
    rated += 1;
    if (o.feedback === 'useful' || o.feedback === 'acted_on') valuable += 1;
  }
  if (rated === 0 && gt && gt.guidance) {
    if (gt.guidance === 'useful' || gt.guidance === 'acted_on') {
      rated = 1;
      valuable = 1;
    } else if (gt.guidance === 'ignored' || gt.guidance === 'wrong') {
      rated = 1;
    } else if (gt.guidance === 'mixed') {
      rated = 1;
    }
  }

  const conversionAdvanced = gt?.advanced ?? false;
  const downstreamConversion =
    (gt?.downstreamConversion != null) ||
    (gt != null && MEANINGFUL_OUTCOMES.includes(gt.outcome));

  const lineage = record.during.lineage;
  const lineageComplete =
    lineage.length > 0 &&
    lineage.every((r) => typeof r.traceId === 'string' && r.traceId.length > 0 && r.stateBefore !== undefined);

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
