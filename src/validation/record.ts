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

export function assembleSessionRecord(p: AssembleParams): SessionRecord {
  const transcript = p.copilot.getTranscript();
  const suggestedEvaluable = suggestEvaluable(transcript);
  const evaluable = p.groundTruth ? p.groundTruth.evaluable : suggestedEvaluable;
  const kind = p.groundTruth
    ? p.groundTruth.disposition === 'conversation'
      ? p.groundTruth.outcome === 'qualified' || p.report.finalState.position.currentOrder >= 2
        ? 'qualified_conversation'
        : 'conversation'
      : suggestKind(transcript, evaluable)
    : suggestKind(transcript, suggestedEvaluable);

  return {
    sessionId: p.sessionId,
    prospectId: p.prospectId,
    repId: p.repId,
    industry: p.industry,
    createdAt: p.createdAt,
    finalizedAt: p.groundTruth ? new Date().toISOString() : null,
    kind,
    disposition: p.groundTruth?.disposition ?? (evaluable ? 'conversation' : 'no_contact'),
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
