/**
 * Assemble the canonical SessionRecord from a finished live session, its
 * post-call intelligence, and (when available) the rep's ground-truth
 * corrections.
 */

import type { LiveCopilot } from '../pipeline/copilot.ts';
import type { CallIntelligence } from '../domain/report.ts';
import type { ContextInput } from '../engines/context.ts';
import type { GroundTruth, SessionRecord } from '../domain/session.ts';
import { suggestEvaluable, suggestKind } from '../domain/session.ts';

export interface AssembleParams {
  sessionId: string;
  prospectId: string;
  repId: string;
  industry: string;
  createdAt: string;
  context: ContextInput;
  copilot: LiveCopilot;
  report: CallIntelligence;
  groundTruth: GroundTruth | null;
}

/** Derive kind / disposition / evaluable from ground truth + live state. */
export function classifyFromGroundTruth(
  transcript: SessionRecord['during']['transcript'],
  finalState: SessionRecord['during']['finalState'],
  groundTruth: GroundTruth | null,
): Pick<SessionRecord, 'kind' | 'disposition' | 'evaluable'> {
  const suggestedEvaluable = suggestEvaluable(transcript);
  const evaluable = groundTruth ? groundTruth.evaluable : suggestedEvaluable;
  const kind = groundTruth
    ? groundTruth.disposition === 'conversation'
      ? groundTruth.outcome === 'qualified' || finalState.position.currentOrder >= 2
        ? 'qualified_conversation'
        : 'conversation'
      : suggestKind(transcript, evaluable)
    : suggestKind(transcript, suggestedEvaluable);
  return {
    kind,
    disposition: groundTruth?.disposition ?? (evaluable ? 'conversation' : 'no_contact'),
    evaluable,
  };
}

export function assembleSessionRecord(p: AssembleParams): SessionRecord {
  const transcript = p.copilot.getTranscript();
  const { kind, disposition, evaluable } = classifyFromGroundTruth(
    transcript,
    p.report.finalState,
    p.groundTruth,
  );

  return {
    sessionId: p.sessionId,
    prospectId: p.prospectId,
    repId: p.repId,
    industry: p.industry,
    createdAt: p.createdAt,
    finalizedAt: p.groundTruth ? new Date().toISOString() : null,
    kind,
    disposition,
    evaluable,
    before: {
      conversionStageId: p.context.conversionStageId,
      context: p.context,
    },
    during: {
      transcript,
      finalState: p.report.finalState,
      recommendations: p.copilot.getSurfaced(),
      objections: p.report.objections,
      buyingSignals: p.report.buyingSignals,
      commitments: p.report.commitments,
      lineage: p.copilot.getLineage(),
      trace: p.report.trace,
    },
    repBehavior: {
      outcomes: p.copilot.getOutcomes(),
    },
    after: {
      aiOutcome: p.report.outcome,
      groundTruth: p.groundTruth,
    },
  };
}

/**
 * Re-apply (or clear) ground truth on a persisted SessionRecord and refresh
 * classification fields. Used by PATCH /api/sessions/:id so reps can correct
 * a saved call without re-running the live pipeline.
 */
export function applyGroundTruthToRecord(
  record: SessionRecord,
  groundTruth: GroundTruth | null,
  now: string = new Date().toISOString(),
): SessionRecord {
  const classified = classifyFromGroundTruth(
    record.during.transcript,
    record.during.finalState,
    groundTruth,
  );
  return {
    ...record,
    ...classified,
    finalizedAt: groundTruth ? now : null,
    after: {
      ...record.after,
      groundTruth,
    },
  };
}
