/**
 * Contractor / service sales schema.
 * Ladder: Inbound Lead → Qualified → Site Visit / Estimate → Proposal → Close.
 */

import type { SalesSchema } from '../schema.ts';
import type { Ladder } from '../../domain/ladder.ts';
import { factKnown, hasCommitment, hasUnresolvedObjection, urgencyConfirmed } from '../../domain/predicates.ts';

const ladder: Ladder = {
  key: 'contractor',
  stages: [
    { id: 'lead', label: 'Inbound Lead', order: 0, description: 'Lead made contact.', gateFacts: [], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'qualified', label: 'Qualified', order: 1, description: 'Project scope, timeline, and budget band are understood.', gateFacts: ['need', 'timeline'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'estimate', label: 'Site Visit / Estimate', order: 2, description: 'On-site visit or estimate appointment booked.', gateFacts: ['urgency'], requiresObjectionsResolved: false, requiresCommitment: true, meaningfulConversion: true },
    { id: 'proposal', label: 'Proposal', order: 3, description: 'A written proposal / quote delivered.', gateFacts: ['budget'], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
    { id: 'close', label: 'Close', order: 4, description: 'Job booked / contract signed.', gateFacts: [], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
  ],
};

export const contractorSchema: SalesSchema = {
  key: 'contractor',
  label: 'Contractor / Service Sales',
  ladder,
  factSlots: ['need', 'pain', 'business_impact', 'urgency', 'budget', 'decision_authority', 'timeline', 'existing_solution'],
  qualificationFacts: ['need', 'timeline'],
  readinessSignals: [
    { key: 'need', label: 'Project need clear', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'need') ? 'confirmed' : 'missing' }) },
    { key: 'timeline', label: 'Timeline known', weight: 0.75, evaluate: (s) => ({ state: factKnown(s, 'timeline') ? 'confirmed' : 'missing' }) },
    { key: 'urgency', label: 'Urgency', weight: 1, evaluate: (s) => ({ state: urgencyConfirmed(s, 'low') ? 'confirmed' : 'missing' }) },
    { key: 'budget', label: 'Budget band', weight: 0.75, evaluate: (s) => ({ state: factKnown(s, 'budget') ? 'confirmed' : 'partial' }) },
    { key: 'objections', label: 'Objections resolved', weight: 1, evaluate: (s) => (hasUnresolvedObjection(s) ? { state: 'blocked', detail: 'open objection' } : { state: 'confirmed' }) },
    { key: 'commitment', label: 'Appointment / commitment', weight: 1, evaluate: (s) => ({ state: hasCommitment(s) ? 'confirmed' : 'missing' }) },
  ],
  objectionPlaybook: [
    { category: 'price', cues: ['too expensive', 'more than i wanted', 'cost too much', 'out of my budget', 'way too high'], concerns: ['comparison shopping', 'unclear value', 'budget'], responseStrategy: 'Anchor on scope and quality difference; book the site visit before quoting firm numbers.' },
    { category: 'timing', cues: ['maybe later', 'next year', 'not urgent', 'thinking about it'], concerns: ['no urgency', 'seasonality'], responseStrategy: 'Tie to seasonal cost / damage risk; hold a tentative estimate slot.' },
    { category: 'competition', cues: ['other company', 'other companies', 'another contractor', 'getting quotes', 'other quotes', 'other places', 'shopping around'], concerns: ['comparison', 'price shopping'], responseStrategy: 'Differentiate on warranty / references; make it easy to compare apples-to-apples.' },
    { category: 'trust', cues: ['licensed', 'reviews', 'references', 'insured'], concerns: ['credibility', 'risk'], responseStrategy: 'Provide license, insurance, and references proactively.' },
  ],
  terminology: { conversionEventNoun: 'estimate appointment', prospectNoun: 'homeowner' },
};
