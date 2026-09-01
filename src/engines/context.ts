/**
 * Context Engine (Before the call).
 *
 * Assembles the pre-call context package and answers: "What does the rep need
 * to know before talking to this person?" Produces a briefing that seeds the
 * live state.
 */

import type { AiExecutor } from '../platform/ai-execution.ts';
import type { AiTask } from '../platform/revenue-ai-tasks.ts';
import type { PreCallContext } from '../domain/context.ts';
import { extractJson } from './lib/text.ts';
import { renderContextBrief } from './lib/render.ts';

/** All the raw inputs the Context Engine needs (briefing excluded — it generates that). */
export type ContextInput = Omit<PreCallContext, 'briefing'>;

function deterministicBriefing(input: ContextInput): string {
  const lines: string[] = [];
  lines.push(`${input.prospect.name}${input.prospect.role ? ` (${input.prospect.role})` : ''} at ${input.company.name}.`);
  if (input.company.industry) lines.push(`Industry: ${input.company.industry}.`);
  lines.push(`Offer on the table: ${input.offer.name}.`);
  if (input.priorConversations.length) {
    const last = input.priorConversations[input.priorConversations.length - 1]!;
    lines.push(`Last touch (${last.date}, ${last.channel}): ${last.summary}`);
  }
  if (input.priorObjections.length) lines.push(`Watch for prior objections: ${input.priorObjections.join('; ')}.`);
  if (input.outstandingQuestions.length) lines.push(`Open questions to resolve: ${input.outstandingQuestions.join('; ')}.`);
  lines.push(`Goal this call: move from "${input.conversionStageId}" to "${input.desiredNextStageId}".`);
  const focus = input.priorObjections.length
    ? 'Lead by acknowledging the prior concern, then develop impact before pricing.'
    : 'Open with discovery: confirm need, authority, and the cost of the status quo before positioning.';
  lines.push(`Recommended focus: ${focus}`);
  return lines.join(' ');
}

export function contextTask(input: ContextInput): AiTask<ContextInput, string> {
  return {
    engine: 'context',
    kind: 'precall_briefing',
    input,
    turnIndex: -1,
    buildPrompt: (inp) => ({
      system:
        'You brief a sales rep before a call. In 4-6 sentences, tell them exactly what they need to know: who this is, ' +
        'the state of the deal, prior objections to expect, the open questions, and the single most important focus to advance the deal. ' +
        'Return STRICT JSON {"briefing": "..."}. JSON only.',
      user: renderContextBrief({ ...inp, briefing: '' }),
    }),
    parse: (raw) => {
      const d = extractJson(raw) as any;
      const b = d?.briefing ?? d?.text;
      if (typeof b === 'string' && b.trim()) return b.trim();
      throw new Error('no briefing in model output');
    },
    deterministic: deterministicBriefing,
    summarizeInput: (inp) => `${inp.prospect.name} @ ${inp.company.name}`,
    summarizeOutput: (out) => `${out.length} char briefing`,
  };
}

export async function assembleContext(exec: AiExecutor, input: ContextInput): Promise<PreCallContext> {
  const { output: briefing } = await exec.run(contextTask(input));
  return { ...input, briefing };
}
