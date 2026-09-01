/**
 * Shared vocabulary for the Revenue Copilot.
 *
 * We deliberately use string-literal union types plus `const` lookup objects
 * instead of TS `enum`s so the whole codebase runs under Node's native
 * type-stripping (no build step) and stays `erasableSyntaxOnly`.
 */

/** Prospect emotional read, coarse but explainable. */
export type Sentiment =
  | 'unknown'
  | 'hostile'
  | 'skeptical'
  | 'cautious'
  | 'neutral'
  | 'interested'
  | 'enthusiastic';

export const SENTIMENT_ORDER: Sentiment[] = [
  'hostile',
  'skeptical',
  'cautious',
  'neutral',
  'interested',
  'enthusiastic',
];

/**
 * Where the conversation itself currently is. This is the *mechanics* of the
 * call, distinct from the deal's position on the conversion ladder.
 */
export type ConversationStage =
  | 'opening'
  | 'discovery'
  | 'qualification'
  | 'problem_development'
  | 'solution_positioning'
  | 'objection'
  | 'negotiation'
  | 'commitment'
  | 'closing';

export const CONVERSATION_STAGES: ConversationStage[] = [
  'opening',
  'discovery',
  'qualification',
  'problem_development',
  'solution_positioning',
  'objection',
  'negotiation',
  'commitment',
  'closing',
];

/** How pressing the need is, normalized across industries. */
export type Urgency = 'unknown' | 'none' | 'low' | 'moderate' | 'high' | 'immediate';

export const URGENCY_ORDER: Urgency[] = ['none', 'low', 'moderate', 'high', 'immediate'];

/** Confidence attached to any inferred value. */
export type Confidence = number; // 0..1

/** A single utterance in the conversation stream. */
export interface Turn {
  index: number;
  speaker: 'rep' | 'prospect' | 'system';
  text: string;
  /** Wall-clock or relative timestamp in ms from call start, if known. */
  atMs?: number;
}

/** Speaker talk-time accounting, used by rep intelligence. */
export interface TalkRatio {
  repChars: number;
  prospectChars: number;
  repTurns: number;
  prospectTurns: number;
  /** 0..1 — fraction of substance spoken by the rep. */
  repShare: number;
}

/** Provenance for anything the copilot asserts. */
export interface Evidence {
  turnIndex: number;
  quote: string;
}

export function clampConfidence(c: number): Confidence {
  if (Number.isNaN(c)) return 0;
  return Math.max(0, Math.min(1, c));
}

export function rankOf<T>(order: T[], value: T): number {
  const i = order.indexOf(value);
  return i < 0 ? -1 : i;
}
