/**
 * Contractor inbound call — homeowner with a leaking roof. Competition
 * objection surfaces and is resolved; the call books a site-visit estimate
 * (the meaningful conversion for this vertical).
 */

import type { CallFixture } from './types.ts';
import type { Turn } from '../src/domain/types.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

const turns: Turn[] = [
  rep("Thanks for calling Summit Roofing, this is Jordan. How can I help?"),
  pro("Hi — I need to get my roof replaced, it's been leaking pretty badly."),
  rep("Sorry to hear that. What's your timeline looking like?"),
  pro("I need it done before winter, within the next month if possible."),
  rep("Understood. How urgent would you say it is right now?"),
  pro("It's pretty urgent honestly — water is getting in every time it rains."),
  rep("Got it. Do you have a rough budget in mind for the replacement?"),
  pro("I've got maybe $15,000 to $20,000 set aside for it."),
  rep("That's a workable range for what you're describing. We'd start with an on-site assessment."),
  pro("To be honest, I'm getting quotes from a few other places too."),
  rep("Totally fair to compare. Here's why homeowners pick us: we're licensed and insured, and every job carries a 10-year warranty. Happy to send references."),
  pro("Okay, that makes sense — the warranty actually matters a lot to me."),
  rep("Great. Can we get one of our estimators out to you? I have Thursday morning open."),
  pro("Yeah, let's schedule the site visit for Thursday."),
];

export const contractorEstimateCall: CallFixture = {
  id: 'contractor-estimate-call',
  title: 'Contractor inbound — competition objection resolved, books estimate',
  industry: 'contractor',
  context: {
    prospect: { id: 'acct_homeowner_diaz', name: 'Elena Diaz', role: 'Homeowner' },
    company: { name: 'Diaz residence' },
    offer: {
      name: 'Roof replacement',
      summary: 'Full tear-off and replacement with warranty.',
      constraints: ['crews booked 2-3 weeks out', 'financing available'],
      differentiators: ['10-year warranty', 'licensed & insured', 'local references'],
    },
    crmState: { lead_source: 'inbound call' },
    priorConversations: [],
    priorObjections: [],
    outstandingQuestions: ['scope', 'timeline', 'budget'],
    knownFacts: {},
    conversionStageId: 'lead',
    desiredNextStageId: 'estimate',
  },
  turns,
  scriptedFeedback: [
    { atTurn: 9, recommendationType: 'address_objection', feedback: 'acted_on' },
    { atTurn: 11, recommendationType: 'ask_commitment', feedback: 'useful' },
  ],
  groundTruth: {
    facts: { need: 'roof', timeline: 'winter', urgency: 'month', budget: '15,000' },
    urgency: 'high',
    objections: ['competition'],
    finalConversationStageOneOf: ['commitment', 'closing', 'negotiation'],
    expectStageAdvance: true,
    expectMeaningfulConversion: true,
    nextActionOneOf: ['schedule_follow_up', 'ask_commitment', 'stay_silent', 'ask_question'],
  },
};
