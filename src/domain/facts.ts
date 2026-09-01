/**
 * Structured qualification facts.
 *
 * The Live Conversation Engine turns unstructured talk into these slots. Each
 * slot carries a value, a confidence, and provenance (which turn stated it and
 * whether it was stated *explicitly* vs inferred). The explicit/inferred split
 * matters for the Mission-001 accuracy gate: we hold automated CRM writes to a
 * high bar on *clearly stated* facts, and treat inferences more cautiously.
 */

import type { Confidence, Evidence } from './types.ts';

/**
 * The canonical fact vocabulary. Individual industries surface a subset of
 * these as the ones that gate ladder advancement (see SalesSchema), but the
 * extraction vocabulary itself is shared so the platform intelligence is
 * reusable.
 */
export type FactKey =
  | 'revenue'
  | 'time_in_business'
  | 'industry'
  | 'need'
  | 'pain'
  | 'business_impact'
  | 'urgency'
  | 'capital_amount'
  | 'budget'
  | 'decision_authority'
  | 'existing_solution'
  | 'existing_obligations'
  | 'timeline'
  | 'use_of_funds'
  | 'credit_posture';

export interface FactSlot {
  key: FactKey;
  /** Human label for UI. */
  label: string;
  /** Normalized textual value, or null when still unknown. */
  value: string | null;
  confidence: Confidence;
  /** True when the prospect stated it plainly; false when the copilot inferred it. */
  statedExplicitly: boolean;
  evidence: Evidence[];
  /** Turn index at which this slot was last updated. */
  updatedAtTurn: number;
}

export type FactMap = Partial<Record<FactKey, FactSlot>>;

export const FACT_LABELS: Record<FactKey, string> = {
  revenue: 'Monthly / annual revenue',
  time_in_business: 'Time in business',
  industry: 'Industry',
  need: 'Need',
  pain: 'Pain',
  business_impact: 'Business impact',
  urgency: 'Urgency',
  capital_amount: 'Capital amount',
  budget: 'Budget',
  decision_authority: 'Decision authority',
  existing_solution: 'Existing solution',
  existing_obligations: 'Existing obligations',
  timeline: 'Timeline',
  use_of_funds: 'Use of funds',
  credit_posture: 'Credit posture',
};

export function emptyFactMap(): FactMap {
  return {};
}

/** Number of known (non-null) fact slots. */
export function knownFactCount(facts: FactMap): number {
  return Object.values(facts).filter((f) => f && f.value !== null).length;
}
