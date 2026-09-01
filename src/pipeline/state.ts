/**
 * State helpers: initial state construction, urgency reconciliation, snapshots.
 */

import type { DealState, Objection } from '../domain/deal.ts';
import type { Urgency } from '../domain/types.ts';
import type { SalesSchema } from '../config/schema.ts';
import type { PreCallContext } from '../domain/context.ts';
import type { StateSnapshot } from '../domain/lineage.ts';
import { knownFactCount } from '../domain/facts.ts';
import { normalize } from '../engines/lib/text.ts';
import { matchPlaybook } from '../engines/objection.ts';
import { stageById } from '../domain/ladder.ts';
import { unresolvedObjections } from '../domain/predicates.ts';

export function mapUrgencyTextToEnum(text: string): Urgency {
  const n = normalize(text);
  if (/(asap|immediately|right away|today|this week|urgent|yesterday)/.test(n)) return 'immediate';
  if (/(30 days|this month|soon|next month|next few weeks|quickly)/.test(n)) return 'high';
  if (/(this quarter|couple months|60 days|90 days|few months)/.test(n)) return 'moderate';
  if (/(eventually|sometime|no rush|just looking|exploring|down the road)/.test(n)) return 'low';
  if (/(not interested|no need|don't need)/.test(n)) return 'none';
  return 'unknown';
}

/** Carry known prior objections into the live state as open objections. */
function seedPriorObjections(schema: SalesSchema, priorObjections: string[]): Objection[] {
  return priorObjections.map((surface, idx) => {
    const entry = matchPlaybook(surface, schema.objectionPlaybook);
    return {
      id: `obj_prior_${idx}`,
      surface,
      category: entry?.category ?? 'other',
      underlyingConcerns: entry?.concerns ?? [],
      status: 'open',
      confidence: 0.6,
      firstSeenTurn: -1,
      lastSeenTurn: -1,
      evidence: [],
    };
  });
}

export function initialState(callId: string, schema: SalesSchema, context: PreCallContext): DealState {
  const startStage = stageById(schema.ladder, context.conversionStageId);
  const startOrder = startStage ? startStage.order : 0;
  return {
    callId,
    industry: schema.key,
    accountId: context.prospect.id,
    ladderKey: schema.ladder.key,
    position: { startOrder, currentOrder: startOrder, highWaterOrder: startOrder },
    facts: { ...context.knownFacts },
    sentiment: 'unknown',
    urgency: 'unknown',
    conversationStage: 'opening',
    objections: seedPriorObjections(schema, context.priorObjections),
    buyingSignals: [],
    commitments: [],
    gaps: [],
    missingInformation: [],
    readiness: { signals: [], level: 'cold', primaryBlocker: null, score: 0 },
    updatedAtTurn: -1,
  };
}

export function snapshot(state: DealState, schema: SalesSchema): StateSnapshot {
  const stage = stageById(schema.ladder, currentStageId(state, schema));
  return {
    turnIndex: state.updatedAtTurn,
    ladderOrder: state.position.currentOrder,
    ladderStageId: stage?.id ?? 'unknown',
    conversationStage: state.conversationStage,
    readinessLevel: state.readiness.level,
    readinessScore: state.readiness.score,
    knownFactCount: knownFactCount(state.facts),
    openObjectionCount: unresolvedObjections(state).length,
  };
}

export function currentStageId(state: DealState, schema: SalesSchema): string {
  const stage = schema.ladder.stages.find((s) => s.order === state.position.currentOrder);
  return stage?.id ?? schema.ladder.stages[0]!.id;
}
