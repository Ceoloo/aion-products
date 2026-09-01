/**
 * Small pure predicates over DealState, shared by engines and industry schemas
 * so the definition of e.g. "urgency is confirmed" lives in exactly one place.
 */

import type { DealState, Objection, ObjectionCategory } from './deal.ts';
import type { FactKey } from './facts.ts';
import { URGENCY_ORDER, rankOf } from './types.ts';

export function factKnown(state: DealState, key: FactKey, minConfidence = 0.5): boolean {
  const slot = state.facts[key];
  return !!slot && slot.value !== null && slot.confidence >= minConfidence;
}

export function unresolvedObjections(state: DealState): Objection[] {
  return state.objections.filter((o) => o.status !== 'resolved');
}

export function hasUnresolvedObjection(state: DealState): boolean {
  return unresolvedObjections(state).length > 0;
}

export function objectionsByCategory(state: DealState, category: ObjectionCategory): Objection[] {
  return state.objections.filter((o) => o.category === category);
}

export function hasCommitment(state: DealState): boolean {
  return state.commitments.some((c) => c.by === 'prospect');
}

export function urgencyConfirmed(state: DealState, atLeast: 'low' | 'moderate' | 'high' = 'moderate'): boolean {
  return rankOf(URGENCY_ORDER, state.urgency) >= rankOf(URGENCY_ORDER, atLeast);
}

export function buyingSignalCount(state: DealState): number {
  return state.buyingSignals.length;
}
