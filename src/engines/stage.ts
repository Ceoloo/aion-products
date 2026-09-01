/**
 * Conversation-state detection (Live responsibility #2) + sentiment read.
 *
 * Reports where the *conversation* currently is (opening → closing) and the
 * prospect's emotional read. This is distinct from the deal's ladder position.
 */

import type { Core } from '../core/core.ts';
import type { AiTask } from '../core/task.ts';
import type { ConversationStage, Sentiment, Turn } from '../domain/types.ts';
import { CONVERSATION_STAGES } from '../domain/types.ts';
import { containsAny, extractJson, normalize } from './lib/text.ts';
import { renderTurns } from './lib/render.ts';

export interface StageInput {
  turns: Turn[];
  priorStage: ConversationStage;
  hasOpenObjection: boolean;
  turnIndex: number;
}

export interface StageResult {
  conversationStage: ConversationStage;
  sentiment: Sentiment;
}

function detectSentiment(turns: Turn[]): Sentiment {
  const recent = turns.filter((t) => t.speaker === 'prospect').slice(-3);
  const text = normalize(recent.map((t) => t.text).join(' '));
  if (!text) return 'unknown';
  if (containsAny(text, ['not interested', 'stop calling', 'waste of time', 'scam', 'remove me'])) return 'hostile';
  if (containsAny(text, ['love that', "let's do it", 'sounds great', 'perfect', 'sign me up', 'excited', 'exactly what'])) return 'enthusiastic';
  if (containsAny(text, ['interested', 'tell me more', 'that could work', 'makes sense', 'i like', 'go on'])) return 'interested';
  if (containsAny(text, ['not sure', 'skeptical', "don't know", 'concerned', 'worried', 'hesitant', 'too high', 'expensive'])) return 'cautious';
  if (containsAny(text, ['prove', 'who are you', 'never heard', "doesn't sound", 'doubt'])) return 'skeptical';
  return 'neutral';
}

function detectStage(input: StageInput): ConversationStage {
  const all = normalize(input.turns.map((t) => t.text).join(' '));
  const last = normalize([...input.turns].reverse().find(() => true)?.text ?? '');
  if (input.hasOpenObjection) return 'objection';
  if (containsAny(last, ['sign', 'get started', 'send the', 'application', 'schedule', 'book', 'next step', 'move forward'])) return 'commitment';
  if (containsAny(all, ['rate', 'price', 'terms', 'how much', 'payment', 'cost'])) return 'negotiation';
  if (containsAny(all, ['our product', 'what we do', 'we offer', 'we can', 'the way it works', 'we provide'])) return 'solution_positioning';
  if (containsAny(all, ['problem', 'costing', 'losing', 'impact', 'because of that', 'struggling'])) return 'problem_development';
  if (containsAny(all, ['how long', 'revenue', 'how much do you', 'who makes', 'do you currently'])) return 'qualification';
  if (input.turns.length <= 3 || containsAny(all, ['how are you', 'reaching out', 'calling about', 'good morning', 'this is'])) return 'opening';
  return 'discovery';
}

function deterministicStage(input: StageInput): StageResult {
  return {
    conversationStage: detectStage(input),
    sentiment: detectSentiment(input.turns),
  };
}

export function stageTask(input: StageInput): AiTask<StageInput, StageResult> {
  return {
    engine: 'stage',
    kind: 'detect_stage',
    input,
    turnIndex: input.turnIndex,
    buildPrompt: (inp) => ({
      system:
        'You track the state of a live sales conversation. Given the window, return STRICT JSON ' +
        `{"conversation_stage": one of [${CONVERSATION_STAGES.join(', ')}], ` +
        '"sentiment": one of [hostile, skeptical, cautious, neutral, interested, enthusiastic]}. JSON only.',
      user: `Conversation window:\n${renderTurns(inp.turns)}\n\nPrior stage: ${inp.priorStage}. Open objection: ${inp.hasOpenObjection}.`,
    }),
    parse: (raw) => {
      const d = extractJson(raw) as any;
      const cs = String(d?.conversation_stage ?? d?.conversationStage ?? '') as ConversationStage;
      const st = String(d?.sentiment ?? 'unknown') as Sentiment;
      return {
        conversationStage: (CONVERSATION_STAGES as string[]).includes(cs) ? cs : input.priorStage,
        sentiment: st,
      };
    },
    deterministic: deterministicStage,
    summarizeInput: (inp) => `${inp.turns.length} turns, prior=${inp.priorStage}`,
    summarizeOutput: (out) => `${out.conversationStage} / ${out.sentiment}`,
  };
}

export async function runStage(core: Core, input: StageInput): Promise<StageResult> {
  const { output } = await core.run(stageTask(input));
  return output;
}
