/**
 * Versioned production workflows for OL-001.
 * Meaningful changes must mint a new version so cohort data stays comparable.
 */

export interface WorkflowTemplate {
  id: string;
  /** Display name including version — e.g. "Revenue Production v1" */
  label: string;
  version: string;
  description: string;
  owner: string;
  /** Capability allow-list for the launching actor */
  permissions: string[];
  steps: Array<{
    name: string;
    capability: string;
    riskLevel: 'R1' | 'R2' | 'R3';
    description?: string;
  }>;
}

/** Default revenue workflow — usable in PRE-OL validation; OL-001 credit only when gates clear. */
export const REVENUE_PRODUCTION_V1: WorkflowTemplate = {
  id: 'revenue-production-v1',
  label: 'Revenue Production v1',
  version: '1.0.0',
  description:
    'Lead research → enrichment → GHL contact upsert. PRE-OL by default until live GHL+model gates clear.',
  owner: 'revenue',
  permissions: [
    'revenue.lead.research',
    'revenue.lead.enrich',
    'client.ghl.contact.upsert',
  ],
  steps: [
    {
      name: 'research',
      capability: 'revenue.lead.research',
      riskLevel: 'R1',
      description: 'Research lead',
    },
    {
      name: 'enrich',
      capability: 'revenue.lead.enrich',
      riskLevel: 'R1',
      description: 'Enrich lead profile',
    },
    {
      name: 'ghl-upsert',
      capability: 'client.ghl.contact.upsert',
      riskLevel: 'R1',
      description: 'Upsert contact in GHL (governed adapter)',
    },
  ],
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [REVENUE_PRODUCTION_V1];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
