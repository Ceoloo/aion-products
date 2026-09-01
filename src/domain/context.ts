/**
 * The pre-call context package.
 *
 * Before the call, Revenue Copilot assembles everything the rep needs to know
 * before talking to this person: prospect + company + offer + CRM state +
 * previous conversations + previous objections + qualification state +
 * outstanding questions + current conversion stage + desired next conversion.
 */

import type { FactMap } from './facts.ts';

export interface ProspectProfile {
  id: string;
  name: string;
  role?: string;
  company?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface CompanyProfile {
  name: string;
  industry?: string;
  sizeEmployees?: number;
  annualRevenue?: string;
  location?: string;
  notes?: string;
}

export interface OfferProfile {
  /** e.g. "Working capital / revenue-based financing" */
  name: string;
  summary: string;
  /** Constraints the objection engine can reason against, e.g. rate ranges. */
  constraints: string[];
  differentiators: string[];
}

export interface PriorConversation {
  date: string;
  channel: 'call' | 'email' | 'meeting' | 'other';
  summary: string;
  outcomeStageId?: string;
}

export interface PreCallContext {
  prospect: ProspectProfile;
  company: CompanyProfile;
  offer: OfferProfile;
  /** Free-form CRM fields. */
  crmState: Record<string, string>;
  priorConversations: PriorConversation[];
  /** Objections raised in prior conversations (surface forms). */
  priorObjections: string[];
  /** Questions still open coming into this call. */
  outstandingQuestions: string[];
  /** Facts already known coming into the call (seed the live state). */
  knownFacts: FactMap;
  /** Ladder stage the deal is on coming into this call. */
  conversionStageId: string;
  /** The stage this call is trying to reach. */
  desiredNextStageId: string;
  /**
   * A generated briefing answering: "What does the rep need to know before
   * talking to this person?"
   */
  briefing: string;
}
