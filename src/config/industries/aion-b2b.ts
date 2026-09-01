/**
 * AION B2B sales schema — AION selling audits / systems / ROI to businesses.
 * Ladder: Cold Call → Decision Maker → Discovery → Audit → Proposal → Close.
 */

import type { SalesSchema } from '../schema.ts';
import type { Ladder } from '../../domain/ladder.ts';
import { factKnown, hasCommitment, hasUnresolvedObjection, urgencyConfirmed } from '../../domain/predicates.ts';

const ladder: Ladder = {
  key: 'aion-b2b',
  stages: [
    { id: 'cold_call', label: 'Cold Call', order: 0, description: 'Outreach connected.', gateFacts: [], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'decision_maker', label: 'Decision Maker', order: 1, description: 'Talking to someone with authority.', gateFacts: ['decision_authority'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'discovery', label: 'Discovery', order: 2, description: 'Systems, pain, and business context understood.', gateFacts: ['pain', 'existing_solution'], requiresObjectionsResolved: false, requiresCommitment: false, meaningfulConversion: false },
    { id: 'audit', label: 'Audit', order: 3, description: 'A scoped audit of the prospect’s systems is agreed / booked.', gateFacts: ['business_impact'], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true },
    { id: 'proposal', label: 'Proposal', order: 4, description: 'A proposal with ROI has been presented.', gateFacts: ['business_impact', 'budget'], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
    { id: 'close', label: 'Close', order: 5, description: 'Agreement signed.', gateFacts: [], requiresObjectionsResolved: true, requiresCommitment: true, meaningfulConversion: true, outcomeOnly: true },
  ],
};

export const aionB2bSchema: SalesSchema = {
  key: 'aion-b2b',
  label: 'AION B2B Sales',
  ladder,
  factSlots: ['industry', 'pain', 'business_impact', 'need', 'urgency', 'budget', 'decision_authority', 'existing_solution', 'timeline'],
  qualificationFacts: ['decision_authority', 'pain'],
  readinessSignals: [
    { key: 'authority', label: 'Decision maker', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'decision_authority') ? 'confirmed' : 'missing' }) },
    { key: 'pain', label: 'Pain identified', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'pain') ? 'confirmed' : 'missing' }) },
    { key: 'impact', label: 'Business impact quantified', weight: 1, evaluate: (s) => ({ state: factKnown(s, 'business_impact') ? 'confirmed' : 'partial' }) },
    { key: 'urgency', label: 'Urgency', weight: 0.75, evaluate: (s) => ({ state: urgencyConfirmed(s, 'low') ? 'confirmed' : 'missing' }) },
    { key: 'objections', label: 'Objections resolved', weight: 1, evaluate: (s) => (hasUnresolvedObjection(s) ? { state: 'blocked', detail: 'open objection' } : { state: 'confirmed' }) },
    { key: 'commitment', label: 'Commitment secured', weight: 1, evaluate: (s) => ({ state: hasCommitment(s) ? 'confirmed' : 'missing' }) },
  ],
  objectionPlaybook: [
    { category: 'price', cues: ['too expensive', "can't afford", 'over budget', 'price is too high', 'out of budget'], concerns: ['unclear ROI', 'budget authority', 'comparison'], responseStrategy: 'Tie price to the quantified impact from discovery; propose the audit as the low-risk proof step.' },
    { category: 'need', cues: ["we're fine", "don't need", 'already have', 'happy with'], concerns: ['pain not developed', 'incumbent solution'], responseStrategy: 'Deepen discovery on the cost of the status quo before positioning.' },
    { category: 'trust', cues: ['who are you', 'never heard', 'prove it', 'skeptical'], concerns: ['credibility', 'risk'], responseStrategy: 'Offer the audit as evidence; share comparable outcomes.' },
    { category: 'timing', cues: ['later', 'next quarter', 'not now', 'busy'], concerns: ['no urgency', 'competing priority'], responseStrategy: 'Book the audit now to hold momentum; quantify delay cost.' },
  ],
  terminology: { conversionEventNoun: 'audit', prospectNoun: 'operator' },
};
