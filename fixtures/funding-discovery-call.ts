/**
 * Funding discovery call — the mission's signature scenario: a pricing
 * objection lands BEFORE urgency/impact is established, the copilot recommends
 * returning to impact, and the deal advances to an application.
 */

import type { CallFixture } from './types.ts';
import type { Turn } from '../src/domain/types.ts';

let i = 0;
const rep = (text: string): Turn => ({ index: i++, speaker: 'rep', text });
const pro = (text: string): Turn => ({ index: i++, speaker: 'prospect', text });

const turns: Turn[] = [
  rep("Hi Marcus, this is Dana over at Keystone Capital — I'm reaching out about working capital for your shop. Have a quick minute?"),
  pro("Sure, I've got a minute. What's this about?"),
  rep("Just wanted to understand the business a little. Roughly what does the shop do in revenue each month?"),
  pro("We do about $85,000 a month in revenue. We've been in business about 6 years now."),
  rep("Nice. And are you the one who makes decisions on financing, or is there a partner involved?"),
  pro("I own the shop, it's my call."),
  rep("Got it. What are you trying to accomplish right now — what's driving the interest?"),
  pro("Honestly I need to buy inventory before the busy season, but cash flow is the problem — I keep missing out on bulk orders."),
  rep("That's a common squeeze. We do revenue-based working capital that's built for exactly that kind of timing gap."),
  pro("Honestly, the rates on these things are probably too high for me."),
  rep("Totally fair to ask. Before we even get to rate — when you can't stock up for those bulk orders, what's that actually costing you?"),
  pro("Last month I turned down about $40,000 in jobs because I couldn't stock up in time."),
  rep("So the cost of waiting is real money. How much capital would actually let you stop turning that work away, and how soon do you need it?"),
  pro("I'm looking for somewhere between $75k and $100k, and I need it within 30 days, as soon as possible really."),
  rep("Here's why the rate is worth it: if $90k of capital keeps you from turning down $40k of jobs a month, it pays for itself fast. I'll show you the numbers."),
  pro("Okay, that makes sense. I'd use it for inventory and maybe hire one person. The cost is worth it if I stop losing those jobs."),
  rep("Then let's get you moving. Want me to send over the application so we can get you a real offer?"),
  pro("Yes, let's do it — send me the application."),
];

export const fundingDiscoveryCall: CallFixture = {
  id: 'funding-discovery-call',
  title: 'Funding discovery — price objection before impact, advances to application',
  industry: 'funding',
  context: {
    prospect: { id: 'acct_marcus_keystone', name: 'Marcus Rivera', role: 'Owner', company: "Rivera's Auto Parts" },
    company: { name: "Rivera's Auto Parts", industry: 'auto parts retail', annualRevenue: '~$1M' },
    offer: {
      name: 'Revenue-based working capital',
      summary: 'Flexible capital repaid as a small share of daily revenue.',
      constraints: ['factor rates 1.15–1.35', 'terms 6–18 months', 'min 6 months in business'],
      differentiators: ['funds in days', 'repayment flexes with revenue'],
    },
    crmState: { lead_source: 'inbound web form', last_stage: 'engaged' },
    priorConversations: [],
    priorObjections: [],
    outstandingQuestions: ['confirm monthly revenue', 'confirm use of funds'],
    knownFacts: {},
    conversionStageId: 'engaged',
    desiredNextStageId: 'application',
  },
  turns,
  scriptedFeedback: [
    { atTurn: 9, recommendationType: 'quantify_impact', feedback: 'acted_on' },
    { atTurn: 13, recommendationType: 'ask_commitment', feedback: 'useful' },
    { atTurn: 15, recommendationType: 'send_application', feedback: 'useful' },
  ],
  groundTruth: {
    facts: {
      revenue: '85,000',
      time_in_business: 'years',
      decision_authority: 'owner',
      need: 'inventory',
      pain: 'cash flow',
      business_impact: '40,000',
      capital_amount: '75,000',
      urgency: '30 days',
      use_of_funds: 'inventory',
    },
    urgency: 'high',
    objections: ['price'],
    finalConversationStageOneOf: ['commitment', 'closing', 'negotiation'],
    expectStageAdvance: true,
    expectMeaningfulConversion: true,
    nextActionOneOf: ['send_application', 'ask_commitment', 'schedule_follow_up', 'stay_silent', 'ask_question'],
  },
};
