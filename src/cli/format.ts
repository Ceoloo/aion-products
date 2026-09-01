/**
 * Terminal formatting for the demo runner. Plain ASCII, no dependencies.
 */

import type { DealState, Gap } from '../domain/deal.ts';
import type { Recommendation } from '../domain/recommendation.ts';
import type { CallIntelligence } from '../domain/report.ts';

const BAR = '─'.repeat(72);

export function h1(text: string): string {
  return `\n${BAR}\n${text}\n${BAR}`;
}

export function liveState(state: DealState): string {
  const facts = Object.values(state.facts)
    .filter((f) => f && f.value !== null)
    .map((f) => `    ${f!.label.padEnd(28)} → ${f!.value}  [${Math.round(f!.confidence * 100)}%${f!.statedExplicitly ? '' : ', inferred'}]`);
  const readiness = state.readiness.signals
    .map((s) => `    ${symbol(s.state)} ${s.label}${s.detail ? ` (${s.detail})` : ''}`)
    .join('\n');
  const obj = state.objections.map((o) => `    [${o.status}] ${o.category}: "${o.surface}"`).join('\n');

  return [
    `  Conversation stage : ${state.conversationStage}`,
    `  Sentiment          : ${state.sentiment}    Urgency: ${state.urgency}`,
    `  Ladder position    : order ${state.position.currentOrder} (start ${state.position.startOrder}, peak ${state.position.highWaterOrder})`,
    `  Readiness          : ${state.readiness.level.toUpperCase()} (score ${state.readiness.score})  blocker: ${state.readiness.primaryBlocker ?? 'none'}`,
    facts.length ? `  Facts:\n${facts.join('\n')}` : '  Facts: (none yet)',
    obj ? `  Objections:\n${obj}` : '',
    readiness ? `  Readiness signals:\n${readiness}` : '',
  ].filter(Boolean).join('\n');
}

export function gapsBlock(gaps: Gap[]): string {
  if (!gaps.length) return '  Gaps: (none)';
  return `  Gaps:\n${gaps.map((g) => `    ! [${g.severity}] ${g.message}`).join('\n')}`;
}

export function recsBlock(recs: Recommendation[]): string {
  if (!recs.length) return '  Guidance: (none)';
  return `  Guidance:\n${recs
    .map((r, idx) => {
      const utter = r.suggestedUtterance ? `\n         ↳ "${r.suggestedUtterance}"` : '';
      return `    ${idx + 1}. [${r.type}] ${r.title}  (p=${r.priority.toFixed(2)})\n         ${r.rationale}${utter}`;
    })
    .join('\n')}`;
}

function symbol(state: string): string {
  if (state === 'confirmed') return '✓';
  if (state === 'partial') return '~';
  if (state === 'blocked') return '!';
  return '✗';
}

export function report(r: CallIntelligence): string {
  const lines: string[] = [];
  lines.push(h1('CALL INTELLIGENCE'));
  lines.push(`  Call        : ${r.callId}   Industry: ${r.industry}`);
  lines.push(`  Outcome     : ${r.outcome.stageBeforeId} → ${r.outcome.stageAfterId}  (advanced: ${r.outcome.advanced})`);
  lines.push(`  Meaningful  : ${r.outcome.reachedMeaningfulConversion ? `yes (${r.outcome.meaningfulConversionId})` : 'no'}`);

  lines.push('\n  QUALIFICATION');
  for (const f of Object.values(r.qualification.facts)) {
    if (f && f.value !== null) lines.push(`    ${f.label.padEnd(28)} → ${f.value}`);
  }
  lines.push(`    CRM-writable facts (governed): ${r.qualification.crmWritable.join(', ') || 'none'}`);

  lines.push('\n  DEAL SIGNALS');
  lines.push(`    Pain points     : ${r.painPoints.join(' | ') || 'none'}`);
  lines.push(`    Business impact : ${r.businessImpact ?? 'not quantified'}`);
  lines.push(`    Objections      : ${r.objections.map((o) => `${o.category}/${o.status}`).join(', ') || 'none'}`);
  lines.push(`    Buying signals  : ${r.buyingSignals.length}`);
  lines.push(`    Commitments     : ${r.commitments.length}`);
  lines.push(`    Missing info    : ${r.missingInformation.join(', ') || 'none'}`);

  lines.push('\n  REP INTELLIGENCE');
  lines.push(`    Questions asked : ${r.repIntelligence.questionsAsked}`);
  lines.push(`    Objections handled/resolved : ${r.repIntelligence.objectionsHandled}/${r.repIntelligence.objectionsResolved}`);
  lines.push(`    Rep talk share  : ${Math.round(r.repIntelligence.talkListenRepShare * 100)}%`);
  lines.push(`    Strong moments  : ${r.repIntelligence.strongMoments.join('; ') || 'none'}`);
  lines.push(`    Weak moments    : ${r.repIntelligence.weakMoments.join('; ') || 'none'}`);

  if (r.nextAction) {
    lines.push('\n  NEXT ACTION');
    lines.push(`    ${r.nextAction.title} [${r.nextAction.recommendedType}]`);
    lines.push(`    Reason: ${r.nextAction.reason}`);
    lines.push(`    Required context: ${r.nextAction.requiredContext.join(', ') || 'none'}`);
  }

  lines.push('\n  LEARNING LINEAGE');
  lines.push(`    Interventions surfaced : ${r.learning.interventionsSurfaced}`);
  lines.push(`    Rated valuable         : ${r.learning.interventionsValuable} (rate ${r.learning.valuableRate ?? 'n/a'})`);
  lines.push(`    Conversion events      : ${r.learning.conversionEvents}`);
  const advanced = r.learning.records.filter((x) => x.conversionAdvanced);
  for (const rec of advanced.slice(0, 4)) {
    lines.push(`      • "${rec.recommendationTitle}" (turn ${rec.surfacedAtTurn}) → prospect@${rec.prospectResponseTurn}, order ${rec.stateBefore.ladderOrder}→${rec.ladderOrderAfter}${rec.followedByRep ? ' [followed]' : ''}`);
  }

  lines.push('\n  TRACE');
  lines.push(`    AI executions : ${r.trace.total}  providers=${JSON.stringify(r.trace.byProvider)}  fallbacks=${r.trace.fallbacks}  avg=${r.trace.avgLatencyMs}ms`);

  return lines.join('\n');
}
