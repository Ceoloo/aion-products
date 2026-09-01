/**
 * The live deal state — the central object Revenue Copilot maintains.
 *
 * The AI is not "generating scripts"; it maintains a live interpretation of the
 * deal that is updated turn-by-turn and frozen into a durable record after the
 * call.
 */

import type { Confidence, ConversationStage, Evidence, Sentiment, Turn, Urgency } from './types.ts';
import type { FactMap } from './facts.ts';
import type { LadderPosition } from './ladder.ts';

/** A named objection, interpreted rather than keyword-matched. */
export interface Objection {
  id: string;
  /** Verbatim surface form, e.g. "Rates are probably too high." */
  surface: string;
  /** Interpreted category. */
  category: ObjectionCategory;
  /**
   * The likely underlying concern(s). One surface objection can map to several
   * candidate concerns with different responses.
   */
  underlyingConcerns: string[];
  status: 'open' | 'addressed' | 'resolved';
  confidence: Confidence;
  firstSeenTurn: number;
  lastSeenTurn: number;
  evidence: Evidence[];
}

export type ObjectionCategory =
  | 'price'
  | 'timing'
  | 'trust'
  | 'authority'
  | 'need'
  | 'competition'
  | 'risk'
  | 'stall'
  | 'other';

/** A buying signal — verbal cue that intent is rising. */
export interface BuyingSignal {
  id: string;
  kind: 'question_about_terms' | 'future_pacing' | 'urgency_language' | 'budget_disclosure' | 'social_proof_request' | 'commitment_language' | 'other';
  surface: string;
  confidence: Confidence;
  turnIndex: number;
}

/** Something the prospect (or rep) committed to. */
export interface Commitment {
  id: string;
  description: string;
  by: 'prospect' | 'rep';
  turnIndex: number;
  confidence: Confidence;
}

/** A gap the copilot detected between where the call is and where it should be. */
export interface Gap {
  id: string;
  kind: 'missing_fact' | 'sequence' | 'unresolved_objection' | 'no_commitment';
  /** Explanation, e.g. "Trying to close but urgency not established." */
  message: string;
  severity: 'info' | 'warn' | 'block';
}

/** One explainable readiness signal. */
export interface ReadinessSignal {
  key: string;
  label: string;
  state: 'confirmed' | 'partial' | 'missing' | 'blocked';
  detail?: string;
}

export type ReadinessLevel = 'cold' | 'developing' | 'moderate' | 'strong' | 'ready';

export interface ConversionReadiness {
  signals: ReadinessSignal[];
  level: ReadinessLevel;
  /** Human-readable primary blocker, if any. */
  primaryBlocker: string | null;
  /**
   * An explainable score in 0..1 derived from the signals. Deliberately NOT an
   * opaque "AI percentage" — it is the mean of signal weights and is fully
   * reconstructable from `signals`.
   */
  score: number;
}

/** Full snapshot of the deal at a point in the conversation. */
export interface DealState {
  callId: string;
  industry: string;
  /** account / prospect id if linked to CRM. */
  accountId?: string;

  ladderKey: string;
  position: LadderPosition;

  facts: FactMap;
  sentiment: Sentiment;
  urgency: Urgency;
  conversationStage: ConversationStage;

  objections: Objection[];
  buyingSignals: BuyingSignal[];
  commitments: Commitment[];
  gaps: Gap[];
  missingInformation: string[];

  readiness: ConversionReadiness;

  /** Turn index of the last update applied. -1 before the call starts. */
  updatedAtTurn: number;
}
