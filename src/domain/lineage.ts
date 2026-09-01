/**
 * Learning lineage.
 *
 * The Mission-001 learning gate requires this exact chain to exist as durable
 * data:  context → detected state → recommendation → rep accepted/ignored →
 * prospect response → conversion movement → outcome.
 *
 * Each LineageRecord captures one recommendation's full lineage so that, given
 * enough calls, AION can discover proprietary sales intelligence from real
 * outcomes (e.g. "returning to impact after a price objection converts more").
 */

import type { RepFeedback, RecommendationType } from './recommendation.ts';

export interface StateSnapshot {
  turnIndex: number;
  ladderOrder: number;
  ladderStageId: string;
  conversationStage: string;
  readinessLevel: string;
  readinessScore: number;
  knownFactCount: number;
  openObjectionCount: number;
}

export interface LineageRecord {
  recommendationId: string;
  /** the AI execution that produced this recommendation. */
  traceId: string;
  surfacedAtTurn: number;
  recommendationType: RecommendationType;
  recommendationTitle: string;

  /** detected deal state at the moment the recommendation was surfaced. */
  stateBefore: StateSnapshot;

  /** rep reaction (the rep-value loop). */
  feedback: RepFeedback | null;
  followedByRep: boolean;

  /** the prospect's next response after the recommendation was surfaced. */
  prospectResponseTurn: number | null;
  prospectResponse: string | null;

  /** conversion movement attributed to the immediate next prospect response. */
  ladderOrderAfter: number | null;
  conversionAdvanced: boolean | null;
}
