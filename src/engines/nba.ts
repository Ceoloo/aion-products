/**
 * Next-Best-Action (Live responsibility #5).
 *
 * Continually answers: what should the rep do next to maximize the probability
 * of conversion? The deterministic policy encodes real sales judgment — most
 * notably the mission's signature move: when a pricing objection lands before
 * urgency/impact is established, return to impact questions rather than
 * defending price.
 */

import type { AiExecutor } from '../platform/ai-execution.ts';
import type { AiTask } from '../platform/revenue-ai-tasks.ts';
import type { DealState, Gap } from '../domain/deal.ts';
import type { PreCallContext } from '../domain/context.ts';
import type { SalesSchema } from '../config/schema.ts';
import type { Recommendation } from '../domain/recommendation.ts';
import { makeRecommendation } from '../domain/recommendation.ts';
import { factKnown, hasCommitment, objectionsByCategory, unresolvedObjections, urgencyConfirmed } from '../domain/predicates.ts';
import { playbookFor } from './objection.ts';
import { extractJson } from './lib/text.ts';
import { renderContextBrief, renderStateBrief } from './lib/render.ts';

export interface NbaInput {
  state: DealState;
  gaps: Gap[];
  schema: SalesSchema;
  context: PreCallContext;
  turnIndex: number;
}

let rid = 0;
const nid = () => `rec_${(rid += 1)}`;

const IMPACT_QUESTION = 'Before we get to pricing — when this problem hits, what is it costing you in a typical month?';
const URGENCY_QUESTION = 'How soon does this need to be solved for it to actually matter to you?';

const FACT_QUESTION: Partial<Record<string, string>> = {
  revenue: 'Roughly what does the business do in revenue each month?',
  time_in_business: 'How long have you been in business?',
  decision_authority: 'Are you the one who makes this call, or is someone else involved?',
  need: 'What are you really trying to accomplish here?',
  pain: 'What is driving the need to look at this now?',
  business_impact: IMPACT_QUESTION,
  urgency: URGENCY_QUESTION,
  capital_amount: 'How much capital would actually move the needle for you?',
  budget: 'What kind of budget were you thinking for this?',
  use_of_funds: 'What would you put the capital toward first?',
  timeline: 'What is the timeline you are working against?',
};

function deterministicNba(input: NbaInput): Recommendation[] {
  const { state, gaps, schema, context } = input;
  const recs: Recommendation[] = [];
  const turn = input.turnIndex;

  const priceObjections = objectionsByCategory(state, 'price').filter((o) => o.status !== 'resolved');
  const openObjections = unresolvedObjections(state);

  // (A) Signature rule: price objection before urgency/impact → return to impact.
  if (priceObjections.length > 0 && (!urgencyConfirmed(state) || !factKnown(state, 'business_impact'))) {
    recs.push(makeRecommendation({
      id: nid(),
      type: 'quantify_impact',
      title: 'Return to impact before pricing',
      rationale: 'A pricing concern surfaced before urgency/impact was established. Reps who return to impact here convert more than those who defend price.',
      suggestedUtterance: IMPACT_QUESTION,
      priority: 0.95,
      addressesGapIds: gaps.filter((g) => g.kind === 'sequence').map((g) => g.id),
      addressesObjectionId: priceObjections[0]!.id,
      createdAtTurn: turn,
    }));
  }

  // (B) Other open objections → address with the playbook strategy.
  for (const o of openObjections) {
    if (o.category === 'price' && recs.some((r) => r.type === 'quantify_impact')) continue;
    const entry = playbookFor(schema.objectionPlaybook, o.category);
    recs.push(makeRecommendation({
      id: nid(),
      type: 'address_objection',
      title: `Address ${o.category} objection`,
      rationale: `Objection "${o.surface}" is ${o.status}. Likely concern: ${o.underlyingConcerns.slice(0, 2).join(' or ') || 'unclear'}. ${entry?.responseStrategy ?? ''}`.trim(),
      suggestedUtterance: entry?.responseStrategy,
      priority: o.status === 'open' ? 0.9 : 0.6,
      addressesObjectionId: o.id,
      createdAtTurn: turn,
    }));
  }

  // (C) Blocking gate facts → ask the question that fills them.
  for (const g of gaps.filter((g) => g.kind === 'missing_fact' && g.severity === 'block')) {
    const factKey = /establish (.+)\.$/.exec(g.message)?.[1];
    const question = pickQuestionFor(g.message);
    recs.push(makeRecommendation({
      id: nid(),
      type: 'ask_question',
      title: `Fill gap: ${factKey ?? 'missing qualification'}`,
      rationale: g.message,
      suggestedUtterance: question,
      priority: 0.8,
      addressesGapIds: [g.id],
      createdAtTurn: turn,
    }));
  }

  // (D) Sequence gaps (closing without foundation).
  for (const g of gaps.filter((g) => g.kind === 'sequence' && g.severity === 'warn')) {
    recs.push(makeRecommendation({
      id: nid(),
      type: g.message.includes('urgency') ? 'ask_question' : 'quantify_impact',
      title: 'Rebuild foundation before advancing',
      rationale: g.message,
      suggestedUtterance: g.message.includes('urgency') ? URGENCY_QUESTION : IMPACT_QUESTION,
      priority: 0.72,
      addressesGapIds: [g.id],
      createdAtTurn: turn,
    }));
  }

  // (E) Strong readiness, no blockers → drive to the next ladder rung.
  if (state.readiness.level === 'strong' || state.readiness.level === 'ready') {
    if (openObjections.length === 0) {
      const nextNoun = schema.terminology.conversionEventNoun;
      recs.push(makeRecommendation({
        id: nid(),
        type: hasCommitment(state) ? mapAdvanceAction(context.desiredNextStageId) : 'ask_commitment',
        title: hasCommitment(state) ? `Advance to ${nextNoun}` : 'Ask for commitment',
        rationale: `Readiness is ${state.readiness.level} with no open blockers. Move to the next step (${context.desiredNextStageId}).`,
        suggestedUtterance: hasCommitment(state)
          ? `Great — let's get the ${nextNoun} moving. I'll send what we need next.`
          : `It sounds like this is a strong fit. Are you open to taking the next step and moving on the ${nextNoun}?`,
        priority: 0.85,
        createdAtTurn: turn,
      }));
    }
  }

  // (F) Hostile/skeptical opening → build trust before anything else.
  if ((state.sentiment === 'hostile' || state.sentiment === 'skeptical') && recs.length === 0) {
    recs.push(makeRecommendation({
      id: nid(),
      type: 'reframe',
      title: 'De-escalate and reframe',
      rationale: `Prospect sentiment is ${state.sentiment}. Lead with credibility and a low-pressure reason to keep talking.`,
      suggestedUtterance: 'I get the skepticism — a lot of people call. Give me thirty seconds and if it is not relevant, I will let you go.',
      priority: 0.7,
      createdAtTurn: turn,
    }));
  }

  // (G) Nothing pressing → keep discovering (or stay silent if prospect is talking).
  if (recs.length === 0) {
    const nextFact = schema.factSlots.find((k) => !factKnown(state, k));
    recs.push(makeRecommendation({
      id: nid(),
      type: nextFact ? 'ask_question' : 'stay_silent',
      title: nextFact ? 'Continue discovery' : 'Let the prospect talk',
      rationale: nextFact ? `Still missing ${nextFact}. Keep developing the picture.` : 'Enough context for now — give the prospect room.',
      suggestedUtterance: nextFact ? (FACT_QUESTION[nextFact] ?? 'Tell me more about that.') : undefined,
      priority: 0.4,
      createdAtTurn: turn,
    }));
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

function pickQuestionFor(message: string): string | undefined {
  const lower = message.toLowerCase();
  for (const [key, q] of Object.entries(FACT_QUESTION)) {
    if (lower.includes(key.replace('_', ' ')) || lower.includes(key)) return q;
  }
  return 'Can you tell me a bit more about that?';
}

function mapAdvanceAction(desiredStageId: string): Recommendation['type'] {
  if (desiredStageId.includes('application')) return 'send_application';
  if (desiredStageId.includes('estimate') || desiredStageId.includes('appointment') || desiredStageId.includes('audit') || desiredStageId.includes('demo')) return 'schedule_follow_up';
  return 'ask_commitment';
}

export function nbaTask(input: NbaInput): AiTask<NbaInput, Recommendation[]> {
  return {
    engine: 'nba',
    kind: 'next_best_action',
    input,
    turnIndex: input.turnIndex,
    buildPrompt: (inp) => ({
      system:
        'You are the next-best-action engine of a live sales copilot. Given the deal state, gaps, and readiness, ' +
        'recommend the highest-leverage next moves for the rep. Action types: ask_question, stay_silent, clarify, reframe, ' +
        'quantify_impact, address_objection, explain_product, ask_commitment, schedule_follow_up, send_application, escalate, disqualify. ' +
        'IMPORTANT judgment: if a pricing objection surfaces before urgency/impact is established, return to impact questions rather than defending price. ' +
        'Return STRICT JSON array of {type, title, rationale, suggested_utterance, priority (0..1), addresses_objection_id?}. Max 4, ranked. JSON only.',
      user:
        `State:\n${renderStateBrief(inp.state)}\n\nReadiness: ${inp.state.readiness.level} (score ${inp.state.readiness.score}), primary blocker: ${inp.state.readiness.primaryBlocker ?? 'none'}\n\n` +
        `Gaps:\n${inp.gaps.map((g) => `- [${g.severity}] ${g.message}`).join('\n') || '(none)'}\n\n` +
        `Context:\n${renderContextBrief(inp.context)}`,
    }),
    parse: (raw) => {
      const arr = extractJson(raw) as any[];
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, 4).map((x: any) =>
        makeRecommendation({
          id: nid(),
          type: (x?.type ?? 'ask_question') as Recommendation['type'],
          title: String(x?.title ?? 'Next action'),
          rationale: String(x?.rationale ?? ''),
          suggestedUtterance: x?.suggested_utterance ? String(x.suggested_utterance) : undefined,
          priority: Number(x?.priority ?? 0.5),
          addressesObjectionId: x?.addresses_objection_id ? String(x.addresses_objection_id) : undefined,
          createdAtTurn: input.turnIndex,
        }),
      );
    },
    deterministic: deterministicNba,
    summarizeInput: (inp) => `readiness=${inp.state.readiness.level}, ${inp.gaps.length} gaps`,
    summarizeOutput: (out) => `${out.length} rec(s): ${out.map((r) => r.type).join(',') || 'none'}`,
  };
}

export async function runNba(exec: AiExecutor, input: NbaInput): Promise<Recommendation[]> {
  const { output } = await exec.run(nbaTask(input));
  return output;
}
