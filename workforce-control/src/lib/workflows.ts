/**
 * Versioned production workflows for OL-001 / Secure Automation.
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
  /** Deployment standard this template implements, when applicable. */
  secureAutomationStandard?: {
    standardId: 'SA-STD-001';
    standardVersion: string;
  };
  steps: Array<{
    name: string;
    capability: string;
    riskLevel: 'R1' | 'R2' | 'R3';
    description?: string;
    /** Human-operated until a catalog capability is active. */
    humanOperated?: boolean;
  }>;
}

/** OL-001 default — research → enrich → GHL upsert (proven M004/M006 path). */
export const REVENUE_PRODUCTION_V1: WorkflowTemplate = {
  id: 'revenue-production-v1',
  label: 'Revenue Production v1',
  version: '1.0.0',
  description:
    'OL-001 cohort workflow: lead research → enrichment → GHL contact upsert.',
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

/**
 * SA-STD-001 Lead-to-Appointment v1 — Secure Automation minimum path.
 * Draft messaging only; appointment booking is human-operated until AIO-17.
 * Does not enable crm.message.send.
 */
export const LEAD_TO_APPOINTMENT_V1: WorkflowTemplate = {
  id: 'lead-to-appointment-v1',
  label: 'Lead-to-Appointment v1',
  version: '1.0.0',
  description:
    'SA-STD-001: research → enrich → opportunity/task/note → draft follow-up → human books appointment. No autonomous send.',
  owner: 'revenue',
  secureAutomationStandard: {
    standardId: 'SA-STD-001',
    standardVersion: '1.0.0',
  },
  permissions: [
    'revenue.lead.research',
    'revenue.lead.enrich',
    'crm.contact.read',
    'crm.contact.enrich',
    'crm.opportunity.create',
    'crm.opportunity.update',
    'crm.note.create',
    'crm.task.create',
    'crm.message.draft',
  ],
  steps: [
    {
      name: 'research',
      capability: 'revenue.lead.research',
      riskLevel: 'R1',
      description: 'Research inbound / sourced lead',
    },
    {
      name: 'enrich',
      capability: 'revenue.lead.enrich',
      riskLevel: 'R1',
      description: 'Enrich lead profile',
    },
    {
      name: 'opportunity',
      capability: 'crm.opportunity.create',
      riskLevel: 'R2',
      description: 'Create pipeline opportunity (approval-gated)',
    },
    {
      name: 'follow-up-task',
      capability: 'crm.task.create',
      riskLevel: 'R1',
      description: 'Create appointment-setting task',
    },
    {
      name: 'crm-note',
      capability: 'crm.note.create',
      riskLevel: 'R1',
      description: 'Record qualification notes',
    },
    {
      name: 'draft-message',
      capability: 'crm.message.draft',
      riskLevel: 'R2',
      description: 'Draft approved follow-up (no send)',
    },
    {
      name: 'book-appointment',
      capability: 'human.appointment.book',
      riskLevel: 'R2',
      description: 'Human books appointment in CRM calendar',
      humanOperated: true,
    },
  ],
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  REVENUE_PRODUCTION_V1,
  LEAD_TO_APPOINTMENT_V1,
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
