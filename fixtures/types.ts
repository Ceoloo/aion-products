/**
 * Labeled call fixtures.
 *
 * These are a synthetic evaluation set used to exercise the pipeline and the
 * Mission-001 gates offline (deterministically, no API key). Production
 * validation still requires ≥25 real sales conversations — see docs/GATES.md.
 *
 * `groundTruth` is a manual labeling of the clearly-stated structured facts and
 * expected outcome, against which the eval harness scores extraction accuracy.
 */

import type { Turn, Urgency, ConversationStage } from '../src/domain/types.ts';
import type { FactKey } from '../src/domain/facts.ts';
import type { ObjectionCategory } from '../src/domain/deal.ts';
import type { RecommendationType, RepFeedback } from '../src/domain/recommendation.ts';
import type { ContextInput } from '../src/engines/context.ts';

/** Scripted rep feedback for the demo: match the first recommendation of `type` and mark it. */
export interface ScriptedFeedback {
  atTurn: number;
  recommendationType: RecommendationType;
  feedback: RepFeedback;
}

export interface GroundTruth {
  /** Clearly stated facts: key → a lowercased substring expected in the extracted value. */
  facts: Partial<Record<FactKey, string>>;
  urgency?: Urgency;
  objections?: ObjectionCategory[];
  finalConversationStageOneOf?: ConversationStage[];
  expectStageAdvance: boolean;
  expectMeaningfulConversion: boolean;
  /** Acceptable next-action types by the end of the call. */
  nextActionOneOf?: RecommendationType[];
}

export interface CallFixture {
  id: string;
  title: string;
  industry: string;
  context: ContextInput;
  turns: Turn[];
  scriptedFeedback: ScriptedFeedback[];
  groundTruth: GroundTruth;
}
