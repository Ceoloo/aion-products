/**
 * Gap detection (Live responsibility #3).
 *
 * Recognizes the difference between where the conversation is and where it
 * should be — e.g. "you're trying to close but haven't established urgency" or
 * "capital amount is known but business impact hasn't been quantified." This is
 * far more valuable than displaying a script.
 */

import type { DealState, Gap } from '../domain/deal.ts';
import type { SalesSchema } from '../config/schema.ts';
import type { LadderEvaluation } from './ladder.ts';
import { FACT_LABELS } from '../domain/facts.ts';
import { factKnown, hasCommitment, unresolvedObjections, urgencyConfirmed } from '../domain/predicates.ts';

let gid = 0;
const nid = () => `gap_${(gid += 1)}`;

const CLOSING_STAGES = new Set(['negotiation', 'commitment', 'closing']);

export function detectGaps(state: DealState, schema: SalesSchema, ladder: LadderEvaluation): Gap[] {
  const gaps: Gap[] = [];

  // 1. Gates blocking the next rung.
  if (ladder.blockingStage) {
    for (const unmet of ladder.blockingUnmet) {
      if (unmet.startsWith('fact:')) {
        const key = unmet.slice('fact:'.length) as keyof typeof FACT_LABELS;
        gaps.push({
          id: nid(),
          kind: 'missing_fact',
          message: `To reach "${ladder.blockingStage.label}", establish ${FACT_LABELS[key] ?? key}.`,
          severity: 'block',
        });
      } else if (unmet === 'objections_unresolved') {
        gaps.push({ id: nid(), kind: 'unresolved_objection', message: `Resolve the open objection before advancing to "${ladder.blockingStage.label}".`, severity: 'block' });
      } else if (unmet === 'no_commitment') {
        gaps.push({ id: nid(), kind: 'no_commitment', message: `No commitment yet — needed to reach "${ladder.blockingStage.label}".`, severity: 'warn' });
      }
    }
  }

  // 2. Sequence gaps: closing behavior without foundation.
  if (CLOSING_STAGES.has(state.conversationStage)) {
    if (!urgencyConfirmed(state)) {
      gaps.push({ id: nid(), kind: 'sequence', message: 'Pushing toward the close, but urgency has not been established.', severity: 'warn' });
    }
    if (!factKnown(state, 'business_impact') && schema.factSlots.includes('business_impact')) {
      gaps.push({ id: nid(), kind: 'sequence', message: 'Discussing terms/close, but the economic impact of the problem has not been quantified.', severity: 'warn' });
    }
    if (unresolvedObjections(state).length > 0) {
      gaps.push({ id: nid(), kind: 'unresolved_objection', message: 'An objection is still open while moving to close.', severity: 'warn' });
    }
  }

  // 3. Known-amount-but-no-impact (the mission's explicit example).
  if (factKnown(state, 'capital_amount') && !factKnown(state, 'business_impact') && schema.factSlots.includes('business_impact')) {
    gaps.push({ id: nid(), kind: 'sequence', message: 'Capital amount is known, but the business impact of the need has not been quantified.', severity: 'info' });
  }

  // 4. Late call with no commitment.
  if (!hasCommitment(state) && CLOSING_STAGES.has(state.conversationStage)) {
    // (already flagged via gate no_commitment if applicable; keep as info otherwise)
  }

  return gaps;
}

export function missingInformation(state: DealState, schema: SalesSchema): string[] {
  const missing: string[] = [];
  for (const key of schema.factSlots) {
    if (!factKnown(state, key)) missing.push(FACT_LABELS[key]);
  }
  return missing;
}
