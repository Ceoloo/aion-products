/**
 * Speaker-role inference — decide who is the REP and who is the LEAD.
 *
 * The rep is recognizable from the greeting and the script: they open the call,
 * introduce themselves, pitch, and ask qualifying questions. The lead is
 * recognizable from their answers and their questions: they describe their
 * business, state needs, and ask about price / terms / how it works, and raise
 * objections.
 *
 * This is a product-side ingestion adapter — it turns raw (possibly unlabeled
 * or diarized) utterances into role-attributed `Turn[]` that the domain already
 * consumes. It is deterministic and explainable; a diarizing STT or an LLM
 * classifier could refine it later without changing the interface.
 */

import type { Turn } from '../domain/types.ts';
import { normalize } from '../engines/lib/text.ts';

export interface RawUtterance {
  /** raw text of the utterance. */
  text: string;
  /**
   * Optional raw channel/diarization label (e.g. "spk1", "Speaker 2", a name).
   * When present and consistent, it lets us attribute robustly two-channel.
   */
  channel?: string;
  atMs?: number;
}

export type Role = 'rep' | 'prospect';

const REP_CUES: Array<[RegExp, number]> = [
  [/\b(hi|hello|hey|good (morning|afternoon|evening))\b/, 1],
  [/\b(this is|my name is|i'?m calling|calling (from|about|on behalf)|reaching out|following up)\b/, 3],
  [/\b(quick (minute|second)|got a minute|is now a good time|do you have a)\b/, 2],
  [/\b(we (offer|help|provide|work with|specialize)|what we do|the way it works|our (product|program|company)|let me explain|here'?s why|walk you through)\b/, 3],
  [/\b(how long have you|how much do you (do|make|bring)|what'?s your|do you currently|are you the (owner|decision)|who (makes|handles) the|can i ask|tell me (about|a little))\b/, 3],
  [/\b(i can (get|send)|let'?s (get|schedule|set up)|next step|send (you )?the (application|paperwork|details)|get you (started|approved))\b/, 2],
  [/\b(great|perfect|awesome|makes sense|totally|absolutely|no problem|happy to)\b/, 1],
];

const LEAD_CUES: Array<[RegExp, number]> = [
  [/\b(we (do|make|bring in|run|have)|i (own|run|started)|we'?ve been|my (business|company|shop|partner|wife|husband)|our (revenue|business|company))\b/, 3],
  [/\b(i need|we need|i'?m looking for|we'?re looking for|i want|trying to|hoping to)\b/, 2],
  [/\b(what (are the|would the|'?s the) (rate|rates|cost|price|terms|fee|catch)|how much (would|do|is)|how does (repayment|it work|the)|is there a (fee|catch)|what'?s the interest)\b/, 3],
  [/\b(too (high|expensive|much)|not interested|already have|don'?t need|can'?t afford|call me back|not a good time|send me (info|something)|think about it)\b/, 3],
  [/\b(how soon|when (can|could|would)|do you (have|offer)|can you)\b/, 1],
];

function score(text: string, cues: Array<[RegExp, number]>): number {
  const n = normalize(text);
  let s = 0;
  for (const [re, w] of cues) if (re.test(n)) s += w;
  return s;
}

/** Per-utterance role lean from content alone: >0 rep, <0 lead, 0 neutral. */
export function roleLean(text: string): number {
  return score(text, REP_CUES) - score(text, LEAD_CUES);
}

export interface RoleAssignment {
  turns: Turn[];
  /** confidence 0..1 that the rep/lead split is correct. */
  confidence: number;
  /** how the split was decided. */
  method: 'labeled' | 'two-channel' | 'content';
}

/**
 * Assign rep/prospect roles to raw utterances.
 *  - If two consistent raw channels are present, map the channel with the
 *    stronger aggregate rep-lean to `rep` and the other to `prospect`.
 *  - Otherwise infer per utterance from content, with light turn-alternation
 *    smoothing and a "greeter is the rep" prior on the opening.
 */
export function assignRoles(utterances: RawUtterance[]): RoleAssignment {
  const channels = new Set(utterances.map((u) => (u.channel ?? '').trim()).filter(Boolean));

  // Two-channel (diarized) path — only when EVERY utterance carries one of the
  // two channels. A partially-diarized transcript (some lines unlabeled) would
  // otherwise misattribute the unlabeled lines to `prospect`; fall through to
  // content inference instead.
  const fullyDiarized = channels.size === 2 && utterances.every((u) => {
    const c = u.channel?.trim();
    return !!c && channels.has(c);
  });
  if (fullyDiarized) {
    const [a, b] = [...channels];
    const agg: Record<string, number> = { [a!]: 0, [b!]: 0 };
    for (const u of utterances) if (u.channel) agg[u.channel.trim()] = (agg[u.channel.trim()] ?? 0) + roleLean(u.text);
    // First speaker with a clear greeting is the rep (strong prior).
    const opener = utterances.find((u) => score(u.text, REP_CUES) >= 3)?.channel?.trim();
    let repChannel = agg[a!]! >= agg[b!]! ? a! : b!;
    if (opener && (opener === a || opener === b)) repChannel = opener;
    const margin = Math.abs(agg[a!]! - agg[b!]!);
    const turns: Turn[] = utterances.map((u, i) => ({
      index: i,
      speaker: u.channel?.trim() === repChannel ? 'rep' : 'prospect',
      text: u.text.trim(),
      ...(u.atMs !== undefined ? { atMs: u.atMs } : {}),
    }));
    return { turns, confidence: Math.min(1, 0.6 + margin / 12), method: 'two-channel' };
  }

  // Content path: per-utterance lean, with alternation smoothing.
  const turns: Turn[] = [];
  let prev: Role | null = null;
  let decided = 0;
  utterances.forEach((u, i) => {
    const lean = roleLean(u.text);
    let role: Role;
    if (lean > 0) role = 'rep';
    else if (lean < 0) role = 'prospect';
    else if (i === 0) role = 'rep'; // the call is opened by the rep
    else role = prev === 'rep' ? 'prospect' : 'rep'; // assume turn-taking when neutral
    if (lean !== 0) decided += 1;
    prev = role;
    turns.push({ index: i, speaker: role, text: u.text.trim(), ...(u.atMs !== undefined ? { atMs: u.atMs } : {}) });
  });
  return { turns, confidence: utterances.length ? decided / utterances.length : 0, method: 'content' };
}

/**
 * Classify a single live utterance's role from content + the previous role
 * (for turn-taking). Used by the live mic when the operator hasn't tagged the
 * speaker. Returns the inferred role and whether it was confident.
 */
export function classifyLiveUtterance(text: string, prevRole: Role | null): { role: Role; confident: boolean } {
  const lean = roleLean(text);
  if (lean > 0) return { role: 'rep', confident: true };
  if (lean < 0) return { role: 'prospect', confident: true };
  if (prevRole) return { role: prevRole === 'rep' ? 'prospect' : 'rep', confident: false };
  return { role: 'rep', confident: false };
}
