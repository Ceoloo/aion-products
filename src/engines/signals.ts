/**
 * Buying-signal and commitment detection (part of Live responsibility #1).
 * Kept separate from fact extraction because signals/commitments are events,
 * not slot values, and feed readiness + next-best-action differently.
 */

import type { AiExecutor } from '../platform/ai-execution.ts';
import type { AiTask } from '../platform/revenue-ai-tasks.ts';
import type { Turn } from '../domain/types.ts';
import type { BuyingSignal, Commitment } from '../domain/deal.ts';
import { clampConfidence } from '../domain/types.ts';
import { containsAny, extractJson, normalize } from './lib/text.ts';
import { renderTurns } from './lib/render.ts';

export interface SignalsInput {
  turns: Turn[];
  turnIndex: number;
}

export interface SignalsResult {
  buyingSignals: BuyingSignal[];
  commitments: Commitment[];
}

let sid = 0;
const nid = (p: string) => `${p}_${(sid += 1)}`;

function deterministicSignals(input: SignalsInput): SignalsResult {
  const buyingSignals: BuyingSignal[] = [];
  const commitments: Commitment[] = [];

  for (const turn of input.turns) {
    if (turn.speaker !== 'prospect') continue;
    const n = normalize(turn.text);

    const termsCue = containsAny(n, ['what are the rates', 'how does repayment', "what's the process", 'how long does', 'what would the', 'how much would', 'what are the terms', 'how does it work']);
    if (termsCue) buyingSignals.push({ id: nid('sig'), kind: 'question_about_terms', surface: turn.text, confidence: 0.8, turnIndex: turn.index });

    const futureCue = containsAny(n, ['once we have', 'when we get', 'after we', 'that would let us', 'we could finally']);
    if (futureCue) buyingSignals.push({ id: nid('sig'), kind: 'future_pacing', surface: turn.text, confidence: 0.75, turnIndex: turn.index });

    const urgencyCue = containsAny(n, ['as soon as possible', 'asap', 'right away', 'this week', 'need it now', 'urgent']);
    if (urgencyCue) buyingSignals.push({ id: nid('sig'), kind: 'urgency_language', surface: turn.text, confidence: 0.7, turnIndex: turn.index });

    const proofCue = containsAny(n, ['do you have references', 'who else', 'other businesses like', 'case study', 'reviews']);
    if (proofCue) buyingSignals.push({ id: nid('sig'), kind: 'social_proof_request', surface: turn.text, confidence: 0.72, turnIndex: turn.index });

    const commitCue = containsAny(n, ["let's do it", 'sign me up', 'send me the', "let's schedule", "i'll get you", 'yes book', "let's move forward", 'go ahead and', 'sounds good send']);
    if (commitCue) {
      buyingSignals.push({ id: nid('sig'), kind: 'commitment_language', surface: turn.text, confidence: 0.85, turnIndex: turn.index });
      commitments.push({ id: nid('com'), description: turn.text.slice(0, 100), by: 'prospect', turnIndex: turn.index, confidence: 0.82 });
    }
  }
  return { buyingSignals, commitments };
}

export function signalsTask(input: SignalsInput): AiTask<SignalsInput, SignalsResult> {
  return {
    engine: 'signals',
    kind: 'detect_signals',
    input,
    turnIndex: input.turnIndex,
    buildPrompt: (inp) => ({
      system:
        'Detect buying signals and commitments in a sales conversation window. Return STRICT JSON ' +
        '{"buying_signals":[{"kind","surface","confidence","turn"}],"commitments":[{"description","by":"prospect|rep","turn","confidence"}]}. ' +
        'buying_signal kind ∈ [question_about_terms, future_pacing, urgency_language, budget_disclosure, social_proof_request, commitment_language, other]. ' +
        'Only include real signals. JSON only.',
      user: `Conversation window:\n${renderTurns(inp.turns)}`,
    }),
    parse: (raw) => {
      const d = extractJson(raw) as any;
      const bs: BuyingSignal[] = (Array.isArray(d?.buying_signals) ? d.buying_signals : []).map((x: any) => ({
        id: nid('sig'),
        kind: x?.kind ?? 'other',
        surface: String(x?.surface ?? ''),
        confidence: clampConfidence(Number(x?.confidence ?? 0.6)),
        turnIndex: Number(x?.turn ?? input.turnIndex),
      }));
      const cs: Commitment[] = (Array.isArray(d?.commitments) ? d.commitments : []).map((x: any) => ({
        id: nid('com'),
        description: String(x?.description ?? ''),
        by: x?.by === 'rep' ? 'rep' : 'prospect',
        turnIndex: Number(x?.turn ?? input.turnIndex),
        confidence: clampConfidence(Number(x?.confidence ?? 0.7)),
      }));
      return { buyingSignals: bs, commitments: cs };
    },
    deterministic: deterministicSignals,
    summarizeInput: (inp) => `${inp.turns.length} turns`,
    summarizeOutput: (out) => `${out.buyingSignals.length} signal(s), ${out.commitments.length} commitment(s)`,
  };
}

export async function runSignals(exec: AiExecutor, input: SignalsInput): Promise<SignalsResult> {
  const { output } = await exec.run(signalsTask(input));
  return output;
}
