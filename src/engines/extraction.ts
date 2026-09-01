/**
 * Information Extraction engine (Live responsibility #1).
 *
 * Turns unstructured conversation into structured fact slots. Runs through the
 * Core so both the LLM path and the deterministic heuristic path are governed
 * and traced, and so their output shape is identical.
 */

import type { Core } from '../core/core.ts';
import type { AiTask } from '../core/task.ts';
import type { Turn } from '../domain/types.ts';
import type { FactKey, FactMap, FactSlot } from '../domain/facts.ts';
import { FACT_LABELS } from '../domain/facts.ts';
import { clampConfidence } from '../domain/types.ts';
import { containsAny, extractJson, extractMoney, extractMoneyRange, extractYears, normalize } from './lib/text.ts';
import { renderTurns } from './lib/render.ts';

export interface FactUpdate {
  key: FactKey;
  value: string;
  confidence: number;
  statedExplicitly: boolean;
  evidenceTurn: number;
  quote: string;
}

export interface ExtractionInput {
  turns: Turn[];
  factSlots: FactKey[];
  existing: FactMap;
  turnIndex: number;
}

const FACT_GUIDE: Record<FactKey, string> = {
  revenue: 'monthly or annual revenue / sales volume',
  time_in_business: 'how long the business has operated',
  industry: 'the industry or type of business',
  need: 'what the prospect needs or is trying to accomplish',
  pain: 'the problem / pain driving the need',
  business_impact: 'the quantified business consequence of the pain (money, opportunity lost)',
  urgency: 'how soon they need it (e.g. "within 30 days", "no rush")',
  capital_amount: 'how much capital / money is being sought',
  budget: 'budget available for a purchase',
  decision_authority: 'whether this person can decide (owner / needs a partner / etc.)',
  existing_solution: 'current provider or solution in place',
  existing_obligations: 'current debts / obligations / other financing',
  timeline: 'the timeline for the project or decision',
  use_of_funds: 'what the capital will be used for',
  credit_posture: 'credit quality / history signals',
};

// ---------------------------------------------------------------------------
// Deterministic extraction (offline baseline + fallback)
// ---------------------------------------------------------------------------

function detectFact(key: FactKey, turn: Turn): FactUpdate | null {
  if (turn.speaker !== 'prospect') return null;
  const t = turn.text;
  const n = normalize(t);
  const mk = (value: string, confidence: number, explicit = true): FactUpdate => ({
    key,
    value,
    confidence: clampConfidence(confidence),
    statedExplicitly: explicit,
    evidenceTurn: turn.index,
    quote: t,
  });

  switch (key) {
    case 'revenue': {
      if (containsAny(n, ['revenue', 'we do', 'we bring in', 'we make', 'a month', 'per month', 'monthly', 'a year', 'annually', 'sales', 'gross'])) {
        const money = extractMoney(t);
        if (money) {
          const monthly = containsAny(n, ['a month', 'per month', 'monthly']);
          return mk(monthly ? `${money}/mo` : money, 0.9);
        }
      }
      return null;
    }
    case 'time_in_business': {
      if (containsAny(n, ['in business', 'been doing', 'been running', 'been open', 'started', 'operating', 'years'])) {
        const yrs = extractYears(t);
        if (yrs) return mk(yrs, 0.88);
      }
      return null;
    }
    case 'industry': {
      const m = n.match(/\b(?:we're|we are|i run|we run|it's|its) (?:a |an )?([a-z][a-z ]{2,30}?) (?:business|company|shop|store|contractor|firm|practice)\b/);
      const captured = m?.[1]?.trim();
      if (captured && !['the', 'a', 'an', 'my', 'our'].includes(captured)) return mk(captured, 0.75);
      return null;
    }
    case 'capital_amount': {
      if (containsAny(n, ['need', 'looking for', 'want', 'could use', 'trying to get', 'capital', 'loan', 'financing', 'funding'])) {
        const range = extractMoneyRange(t);
        if (range) return mk(range, 0.85);
      }
      return null;
    }
    case 'budget': {
      if (containsAny(n, ['budget', 'spend', 'afford', 'set aside', 'willing to pay'])) {
        const range = extractMoneyRange(t);
        if (range) return mk(range, 0.82);
      }
      return null;
    }
    case 'urgency': {
      const cue = containsAny(n, ['asap', 'immediately', 'right away', 'this week', 'today', 'urgent', 'yesterday', '30 days', 'this month', 'soon', 'next month', 'this quarter', 'couple months', '60 days', '90 days', 'no rush', 'just looking', 'exploring', 'eventually', 'sometime']);
      if (cue) return mk(cue, 0.8);
      return null;
    }
    case 'decision_authority': {
      if (containsAny(n, ['i own', "i'm the owner", 'my company', 'my business', 'i decide', 'i make the'])) return mk('owner / decision maker', 0.85);
      if (containsAny(n, ['my partner', 'talk to my', 'run it by', 'not my call', "isn't my decision", 'my wife', 'my husband', 'the board'])) return mk('needs another stakeholder', 0.8);
      return null;
    }
    case 'existing_solution': {
      if (containsAny(n, ['currently use', 'we use', 'already have', 'working with', 'our current'])) return mk(t.slice(0, 80), 0.7, true);
      return null;
    }
    case 'existing_obligations': {
      if (containsAny(n, ['already owe', 'have a loan', 'other financing', 'existing debt', 'monthly payment', 'paying off'])) {
        const money = extractMoney(t);
        return mk(money ? `obligation ${money}` : t.slice(0, 80), 0.72);
      }
      return null;
    }
    case 'timeline': {
      if (containsAny(n, ['by the', 'before', 'by next', 'deadline', 'end of', 'within'])) return mk(t.slice(0, 80), 0.68, true);
      return null;
    }
    case 'use_of_funds': {
      if (containsAny(n, ['use it for', 'use the money', 'need it for', 'to buy', 'to purchase', 'to hire', 'inventory', 'equipment', 'expansion', 'payroll', 'renovat'])) return mk(t.slice(0, 90), 0.75);
      return null;
    }
    case 'pain': {
      if (containsAny(n, ['problem', 'struggling', 'losing', 'cash flow', 'behind', "can't keep up", 'missing out', 'hard to', 'frustrat', 'bleeding', 'bleeding', 'stuck'])) return mk(t.slice(0, 100), 0.72, true);
      return null;
    }
    case 'need': {
      if (containsAny(n, ['i need', 'we need', 'trying to', 'want to', 'looking to', 'hoping to'])) return mk(t.slice(0, 100), 0.7, true);
      return null;
    }
    case 'business_impact': {
      if (containsAny(n, ['costing', 'losing', 'lost ', "can't take on", 'turned down', 'turned away', 'turning away', 'missed', 'walked away', 'leaving money', 'opportunity cost'])) {
        const money = extractMoney(t);
        return mk(money ? `impact ${money}` : t.slice(0, 100), money ? 0.85 : 0.6, true);
      }
      return null;
    }
    case 'credit_posture': {
      if (containsAny(n, ['credit score', 'my credit', 'fico', 'bad credit', 'good credit', 'bankruptcy'])) return mk(t.slice(0, 60), 0.7);
      return null;
    }
    default:
      return null;
  }
}

function deterministicExtract(input: ExtractionInput): FactUpdate[] {
  const updates: FactUpdate[] = [];
  const seen = new Set<FactKey>();
  // Scan newest-first so the freshest statement wins for each slot this window.
  for (let i = input.turns.length - 1; i >= 0; i--) {
    const turn = input.turns[i]!;
    for (const key of input.factSlots) {
      if (seen.has(key)) continue;
      const upd = detectFact(key, turn);
      if (upd) {
        updates.push(upd);
        seen.add(key);
      }
    }
  }
  return updates;
}

// ---------------------------------------------------------------------------
// LLM task
// ---------------------------------------------------------------------------

function parseUpdates(raw: string, allowed: FactKey[]): FactUpdate[] {
  const data = extractJson(raw) as unknown;
  const arr = Array.isArray(data) ? data : (data as any)?.facts;
  if (!Array.isArray(arr)) return [];
  const allowSet = new Set(allowed);
  const out: FactUpdate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const key = (item as any).key as FactKey;
    const value = (item as any).value;
    if (!allowSet.has(key) || value === null || value === undefined || value === '') continue;
    out.push({
      key,
      value: String(value),
      confidence: clampConfidence(Number((item as any).confidence ?? 0.7)),
      statedExplicitly: Boolean((item as any).stated_explicitly ?? (item as any).statedExplicitly ?? false),
      evidenceTurn: Number((item as any).evidence_turn ?? (item as any).evidenceTurn ?? -1),
      quote: String((item as any).quote ?? ''),
    });
  }
  return out;
}

export function extractionTask(input: ExtractionInput): AiTask<ExtractionInput, FactUpdate[]> {
  return {
    engine: 'extraction',
    kind: 'extract_facts',
    input,
    turnIndex: input.turnIndex,
    buildPrompt: (inp) => {
      const guide = inp.factSlots.map((k) => `- ${k}: ${FACT_GUIDE[k]}`).join('\n');
      return {
        system:
          'You are the information-extraction module of a live sales copilot. ' +
          'From the conversation window, extract only facts that are actually present. ' +
          'Return STRICT JSON: an array of objects with keys ' +
          '{key, value, confidence (0..1), stated_explicitly (bool), evidence_turn (int), quote}. ' +
          'Set stated_explicitly=true only when the prospect said it plainly (not inferred). ' +
          'Do not invent facts. Return [] if nothing new is present. No prose, JSON only.',
        user:
          `Allowed fact keys:\n${guide}\n\n` +
          `Conversation window:\n${renderTurns(inp.turns)}\n\n` +
          `Return the JSON array now.`,
      };
    },
    parse: (raw) => parseUpdates(raw, input.factSlots),
    deterministic: deterministicExtract,
    summarizeInput: (inp) => `${inp.turns.length} turns, ${inp.factSlots.length} slots`,
    summarizeOutput: (out) => `${out.length} fact update(s): ${out.map((u) => u.key).join(',') || 'none'}`,
  };
}

export async function runExtraction(core: Core, input: ExtractionInput): Promise<FactUpdate[]> {
  const { output } = await core.run(extractionTask(input));
  return output;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Apply fact updates to a fact map. A new observation overwrites an existing
 * slot only when it is at least as confident, preserving evidence history.
 */
export function applyFactUpdates(facts: FactMap, updates: FactUpdate[], atTurn: number): FactMap {
  const next: FactMap = { ...facts };
  for (const u of updates) {
    const prev = next[u.key];
    const evidence = [...(prev?.evidence ?? []), { turnIndex: u.evidenceTurn, quote: u.quote }].filter((e) => e.turnIndex >= 0);
    if (!prev || prev.value === null || u.confidence > prev.confidence) {
      const slot: FactSlot = {
        key: u.key,
        label: FACT_LABELS[u.key],
        value: u.value,
        confidence: u.confidence,
        statedExplicitly: u.statedExplicitly || (prev?.statedExplicitly ?? false),
        evidence,
        updatedAtTurn: atTurn,
      };
      next[u.key] = slot;
    } else if (prev) {
      next[u.key] = { ...prev, evidence };
    }
  }
  return next;
}
