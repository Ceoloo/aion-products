/**
 * Ladder positioning (Conversion progression).
 *
 * Deterministic and fully explainable: a deal sits at the highest rung for
 * which that rung and every rung below it have satisfied their gates. This is
 * what lets the copilot say "you're trying to close but urgency isn't
 * established" — it knows exactly which gate is unmet.
 */

import type { DealState } from '../domain/deal.ts';
import type { FactKey } from '../domain/facts.ts';
import type { LadderPosition, LadderStage } from '../domain/ladder.ts';
import type { SalesSchema } from '../config/schema.ts';
import { factSatisfied, hasCommitment, hasUnresolvedObjection } from '../domain/predicates.ts';

export interface StageGateReport {
  stage: LadderStage;
  satisfied: boolean;
  unmet: string[];
}

export function evaluateStageGate(
  state: DealState,
  stage: LadderStage,
  impliedFacts?: Partial<Record<FactKey, FactKey[]>>,
): StageGateReport {
  const unmet: string[] = [];
  for (const f of stage.gateFacts) {
    if (!factSatisfied(state, f, impliedFacts)) unmet.push(`fact:${f}`);
  }
  if (stage.requiresObjectionsResolved && hasUnresolvedObjection(state)) unmet.push('objections_unresolved');
  if (stage.requiresCommitment && !hasCommitment(state)) unmet.push('no_commitment');
  return { stage, satisfied: unmet.length === 0, unmet };
}

export interface LadderEvaluation {
  currentOrder: number;
  reports: StageGateReport[];
  /** the first rung that is NOT satisfied (the thing standing between the deal and more progress). */
  blockingStage: LadderStage | null;
  blockingUnmet: string[];
}

export function evaluateLadder(state: DealState, schema: SalesSchema): LadderEvaluation {
  const ordered = [...schema.ladder.stages].sort((a, b) => a.order - b.order);
  const reports = ordered.map((s) => evaluateStageGate(state, s, schema.impliedFacts));

  let currentOrder = 0;
  let blockingStage: LadderStage | null = null;
  let blockingUnmet: string[] = [];
  for (const r of reports) {
    // Never live-advance into an outcome-only rung — it is set post-call.
    if (r.stage.outcomeOnly) break;
    if (r.satisfied) {
      currentOrder = r.stage.order;
    } else {
      blockingStage = r.stage;
      blockingUnmet = r.unmet;
      break;
    }
  }
  return { currentOrder, reports, blockingStage, blockingUnmet };
}

/** Advance a position monotonically (high-water never decreases within a call). */
export function updatePosition(prev: LadderPosition, currentOrder: number): LadderPosition {
  return {
    startOrder: prev.startOrder,
    currentOrder,
    highWaterOrder: Math.max(prev.highWaterOrder, currentOrder),
  };
}
