/**
 * Funding follow-up — the context package seeds facts already known from a
 * prior call (revenue, time in business, authority), so the deal starts
 * "qualified". The rep re-opens a prior pricing concern, develops impact and
 * urgency, and advances to an application.
 */

import type { CallFixture } from './types.ts';
import type { Turn } from '../src/domain/types.ts';
import type { FactKey, FactMap, FactSlot } from '../src/domain/facts.ts';
import { FACT_LABELS } from '../src/domain/facts.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

function slot(key: FactKey, value: string, confidence: number): FactSlot {
  return { key, label: FACT_LABELS[key], value, confidence, statedExplicitly: true, evidence: [], updatedAtTurn: -1 };
}

const knownFacts: FactMap = {
  revenue: slot('revenue', '$120,000/mo', 0.9),
  time_in_business: slot('time_in_business', '8 years', 0.9),
  decision_authority: slot('decision_authority', 'owner / decision maker', 0.9),
};

const turns: Turn[] = [
  rep("Hey Priya, Dana again from Keystone. Last time you mentioned the rates felt high — I wanted to pick that back up."),
  pro("Yeah, that was my hesitation honestly."),
  rep("Totally fair. Before rates — remind me what the capital would actually let you do?"),
  pro("I need to take on a big contract, but I can't take on the upfront material costs right now. That's the problem."),
  rep("And if you can't take that contract on, what does that cost you?"),
  pro("We'd be losing about $60,000 in margin on that one job alone."),
  rep("That's real money. How much are you looking for, and by when?"),
  pro("Around $150,000, and I need it within two weeks — it's urgent."),
  rep("Here's why the rate pencils out: $150k that unlocks $60k of margin pays for itself on the first contract. I'll show the math."),
  pro("Okay, that makes sense when you put it that way. I'd use it for materials and labor upfront."),
  rep("Then let's get you a real offer. Want me to send the application over now?"),
  pro("Yes, let's do it — send me the application."),
];

export const fundingWarmFollowupCall: CallFixture = {
  id: 'funding-warm-followup-call',
  title: 'Funding follow-up — seeded facts, prior price concern, advances to application',
  industry: 'funding',
  context: {
    prospect: { id: 'acct_priya_builders', name: 'Priya Shah', role: 'Owner', company: 'Shah Builders' },
    company: { name: 'Shah Builders', industry: 'general contracting', annualRevenue: '~$1.4M' },
    offer: {
      name: 'Revenue-based working capital',
      summary: 'Flexible capital repaid as a share of daily revenue.',
      constraints: ['factor rates 1.15–1.35', 'terms 6–18 months'],
      differentiators: ['funds in days', 'repayment flexes with revenue'],
    },
    crmState: { last_stage: 'qualified' },
    priorConversations: [
      { date: '2026-08-20', channel: 'call', summary: 'Good discovery; owner hesitated on rates.', outcomeStageId: 'qualified' },
    ],
    priorObjections: ['rates felt high'],
    outstandingQuestions: ['use of funds', 'urgency'],
    knownFacts,
    conversionStageId: 'qualified',
    desiredNextStageId: 'application',
  },
  turns,
  scriptedFeedback: [
    { atTurn: 3, recommendationType: 'quantify_impact', feedback: 'acted_on' },
    { atTurn: 9, recommendationType: 'send_application', feedback: 'useful' },
  ],
  groundTruth: {
    facts: { need: 'contract', business_impact: '60,000', capital_amount: '150,000', urgency: 'urgent', use_of_funds: 'materials' },
    urgency: 'immediate',
    objections: ['price'],
    finalConversationStageOneOf: ['commitment', 'closing', 'negotiation'],
    expectStageAdvance: true,
    expectMeaningfulConversion: true,
    nextActionOneOf: ['send_application', 'ask_commitment', 'schedule_follow_up', 'stay_silent', 'ask_question'],
  },
};
