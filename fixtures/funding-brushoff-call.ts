/**
 * Funding cold call that stalls — skeptical prospect, timing brush-off, no
 * commitment. Tests correct NON-advancement, an unresolved timing objection,
 * and de-escalation / disqualification guidance rather than a false close.
 */

import type { CallFixture } from './types.ts';
import type { Turn } from '../src/domain/types.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

const turns: Turn[] = [
  rep("Hi, this is Dana at Keystone Capital calling about working capital options for your business."),
  pro("Honestly, who are you? I've never heard of your company."),
  rep("Fair question — we provide revenue-based capital to small businesses. Mind if I ask how the business is doing?"),
  pro("We do okay, maybe $30,000 a month. But look, it's not a good time — maybe later, call me next quarter."),
  rep("I hear you. Can I ask what's driving the timing?"),
  pro("I'm just not interested right now, sorry."),
];

export const fundingBrushoffCall: CallFixture = {
  id: 'funding-brushoff-call',
  title: 'Funding cold call — skeptical brush-off, no advancement',
  industry: 'funding',
  context: {
    prospect: { id: 'acct_unknown_smallbiz', name: 'Pat Nguyen', role: 'Owner' },
    company: { name: 'Unknown SMB' },
    offer: {
      name: 'Revenue-based working capital',
      summary: 'Flexible capital repaid as a share of revenue.',
      constraints: ['min 6 months in business'],
      differentiators: ['funds in days'],
    },
    crmState: { lead_source: 'cold list' },
    priorConversations: [],
    priorObjections: [],
    outstandingQuestions: ['is there any need at all'],
    knownFacts: {},
    conversionStageId: 'engaged',
    desiredNextStageId: 'qualified',
  },
  turns,
  scriptedFeedback: [{ atTurn: 1, recommendationType: 'reframe', feedback: 'useful' }],
  groundTruth: {
    facts: { revenue: '30,000' },
    objections: ['timing'],
    finalConversationStageOneOf: ['objection', 'opening', 'discovery', 'qualification'],
    expectStageAdvance: false,
    expectMeaningfulConversion: false,
    nextActionOneOf: ['reframe', 'address_objection', 'disqualify', 'clarify', 'quantify_impact', 'ask_question', 'stay_silent'],
  },
};
