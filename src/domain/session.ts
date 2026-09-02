/**
 * The canonical call-session record — the durable artifact every real call
 * leaves behind. This is what turns Revenue Copilot from "an intelligence
 * engine" into the beginning of AION's proprietary conversion-intelligence
 * dataset: each record pairs the AI's live interpretation with the rep's
 * corrected ground truth and the real outcome.
 *
 * It also encodes the evaluability model so that unanswered dials do not count
 * as validation conversations:
 *
 *   Dial → Call Session → Conversation → Qualified Conversation → Conversion Event
 */

import type { Turn } from './types.ts';
import type { DealState, Objection, BuyingSignal, Commitment } from './deal.ts';
import type { Recommendation, RecommendationOutcome } from './recommendation.ts';
import type { LineageRecord } from './lineage.ts';
import type { CallOutcome, TraceSummary } from './report.ts';
import type { ContextInput } from '../engines/context.ts';

/** How far a dialed attempt actually got. Only conversations can be evaluable. */
export type SessionKind =
  | 'dial' // dialed, no meaningful pickup
  | 'session' // connected, but no real dialogue (gatekeeper, instant hangup)
  | 'conversation' // enough back-and-forth for the intelligence system to evaluate
  | 'qualified_conversation'; // a conversation that reached qualification

/**
 * Why a session did not become an evaluable conversation (failure data — as
 * valuable as the successes for improving the product).
 */
export type Disposition =
  | 'no_contact'
  | 'gatekeeper'
  | 'instant_rejection'
  | 'bad_timing'
  | 'existing_provider'
  | 'rate_first'
  | 'callback'
  | 'conversation'
  | 'other';

/** Rep verdict on one AI interpretation field. */
export type VerdictKind = 'correct' | 'incorrect' | 'edited' | 'not_applicable';

export interface Verdict {
  verdict: VerdictKind;
  /** the corrected value when verdict is 'edited'. */
  corrected?: string;
}

/** The fields the rep validates after every call (30–60s of correction). */
export type GroundTruthField =
  | 'pain'
  | 'urgency'
  | 'authority'
  | 'objection'
  | 'conversation_stage'
  | 'buying_signals';

export const GROUND_TRUTH_FIELDS: GroundTruthField[] = [
  'pain',
  'urgency',
  'authority',
  'objection',
  'conversation_stage',
  'buying_signals',
];

/**
 * The subset of validated fields that are clearly-stated STRUCTURED FACTS. The
 * Mission-001 ≥85% "fact extraction" gate is measured over these only —
 * objection is an interpretation (scored by its own gate), and conversation
 * stage / buying signals are interpretation, not structured facts.
 */
export const FACT_ACCURACY_FIELDS: GroundTruthField[] = ['pain', 'urgency', 'authority'];

/** Interpretation fields — tracked separately, not part of the fact-accuracy gate. */
export const INTERPRETATION_FIELDS: GroundTruthField[] = ['conversation_stage', 'buying_signals'];

/** Overall usefulness of the live guidance, as judged by the rep. */
export type GuidanceRating = 'useful' | 'acted_on' | 'ignored' | 'wrong' | 'mixed' | null;

/** The rep-confirmed call outcome (a superset of the on-screen radio options). */
export type ConfirmedOutcome =
  | 'no_contact'
  | 'engaged'
  | 'qualified'
  | 'follow_up'
  | 'application'
  | 'appointment'
  | 'proposal'
  | 'demo'
  | 'other_conversion'
  | 'closed'
  | 'disqualified';

/** Which outcomes count as a "meaningful downstream conversion" for the gate. */
export const MEANINGFUL_OUTCOMES: ConfirmedOutcome[] = [
  'application',
  'appointment',
  'proposal',
  'demo',
  'closed',
  'other_conversion',
];

/** The rep's corrections — the ground truth. */
export interface GroundTruth {
  fields: Partial<Record<GroundTruthField, Verdict>>;
  guidance: GuidanceRating;
  outcome: ConfirmedOutcome;
  /** Rep-confirmed: did the deal actually advance a conversion stage? */
  advanced: boolean;
  /** Rep-confirmed downstream conversion, if any. */
  downstreamConversion: ConfirmedOutcome | null;
  /** Rep's disposition classification for this attempt. */
  disposition: Disposition;
  /** Rep's judgement of whether this call is an evaluable conversation. */
  evaluable: boolean;
  stageBeforeId?: string;
  stageAfterId?: string;
  nextAction?: string;
  revenueOutcome?: string;
  notes?: string;
}

export interface SessionRecord {
  // ── identity ──────────────────────────────────────────────────────────
  sessionId: string;
  prospectId: string;
  repId: string;
  industry: string;
  createdAt: string;
  finalizedAt: string | null;

  // ── classification (Dial → … → Conversion Event) ─────────────────────
  kind: SessionKind;
  disposition: Disposition;
  /** Whether this session counts toward the 25-evaluable-conversation gate. */
  evaluable: boolean;

  // ── BEFORE ───────────────────────────────────────────────────────────
  before: {
    conversionStageId: string;
    context: ContextInput;
  };

  // ── DURING (the live interpretation) ─────────────────────────────────
  during: {
    transcript: Turn[];
    finalState: DealState;
    recommendations: Recommendation[];
    objections: Objection[];
    buyingSignals: BuyingSignal[];
    commitments: Commitment[];
    lineage: LineageRecord[];
    trace: TraceSummary;
  };

  // ── REP BEHAVIOR (the rep-value loop) ────────────────────────────────
  repBehavior: {
    outcomes: RecommendationOutcome[];
  };

  // ── AFTER ────────────────────────────────────────────────────────────
  after: {
    aiOutcome: CallOutcome;
    groundTruth: GroundTruth | null;
  };
}

/**
 * Heuristic evaluability: enough genuine prospect dialogue for the intelligence
 * system to have something to interpret. The rep can override this in the
 * ground-truth form; this is the suggested default.
 */
export function suggestEvaluable(transcript: Turn[]): boolean {
  const prospectTurns = transcript.filter((t) => t.speaker === 'prospect');
  if (prospectTurns.length < 2) return false;
  const words = prospectTurns.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return words >= 40;
}

/** Suggest a session kind from the transcript and whether it is evaluable. */
export function suggestKind(transcript: Turn[], evaluable: boolean): SessionKind {
  if (transcript.filter((t) => t.speaker === 'prospect').length === 0) return 'dial';
  if (!evaluable) return 'session';
  return 'conversation';
}
