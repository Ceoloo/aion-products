/**
 * Post-call intelligence: freeze the live interpretation into a durable
 * CallIntelligence record — structured revenue data, not a transcript.
 */

import type { LiveCopilot } from './copilot.ts';
import type { AiExecutionService } from '../platform/ai-execution.ts';
import type { SalesSchema } from '../config/schema.ts';
import type { CallIntelligence, CallOutcome } from '../domain/report.ts';
import type { Turn } from '../domain/types.ts';
import { isValuable } from '../domain/report.ts';
import { stageByOrder } from '../domain/ladder.ts';
import { countsAsValuable } from '../domain/recommendation.ts';

function talkRepShare(transcript: Turn[]): number {
  let rep = 0;
  let prospect = 0;
  for (const t of transcript) {
    if (t.speaker === 'rep') rep += t.text.length;
    else if (t.speaker === 'prospect') prospect += t.text.length;
  }
  const total = rep + prospect;
  return total === 0 ? 0 : Number((rep / total).toFixed(3));
}

export function buildReport(copilot: LiveCopilot, exec: AiExecutionService, schema: SalesSchema): CallIntelligence {
  const state = copilot.currentState();
  const transcript = copilot.getTranscript();
  const surfaced = copilot.getSurfaced();
  const lineage = copilot.getLineage();

  const startOrder = state.position.startOrder;
  const afterOrder = state.position.currentOrder;
  const highWater = state.position.highWaterOrder;

  // Meaningful downstream conversion reached at any point in the call.
  let meaningfulId: string | null = null;
  for (let o = highWater; o >= 0; o--) {
    const s = stageByOrder(schema.ladder, o);
    if (s?.meaningfulConversion) {
      meaningfulId = s.id;
      break;
    }
  }

  const outcome: CallOutcome = {
    stageBeforeId: stageByOrder(schema.ladder, startOrder)?.id ?? 'unknown',
    stageAfterId: stageByOrder(schema.ladder, afterOrder)?.id ?? 'unknown',
    stageBeforeOrder: startOrder,
    stageAfterOrder: afterOrder,
    advanced: afterOrder > startOrder,
    reachedMeaningfulConversion: meaningfulId !== null,
    meaningfulConversionId: meaningfulId,
  };

  // Qualification + CRM-write governance.
  const crmWritable: string[] = [];
  for (const slot of Object.values(state.facts)) {
    if (slot && exec.canAutoWriteFact(slot)) crmWritable.push(slot.key);
  }

  const painPoints = [state.facts.pain?.value, state.facts.need?.value].filter((v): v is string => !!v);

  // Rep intelligence.
  const questionsAsked = transcript.filter((t) => t.speaker === 'rep' && t.text.includes('?')).length;
  const objectionsHandled = state.objections.filter((o) => o.status !== 'open').length;
  const objectionsResolved = state.objections.filter((o) => o.status === 'resolved').length;
  const strongMoments = [
    ...state.commitments.map((c) => `Commitment (turn ${c.turnIndex}): ${c.description}`),
    ...state.objections.filter((o) => o.status === 'resolved').map((o) => `Resolved ${o.category} objection`),
  ];
  const weakMoments = state.gaps.filter((g) => g.severity !== 'info').map((g) => g.message);

  // Forward-looking next action = top recommendation from the last turn seen.
  const lastTurn = surfaced.reduce((m, r) => Math.max(m, r.createdAtTurn), -1);
  const lastRecs = surfaced.filter((r) => r.createdAtTurn === lastTurn).sort((a, b) => b.priority - a.priority);
  const top = lastRecs[0];
  const nextAction = top
    ? { recommendedType: top.type, title: top.title, reason: top.rationale, requiredContext: state.missingInformation }
    : null;

  // Learning lineage aggregates.
  const rated = lineage.filter((r) => r.feedback !== null);
  const valuable = rated.filter((r) => isValuable(r.feedback));
  const valuableRate = rated.length ? Number((valuable.length / rated.length).toFixed(3)) : null;
  const conversionEvents = Math.max(0, highWater - startOrder);

  return {
    callId: state.callId,
    industry: state.industry,
    outcome,
    finalState: state,
    qualification: { facts: state.facts, crmWritable },
    painPoints,
    businessImpact: state.facts.business_impact?.value ?? null,
    objections: state.objections,
    buyingSignals: state.buyingSignals,
    commitments: state.commitments,
    missingInformation: state.missingInformation,
    repIntelligence: {
      questionsAsked,
      questionsMissed: state.missingInformation,
      objectionsHandled,
      objectionsResolved,
      talkListenRepShare: talkRepShare(transcript),
      strongMoments,
      weakMoments,
    },
    nextAction,
    learning: {
      records: lineage,
      interventionsSurfaced: lineage.length,
      interventionsValuable: valuable.length,
      valuableRate,
      conversionEvents,
    },
    trace: exec.traceSummary(),
  };
}

export { countsAsValuable };
