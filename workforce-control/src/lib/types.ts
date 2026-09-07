/**
 * Workforce Control Center — types mirror Runtime/Data API responses.
 * HARD RULE: every displayed number must come from these API shapes.
 * Do not invent KPI generators or mock dashboard state.
 */

export interface EconomicsRollup {
  missionId?: string;
  tenantId?: string;
  scope?: { tenantId?: string; companyId?: string; ventureId?: string; projectId?: string };
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  policyDenials: number;
  approvals: number;
  humanInterventions: number;
  totalCostUnits: number;
  totalDurationMs: number;
  outcomeCount: number;
  attributedEconomicValue: number;
  roi: number | null;
  computedAt?: string;
}

export interface Mission {
  missionId: string;
  name: string;
  description?: string;
  owner: string;
  status: string;
  objective: string;
  successCriteria?: string[];
  riskLevel?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ExecutionObject {
  executionId: string;
  actorId?: string;
  agentUri?: string;
  tenantId?: string;
  domain?: string;
  companyId?: string;
  ventureId?: string;
  projectId?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  runId?: string;
  requestId?: string;
  commandId?: string;
  missionId?: string;
  workflowId?: string;
  correlationId?: string;
  status: string;
  autonomyLevel?: string;
  riskLevel?: string;
  approvalId?: string;
  cost?: { units?: number; currency?: string };
  outcomeId?: string;
  outcomeSummary?: string;
  revenueAttributed?: number;
  auditTrace?: unknown;
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  requestId?: string;
  missionId?: string;
  executionId?: string;
  tenantId?: string;
  command?: unknown;
  riskLevel?: string;
  reason?: string;
  status: string;
  requestedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
  expiresAt?: string;
  consumedAt?: string;
}

/** IE-001 — mirrors Runtime ImplementationCase. */
export interface ImplementationCase {
  caseId: string;
  tenantId: string;
  clientRef: string;
  clientName: string;
  ownerId: string;
  commercialStatus: string;
  deliveryStatus: string;
  nextAction?: string;
  blockers?: string[];
  evidenceLinks?: Array<{ label: string; url?: string; note?: string }>;
  intake?: Record<string, unknown>;
  recommendation?: {
    outcome: string;
    recommendedPackage?: string;
    rationale: string;
    exclusions?: string[];
    missingInputs?: string[];
    readinessGates?: Record<string, boolean>;
    requiresHumanReview?: boolean;
    humanOverridePackage?: string;
    humanNotes?: string;
  };
  blueprint?: Record<string, unknown> & {
    version?: number;
    status?: string;
    packageKey?: string;
    approvedBy?: string;
    approvedAt?: string;
  };
  provisioning?: {
    steps?: Array<{
      key: string;
      status: string;
      blockReason?: string;
      evidence?: string;
      completedBy?: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
