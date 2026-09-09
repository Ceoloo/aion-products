// Context construction mirrored from the validation server for isolated testing.
import { getSchema } from '../../../src/config/registry.ts';
import type { ContextInput } from '../../../src/engines/context.ts';
const id = (prefix: string) => prefix + '_' + crypto.randomUUID();
export function buildContext(payload: any, industry: string): ContextInput {
  const schema = getSchema(industry);
  const stages = schema.ladder.stages;
  const first = stages[0]!.id;
  const conversionStageId = payload.conversionStageId ?? first;
  const desiredNextStageId =
    payload.desiredNextStageId ?? stages.find((s) => s.meaningfulConversion)?.id ?? stages[Math.min(1, stages.length - 1)]!.id;
  const list = (v: unknown): string[] =>
    typeof v === 'string' ? v.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : [];
  return {
    prospect: {
      id: payload.prospectId || id('acct'),
      name: payload.prospectName || 'Unknown prospect',
      ...(payload.role ? { role: payload.role } : {}),
      ...(payload.company ? { company: payload.company } : {}),
    },
    company: { name: payload.company || 'Unknown company', ...(payload.companyIndustry ? { industry: payload.companyIndustry } : {}) },
    offer: {
      name: payload.offerName || schema.label,
      summary: payload.offerSummary || '',
      constraints: list(payload.offerConstraints),
      differentiators: list(payload.offerDifferentiators),
    },
    crmState: typeof payload.crmState === 'object' && payload.crmState ? payload.crmState : {},
    priorConversations: [],
    priorObjections: list(payload.priorObjections),
    outstandingQuestions: list(payload.outstandingQuestions),
    knownFacts: {},
    conversionStageId,
    desiredNextStageId,
  };
}

