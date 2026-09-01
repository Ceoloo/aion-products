/**
 * Transcript ingestion adapter.
 *
 * Converts an external transcript (pasted text, or later a live speech stream)
 * into the `Turn[]` the domain already consumes. Because `LiveCopilot.ingest`
 * takes turns, transcription stays an ADAPTER and never becomes part of Revenue
 * Copilot's intelligence architecture.
 */

import type { Turn } from '../domain/types.ts';

const REP_ALIASES = ['rep', 'agent', 'me', 'sales', 'salesperson', 'closer', 'setter', 'caller'];
const PROSPECT_ALIASES = ['prospect', 'customer', 'client', 'them', 'lead', 'owner', 'buyer', 'contact'];

function classifySpeaker(label: string): Turn['speaker'] | null {
  const l = label.trim().toLowerCase().replace(/[[\]()]/g, '');
  if (REP_ALIASES.includes(l)) return 'rep';
  if (PROSPECT_ALIASES.includes(l)) return 'prospect';
  return null;
}

export interface ParseOptions {
  /** speaker to attribute lines that have no recognized prefix. */
  defaultSpeaker?: Turn['speaker'];
}

/**
 * Parse a pasted transcript. Lines may be prefixed with a speaker label
 * ("Rep:", "Prospect:", "Agent -", "[Customer]", …). A line without a
 * recognized prefix continues the previous speaker's turn.
 */
export function parseTranscript(text: string, opts: ParseOptions = {}): Turn[] {
  const turns: Turn[] = [];
  let index = 0;
  let current: Turn | null = null;

  const pushCurrent = () => {
    if (current && current.text.trim().length > 0) {
      current.text = current.text.trim();
      turns.push(current);
    }
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      // Blank line ends the current turn.
      pushCurrent();
      continue;
    }

    // Match "Label:" or "Label -" prefix (label = up to ~24 chars, no colon inside).
    const m = line.match(/^([A-Za-z[\]()][A-Za-z \][()]{0,23}?)\s*[:\-–]\s*(.*)$/);
    const speaker = m ? classifySpeaker(m[1] ?? '') : null;

    if (speaker) {
      pushCurrent();
      current = { index: index++, speaker, text: m![2] ?? '' };
    } else if (current) {
      current.text += ` ${line}`;
    } else {
      // No prefix yet and no open turn → attribute to the default speaker.
      current = { index: index++, speaker: opts.defaultSpeaker ?? 'prospect', text: line };
    }
  }
  pushCurrent();
  return turns;
}

/** Build a single live turn (e.g. from a mic finalization) with the next index. */
export function makeTurn(index: number, speaker: Turn['speaker'], text: string, atMs?: number): Turn {
  return atMs !== undefined ? { index, speaker, text: text.trim(), atMs } : { index, speaker, text: text.trim() };
}
