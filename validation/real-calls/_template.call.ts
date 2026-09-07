/**
 * TEMPLATE — copy this to `<yyyy-mm-dd>-<short-slug>.call.ts` for each REAL call.
 *
 * Rules (see ./README.md):
 *   - Set provenance.source = 'real' and provenance.consent = true. The harness
 *     only counts real, consented calls toward the ≥25 exit gate.
 *   - REDACT PII before saving. Real call files are gitignored and must never be
 *     committed; keep them local (or in an access-controlled store).
 *   - `groundTruth` is the human labeling used to score extraction/objection
 *     accuracy and the expected stage outcome for THIS conversation.
 *
 * This template is marked 'synthetic' on purpose (it is not a real call) and its
 * `_`-prefixed filename is skipped by the loader, so it can never satisfy the
 * gate by accident.
 */

import type { ValidationCall } from '../../src/validation/types.ts';
import type { Turn } from '../../src/domain/types.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

const turns: Turn[] = [
  rep('Redacted rep opener — replace with the real transcript, PII removed.'),
  pro('Redacted prospect turn. State the clearly-stated facts you will label.'),
  rep('Redacted rep turn.'),
  pro('Redacted prospect turn — e.g. an objection or a commitment.'),
];

export const call: ValidationCall = {
  provenance: {
    source: 'real', // a real conversation. (This TEMPLATE stays 'synthetic' below.)
    recordedAt: '2026-01-01',
    consent: true,
    rep: 'rep-handle-or-uuid',
    redacted: true,
    notes: 'transcription source / labeling reviewer',
  },
  call: {
    id: 'YYYY-MM-DD-short-slug',
    title: 'Real call — one-line summary (redacted)',
    industry: 'funding', // must be a registered SalesSchema key: funding | aion-b2b | contractor
    context: {
      prospect: { id: 'acct_redacted', name: 'REDACTED', role: 'Owner', company: 'REDACTED' },
      company: { name: 'REDACTED', industry: 'REDACTED' },
      offer: {
        name: 'Revenue-based working capital',
        summary: 'Flexible capital repaid as a small share of daily revenue.',
        constraints: [],
        differentiators: [],
      },
      crmState: { last_stage: 'engaged' },
      priorConversations: [],
      priorObjections: [],
      outstandingQuestions: [],
      knownFacts: {},
      conversionStageId: 'engaged',
      desiredNextStageId: 'application',
    },
    turns,
    scriptedFeedback: [],
    groundTruth: {
      facts: {
        // key → a lowercased substring expected in the extracted value
        // revenue: '85,000',
      },
      urgency: 'moderate',
      objections: [],
      expectStageAdvance: false,
      expectMeaningfulConversion: false,
      nextActionOneOf: ['schedule_follow_up', 'ask_question'],
    },
  },
};

// The template itself is not a real call. Overriding to 'synthetic' guarantees
// it can never count toward validation even if copied without edits.
call.provenance.source = 'synthetic';
