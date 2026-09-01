/**
 * Renderers that turn structured state into compact text for LLM prompts.
 */

import type { Turn } from '../../domain/types.ts';
import type { DealState } from '../../domain/deal.ts';
import type { PreCallContext } from '../../domain/context.ts';

export function renderTurns(turns: Turn[]): string {
  return turns
    .map((t) => `[#${t.index} ${t.speaker.toUpperCase()}] ${t.text}`)
    .join('\n');
}

export function renderStateBrief(state: DealState): string {
  const facts = Object.values(state.facts)
    .filter((f) => f && f.value !== null)
    .map((f) => `${f!.label}=${f!.value} (${Math.round(f!.confidence * 100)}%${f!.statedExplicitly ? '' : ', inferred'})`);
  const objections = state.objections
    .map((o) => `${o.category}:"${o.surface}"[${o.status}]`)
    .join('; ');
  return [
    `conversation_stage=${state.conversationStage}`,
    `sentiment=${state.sentiment}`,
    `urgency=${state.urgency}`,
    facts.length ? `facts: ${facts.join(' | ')}` : 'facts: (none yet)',
    objections ? `objections: ${objections}` : 'objections: (none)',
    `commitments: ${state.commitments.length}`,
    `buying_signals: ${state.buyingSignals.length}`,
  ].join('\n');
}

export function renderContextBrief(ctx: PreCallContext): string {
  return [
    `prospect: ${ctx.prospect.name}${ctx.prospect.role ? `, ${ctx.prospect.role}` : ''}`,
    `company: ${ctx.company.name}${ctx.company.industry ? ` (${ctx.company.industry})` : ''}`,
    `offer: ${ctx.offer.name} — ${ctx.offer.summary}`,
    ctx.offer.constraints.length ? `offer_constraints: ${ctx.offer.constraints.join('; ')}` : '',
    ctx.priorObjections.length ? `prior_objections: ${ctx.priorObjections.join('; ')}` : '',
    ctx.outstandingQuestions.length ? `open_questions: ${ctx.outstandingQuestions.join('; ')}` : '',
    `stage_now=${ctx.conversionStageId} desired_next=${ctx.desiredNextStageId}`,
  ]
    .filter(Boolean)
    .join('\n');
}
