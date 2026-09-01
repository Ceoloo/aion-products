/**
 * Objection Intelligence (Live responsibility #4).
 *
 * Not keyword → canned response. An objection is interpreted into an underlying
 * concern, cross-referenced with the playbook, and tracked through a lifecycle
 * (open → addressed → resolved). The SAME surface ("rates are too high") can map
 * to very different concerns, which is why interpretation matters.
 */

import type { Core } from '../core/core.ts';
import type { AiTask } from '../core/task.ts';
import type { Turn } from '../domain/types.ts';
import type { Objection, ObjectionCategory } from '../domain/deal.ts';
import type { ObjectionPlaybookEntry } from '../config/schema.ts';
import { clampConfidence } from '../domain/types.ts';
import { containsAny, extractJson, normalize } from './lib/text.ts';
import { renderTurns } from './lib/render.ts';

export interface ObjectionInput {
  turns: Turn[];
  existing: Objection[];
  playbook: ObjectionPlaybookEntry[];
  turnIndex: number;
}

let oid = 0;
const nid = () => `obj_${(oid += 1)}`;

const ACCEPT_CUES = ['makes sense', 'fair enough', 'got it', 'that helps', 'okay good', "that's reasonable", 'good to know', 'appreciate that', 'that works', 'fair point', 'i can see that'];

export function playbookFor(playbook: ObjectionPlaybookEntry[], category: ObjectionCategory): ObjectionPlaybookEntry | undefined {
  return playbook.find((p) => p.category === category);
}

export function matchPlaybook(text: string, playbook: ObjectionPlaybookEntry[]): ObjectionPlaybookEntry | null {
  const n = normalize(text);
  for (const entry of playbook) {
    if (containsAny(n, entry.cues)) return entry;
  }
  return null;
}

const classify = matchPlaybook;

function deterministicObjections(input: ObjectionInput): Objection[] {
  const result: Objection[] = input.existing.map((o) => ({ ...o }));

  for (const turn of input.turns) {
    const n = normalize(turn.text);
    if (turn.speaker === 'prospect') {
      const entry = classify(turn.text, input.playbook);
      if (entry) {
        // Reinforce an existing open objection of the same category, or open a new one.
        const open = result.find((o) => o.category === entry.category && o.status !== 'resolved');
        if (open) {
          open.lastSeenTurn = turn.index;
          open.evidence.push({ turnIndex: turn.index, quote: turn.text });
          open.confidence = clampConfidence(Math.max(open.confidence, 0.75));
        } else {
          result.push({
            id: nid(),
            surface: turn.text.trim(),
            category: entry.category,
            underlyingConcerns: entry.concerns,
            status: 'open',
            confidence: 0.75,
            firstSeenTurn: turn.index,
            lastSeenTurn: turn.index,
            evidence: [{ turnIndex: turn.index, quote: turn.text }],
          });
        }
      }
      // Prospect acceptance resolves the most recently addressed objection.
      if (containsAny(n, ACCEPT_CUES)) {
        const addressed = [...result].reverse().find((o) => o.status === 'addressed');
        if (addressed) addressed.status = 'resolved';
      }
    } else if (turn.speaker === 'rep') {
      // A rep turn that engages an open objection's territory marks it addressed.
      for (const o of result) {
        if (o.status !== 'open') continue;
        const entry = playbookFor(input.playbook, o.category);
        const cues = entry ? entry.cues : [];
        if (containsAny(n, cues) || containsAny(n, ['understand', 'makes sense', 'let me explain', "here's why", 'good question', 'the reason'])) {
          o.status = 'addressed';
          o.lastSeenTurn = turn.index;
        }
      }
    }
  }
  return result;
}

export function objectionTask(input: ObjectionInput): AiTask<ObjectionInput, Objection[]> {
  return {
    engine: 'objection',
    kind: 'interpret_objections',
    input,
    turnIndex: input.turnIndex,
    buildPrompt: (inp) => {
      const cats = inp.playbook.map((p) => `${p.category} (may mean: ${p.concerns.join(', ')})`).join('\n');
      const existing = inp.existing.map((o) => `- ${o.id} [${o.category}/${o.status}] "${o.surface}"`).join('\n') || '(none)';
      return {
        system:
          'You are the objection-intelligence module. Interpret objections into underlying concerns; do not keyword-match. ' +
          'Also update the lifecycle of existing objections (open → addressed once the rep engages it → resolved once the prospect accepts). ' +
          'Return STRICT JSON: an array of objections {id (reuse existing id if updating, else "new"), surface, category, underlying_concerns:[...], status:"open|addressed|resolved", confidence, first_seen_turn, last_seen_turn}. JSON only.',
        user:
          `Objection categories for this business:\n${cats}\n\nExisting objections:\n${existing}\n\nConversation window:\n${renderTurns(inp.turns)}`,
      };
    },
    parse: (raw) => {
      const arr = extractJson(raw) as any[];
      if (!Array.isArray(arr)) return input.existing;
      return arr.map((x: any) => ({
        id: x?.id && x.id !== 'new' ? String(x.id) : nid(),
        surface: String(x?.surface ?? ''),
        category: (x?.category ?? 'other') as ObjectionCategory,
        underlyingConcerns: Array.isArray(x?.underlying_concerns) ? x.underlying_concerns.map(String) : [],
        status: (['open', 'addressed', 'resolved'].includes(x?.status) ? x.status : 'open') as Objection['status'],
        confidence: clampConfidence(Number(x?.confidence ?? 0.7)),
        firstSeenTurn: Number(x?.first_seen_turn ?? input.turnIndex),
        lastSeenTurn: Number(x?.last_seen_turn ?? input.turnIndex),
        evidence: [{ turnIndex: Number(x?.last_seen_turn ?? input.turnIndex), quote: String(x?.surface ?? '') }],
      }));
    },
    deterministic: deterministicObjections,
    summarizeInput: (inp) => `${inp.turns.length} turns, ${inp.existing.length} existing`,
    summarizeOutput: (out) => `${out.length} objection(s): ${out.map((o) => `${o.category}/${o.status}`).join(',') || 'none'}`,
  };
}

export async function runObjections(core: Core, input: ObjectionInput): Promise<Objection[]> {
  const { output } = await core.run(objectionTask(input));
  return output;
}
