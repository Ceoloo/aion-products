/**
 * Transcript ingestion adapter.
 *
 * Converts an external transcript (pasted text, or later a live speech stream)
 * into the `Turn[]` the domain already consumes. Because `LiveCopilot.ingest`
 * takes turns, transcription stays an ADAPTER and never becomes part of Revenue
 * Copilot's intelligence architecture.
 *
 * Speaker attribution, in order of preference:
 *   1. Explicit `Rep:` / `Prospect:` (and aliases) prefixes.
 *   2. Diarized channel labels (`Speaker 1:`, `Agent 2:`, a name) → roles are
 *      inferred by mapping channels to rep/lead from content.
 *   3. No labels at all → roles inferred per-utterance from content.
 */

import type { Turn } from '../domain/types.ts';
import { assignRoles, type RawUtterance } from './speaker-roles.ts';

const REP_ALIASES = ['rep', 'agent', 'me', 'sales', 'salesperson', 'closer', 'setter', 'caller'];
const PROSPECT_ALIASES = ['prospect', 'customer', 'client', 'them', 'lead', 'owner', 'buyer', 'contact'];

function classifyAlias(label: string): Turn['speaker'] | null {
  const l = label.trim().toLowerCase().replace(/[[\]()]/g, '');
  if (REP_ALIASES.includes(l)) return 'rep';
  if (PROSPECT_ALIASES.includes(l)) return 'prospect';
  return null;
}

export interface ParseOptions {
  /** speaker to attribute lines that have no recognized prefix. */
  defaultSpeaker?: Turn['speaker'];
  /** Force content-based role inference even if some explicit roles are present. */
  inferRoles?: boolean;
}

interface Segment {
  text: string;
  role?: Turn['speaker'];
  channel?: string;
}

/** Split a transcript into labeled/unlabeled segments (before role resolution). */
function segment(text: string): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  const push = () => {
    if (current && current.text.trim()) {
      current.text = current.text.trim();
      segments.push(current);
    }
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      push();
      continue;
    }
    // "Label:" or "Label -" where Label may be a role alias or a diarization tag.
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _.#[\]()-]{0,23}?)\s*[:\-–]\s*(.*)$/);
    if (m && m[2] !== undefined) {
      const label = m[1] ?? '';
      const role = classifyAlias(label);
      push();
      current = role ? { text: m[2], role } : { text: m[2], channel: label.trim().toLowerCase() };
    } else if (current && (current.role || current.channel)) {
      // Continuation of a labeled speaker's multi-line turn.
      current.text += ` ${line}`;
    } else {
      // Unlabeled line → its own utterance (so content inference works per line).
      push();
      current = { text: line };
    }
  }
  push();
  return segments;
}

/**
 * Parse a pasted transcript into ordered rep/prospect turns. Explicit
 * `Rep:` / `Prospect:` labels are honored as-is; otherwise roles are inferred
 * from diarization channels (`Speaker 1:` …) and/or content cues via
 * `assignRoles`. Pass `inferRoles` to force content inference even when some
 * lines are explicitly labeled.
 */
export function parseTranscript(text: string, opts: ParseOptions = {}): Turn[] {
  const segments = segment(text);
  const hasExplicitRoles = segments.some((s) => s.role);

  // Explicit Rep:/Prospect: labeling present → honor it (unless inference forced).
  if (hasExplicitRoles && !opts.inferRoles) {
    return segments.map((s, index) => ({
      index,
      speaker: s.role ?? opts.defaultSpeaker ?? 'prospect',
      text: s.text,
    }));
  }

  // Otherwise infer roles from diarization channels and/or content.
  const utterances: RawUtterance[] = segments.map((s) => (s.channel ? { text: s.text, channel: s.channel } : { text: s.text }));
  return assignRoles(utterances).turns;
}

/** Build a single live turn (e.g. from a mic finalization) with the next index. */
export function makeTurn(index: number, speaker: Turn['speaker'], text: string, atMs?: number): Turn {
  return atMs !== undefined ? { index, speaker, text: text.trim(), atMs } : { index, speaker, text: text.trim() };
}
