/**
 * Funding / financial sales schema (the primary AION use case).
 *
 * Ladder maps the Mission-001 conversion ladder onto capital sales, where
 * application submission is a major (but not terminal) conversion event.
 */

import type { SalesSchema } from '../schema.ts';
import type { Ladder } from '../../domain/ladder.ts';
import { factKnown, hasCommitment, hasUnresolvedObjection, urgencyConfirmed } from '../../domain/predicates.ts';

const ladder: Ladder = {
  key: 'funding',
  stages: [
    { id: 'contact', label: 'Contact', order: 0, description: 'Reached the prospect.', gateFacts: [], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'engaged', label: 'Engaged', order: 1, description: 'Prospect is participating in the conversation.', gateFacts: [], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'qualified', label: 'Qualified', order: 2, description: 'Basic fit confirmed: revenue, time in business, authority.', gateFacts: ['revenue', 'time_in_business', 'decision_authority'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'need_confirmed', label: 'Pain / Need Confirmed', order: 3, description: 'A real capital need and its business impact are established.', gateFacts: ['need', 'pain', 'business_impact'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'intent', label: 'Intent Identified', order: 4, description: 'Urgency and capital amount identified; prospect wants to move.', gateFacts: ['urgency', 'capital_amount'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'committed', label: 'Next Step Committed', order: 5, description: 'Prospect commits to a concrete next step.', gateFacts: [], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: false },
    { id: 'application', label: 'Application Submitted', order: 6, description: 'Application / documentation submitted.', gateFacts: ['use_of_funds'], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true },
    { id: 'closed', label: 'Approved / Closed', order: 7, description: 'Offer approved and accepted.', gateFacts: [], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
    { id: 'funded', label: 'Funded (Revenue)', order: 8, description: 'Capital disbursed — revenue realized.', gateFacts: [], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
  ],
};

export const fundingSchema: SalesSchema = {
  key: 'funding',
  label: 'Funding / Capital Sales',
  ladder,
  factSlots: [
    'revenue', 'time_in_business', 'industry', 'need', 'pain', 'business_impact',
    'urgency', 'capital_amount', 'decision_authority', 'existing_obligations',
    'timeline', 'use_of_funds', 'credit_posture',
  ],
  qualificationFacts: ['revenue', 'time_in_business', 'decision_authority'],
  readinessSignals: [
    { key: 'need', label: 'Need confirmed', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'need') ? 'confirmed' : 'missing' }) },
    { key: 'authority', label: 'Authority confirmed', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'decision_authority') ? 'confirmed' : 'missing' }) },
    { key: 'urgency', label: 'Urgency confirmed', weight: 1, evaluate: (s) => ({ state: urgencyConfirmed(s) ? 'confirmed' : 'missing' }) },
    { key: 'impact', label: 'Economic impact quantified', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'business_impact') ? 'confirmed' : 'missing' }) },
    { key: 'amount', label: 'Capital amount known', weight: 0.75, evaluate: (s) => ({ state: factKnown(s, 'capital_amount') ? 'confirmed' : 'partial' }) },
    {
      key: 'objections', label: 'Objections resolved', weight: 1,
      evaluate: (s) => (hasUnresolvedObjection(s) ? { state: 'blocked', detail: 'open objection' } : { state: 'confirmed' }),
    },
    { key: 'commitment', label: 'Commitment secured', weight: 1, evaluate: (s) => ({ state: hasCommitment(s) ? 'confirmed' : 'missing' }) },
  ],
  objectionPlaybook: [
    {
      category: 'price',
      cues: ['rate', 'rates', 'too high', 'expensive', 'cost too much', 'interest rate', 'apr', 'cheaper'],
      concerns: ['comparison shopping', 'unclear ROI', 'trust problem', 'payment concern', 'lack of urgency', 'genuine affordability'],
      responseStrategy: 'Do not defend price first. Return to business impact and cost of waiting; isolate whether the concern is ROI, affordability, or comparison before quoting.',
    },
    {
      category: 'timing',
      cues: ['not right now', 'maybe later', 'next quarter', 'too busy', 'call me back', 'think about it', 'not a good time'],
      concerns: ['no urgency established', 'competing priority', 'polite brush-off'],
      responseStrategy: 'Quantify the cost of waiting against the opportunity they described; anchor a concrete next step to a date.',
    },
    {
      category: 'trust',
      cues: ['scam', 'legit', 'who are you', 'never heard of', 'skeptical', 'burned before'],
      concerns: ['credibility', 'prior bad experience', 'fear of fees'],
      responseStrategy: 'Lead with proof and transparency on terms; acknowledge prior bad experiences before advancing.',
    },
    {
      category: 'authority',
      cues: ['my partner', 'talk to my', 'not my decision', 'run it by'],
      concerns: ['not the decision maker', 'needs buy-in', 'stall'],
      responseStrategy: 'Confirm the decision process and get the other stakeholder into the next step rather than leaving it open.',
    },
    {
      category: 'need',
      cues: ["don't need", 'we’re fine', 'no need', 'already have'],
      concerns: ['pain not developed', 'existing solution', 'genuinely no need'],
      responseStrategy: 'Develop the pain and its impact before positioning capital; if truly no need, disqualify cleanly.',
    },
  ],
  terminology: { conversionEventNoun: 'application', prospectNoun: 'business owner' },
};
