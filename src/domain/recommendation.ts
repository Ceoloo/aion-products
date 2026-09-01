/**
 * Next-best-action recommendations and the rep-value feedback loop.
 */

import type { Confidence } from './types.ts';

/** The action space the Next-Best-Action engine chooses from. */
export type RecommendationType =
  | 'ask_question'
  | 'stay_silent'
  | 'clarify'
  | 'reframe'
  | 'quantify_impact'
  | 'address_objection'
  | 'explain_product'
  | 'ask_commitment'
  | 'schedule_follow_up'
  | 'send_application'
  | 'escalate'
  | 'disqualify';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  /** Short label shown to the rep. */
  title: string;
  /** Why this, now — grounded in the current deal state. */
  rationale: string;
  /** Optional concrete phrasing the rep can use. */
  suggestedUtterance?: string;
  /** 0..1 — how strongly the engine recommends this right now. */
  priority: number;
  /** Gaps / objections this recommendation is intended to close. */
  addressesGapIds: string[];
  addressesObjectionId?: string;
  createdAtTurn: number;
}

/** How the rep reacted to a surfaced recommendation (the rep-value gate). */
export type RepFeedback = 'useful' | 'ignored' | 'wrong' | 'already_knew' | 'acted_on';

export interface RecommendationOutcome {
  recommendationId: string;
  feedback: RepFeedback;
  atTurn: number;
  note?: string;
}

/** Whether a piece of feedback counts toward the "useful or acted upon" gate. */
export function countsAsValuable(feedback: RepFeedback): boolean {
  return feedback === 'useful' || feedback === 'acted_on';
}

export function makeRecommendation(
  partial: Omit<Recommendation, 'addressesGapIds' | 'priority'> &
    Partial<Pick<Recommendation, 'addressesGapIds' | 'priority'>>,
): Recommendation {
  return {
    addressesGapIds: [],
    priority: 0.5,
    ...partial,
  };
}

export type { Confidence };
