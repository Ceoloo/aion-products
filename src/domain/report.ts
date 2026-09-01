/**
 * The durable post-call intelligence record — the point at which the live
 * interpretation becomes structured revenue data rather than a transcript.
 */

import type { DealState, Objection, BuyingSignal, Commitment } from './deal.ts';
import type { FactMap } from './facts.ts';
import type { LineageRecord } from './lineage.ts';
import type { RepFeedback } from './recommendation.ts';

/**
 * Summary of AI execution for one call — a read-model over the canonical
 * @aion/core trace (telemetry + correlation ids) plus the product's execution
 * log. @aion/core remains the trace authority.
 */
export interface TraceSummary {
  /** product AI-task executions (== canonical runs submitted). */
  total: number;
  /** canonical @aion/core telemetry rows recorded for this call. */
  telemetryRows: number;
  /** telemetry rows for the execution step specifically. */
  executionRows: number;
  /** execution count by reported model ("deterministic" when no model ran). */
  byModel: Record<string, number>;
  /** executions that fell back to the deterministic path. */
  fallbacks: number;
  avgLatencyMs: number;
  /** distinct canonical correlation ids (one per governed run). */
  correlationIds: number;
}

export interface CallOutcome {
  stageBeforeId: string;
  stageAfterId: string;
  stageBeforeOrder: number;
  stageAfterOrder: number;
  advanced: boolean;
  /** true if the call reached a "meaningful downstream conversion" rung. */
  reachedMeaningfulConversion: boolean;
  meaningfulConversionId: string | null;
}

export interface CallIntelligence {
  callId: string;
  industry: string;

  outcome: CallOutcome;

  /** frozen final deal state. */
  finalState: DealState;

  qualification: {
    facts: FactMap;
    /** facts confirmed clearly enough to be safe for an automated CRM write. */
    crmWritable: string[];
  };
  painPoints: string[];
  businessImpact: string | null;
  objections: Objection[];
  buyingSignals: BuyingSignal[];
  commitments: Commitment[];
  missingInformation: string[];

  repIntelligence: {
    questionsAsked: number;
    questionsMissed: string[];
    objectionsHandled: number;
    objectionsResolved: number;
    talkListenRepShare: number;
    strongMoments: string[];
    weakMoments: string[];
  };

  nextAction: {
    recommendedType: string;
    title: string;
    reason: string;
    requiredContext: string[];
  } | null;

  learning: {
    records: LineageRecord[];
    interventionsSurfaced: number;
    interventionsValuable: number;
    valuableRate: number | null;
    conversionEvents: number;
  };

  trace: TraceSummary;
}

export function isValuable(feedback: RepFeedback | null): boolean {
  return feedback === 'useful' || feedback === 'acted_on';
}
