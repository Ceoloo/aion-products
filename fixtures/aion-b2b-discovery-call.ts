/**
 * AION B2B discovery — operations leader with a scheduling problem on
 * spreadsheets. Trust objection surfaces and is resolved; the call books an
 * audit (the meaningful conversion for this vertical).
 */

import type { CallFixture } from './types.ts';
import type { Turn } from '../src/domain/types.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

const turns: Turn[] = [
  rep("Hi Sam, Alex from AION. We help operators cut the cost of manual back-office work. Got two minutes?"),
  pro("Sure, what do you do exactly?"),
  rep("Before I pitch — are you the person who'd own a decision like this?"),
  pro("Yeah, I'm the operations director, I own these decisions."),
  rep("Perfect. Where does the most manual effort go right now?"),
  pro("Our biggest problem is scheduling — we currently use spreadsheets and it's honestly a mess."),
  rep("What's that costing you, roughly?"),
  pro("It's probably costing us $20,000 a month in wasted labor and missed slots."),
  pro("But how do I know you can actually deliver? I've never heard of AION."),
  rep("Fair — that's exactly why we start with a low-risk audit before anyone commits. Here's why it works: you see the ROI on your own numbers first."),
  pro("Okay, that makes sense."),
  rep("Can we schedule the audit for next week?"),
  pro("Yes, let's schedule it."),
];

export const aionB2bDiscoveryCall: CallFixture = {
  id: 'aion-b2b-discovery-call',
  title: 'AION B2B discovery — trust objection resolved, books audit',
  industry: 'aion-b2b',
  context: {
    prospect: { id: 'acct_sam_ops', name: 'Sam Okafor', role: 'Operations Director', company: 'Northwind Logistics' },
    company: { name: 'Northwind Logistics', industry: 'logistics', sizeEmployees: 120 },
    offer: {
      name: 'AION operations audit + automation',
      summary: 'Audit manual workflows and automate the highest-ROI ones.',
      constraints: ['audit is a fixed 2-week engagement'],
      differentiators: ['ROI shown on client data', 'no long-term lock-in to start'],
    },
    crmState: { lead_source: 'outbound' },
    priorConversations: [],
    priorObjections: [],
    outstandingQuestions: ['who owns the decision', 'where is the pain'],
    knownFacts: {},
    conversionStageId: 'cold_call',
    desiredNextStageId: 'audit',
  },
  turns,
  scriptedFeedback: [
    { atTurn: 8, recommendationType: 'address_objection', feedback: 'acted_on' },
    { atTurn: 11, recommendationType: 'schedule_follow_up', feedback: 'useful' },
  ],
  groundTruth: {
    facts: { decision_authority: 'owner', pain: 'scheduling', existing_solution: 'spreadsheet', business_impact: '20,000' },
    objections: ['trust'],
    finalConversationStageOneOf: ['commitment', 'closing', 'negotiation', 'objection'],
    expectStageAdvance: true,
    expectMeaningfulConversion: true,
    nextActionOneOf: ['schedule_follow_up', 'ask_commitment', 'stay_silent', 'ask_question'],
  },
};
